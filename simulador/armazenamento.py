"""
Camada de persistência. Hoje aponta para SQLite local em ./datacold.db.

A interface da classe Armazenamento é deliberadamente pequena. Quando o
banco real chegar (Postgres / InfluxDB / outro), basta criar uma outra
classe que implemente os mesmos métodos e trocar a instância em main.py.

Pontos são armazenados como JSON no campo `payload` para evitar
schemas-por-tipo (energia tem 9 campos, temperatura 1, porta 1). O
índice (sensor_id, ts) torna a consulta por janela barata.
"""

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path


class Armazenamento:
    def __init__(self, caminho="datacold.db"):
        self.caminho = str(Path(caminho).expanduser().resolve())
        self._lock = threading.Lock()
        self._inicializar_schema()

    # -------------------------------------------------------------
    #  Schema
    # -------------------------------------------------------------
    def _conexao(self):
        # check_same_thread=False porque uvicorn + background task usam threads.
        # O _lock serializa as escritas.
        conn = sqlite3.connect(self.caminho, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def _inicializar_schema(self):
        with self._conexao() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS pontos (
                    sensor_id TEXT NOT NULL,
                    ts        TEXT NOT NULL,
                    payload   TEXT NOT NULL,
                    PRIMARY KEY (sensor_id, ts)
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_pontos_sensor_ts
                    ON pontos (sensor_id, ts)
            """)
            conn.commit()

    # -------------------------------------------------------------
    #  Escrita
    # -------------------------------------------------------------
    def salvar_ponto(self, sensor_id, ponto):
        """Insere um ponto (dict com 'time' + campos). Ignora se duplicado."""
        ts = ponto["time"]
        payload = json.dumps(ponto, separators=(",", ":"))
        with self._lock, self._conexao() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO pontos (sensor_id, ts, payload) VALUES (?, ?, ?)",
                (sensor_id, ts, payload),
            )
            conn.commit()

    def salvar_pontos_em_lote(self, sensor_id, pontos):
        """Inserção em batch, ~100x mais rápida no warm-up histórico."""
        if not pontos:
            return
        registros = [
            (sensor_id, p["time"], json.dumps(p, separators=(",", ":")))
            for p in pontos
        ]
        with self._lock, self._conexao() as conn:
            conn.executemany(
                "INSERT OR IGNORE INTO pontos (sensor_id, ts, payload) VALUES (?, ?, ?)",
                registros,
            )
            conn.commit()

    # -------------------------------------------------------------
    #  Leitura
    # -------------------------------------------------------------
    def buscar_pontos(self, sensor_id, inicio, fim, limite=20000):
        """
        Retorna lista de dicts ordenados por ts crescente.
        `inicio` e `fim` são datetime UTC.
        """
        inicio_iso = _para_iso(inicio)
        fim_iso = _para_iso(fim)
        with self._conexao() as conn:
            cur = conn.execute(
                """
                SELECT payload FROM pontos
                WHERE sensor_id = ? AND ts >= ? AND ts <= ?
                ORDER BY ts ASC
                LIMIT ?
                """,
                (sensor_id, inicio_iso, fim_iso, int(limite)),
            )
            return [json.loads(row[0]) for row in cur.fetchall()]

    def ultimo_ts(self, sensor_id):
        """Maior timestamp já armazenado para o sensor, ou None."""
        with self._conexao() as conn:
            cur = conn.execute(
                "SELECT MAX(ts) FROM pontos WHERE sensor_id = ?",
                (sensor_id,),
            )
            row = cur.fetchone()
            return row[0] if row and row[0] else None

    def contar_pontos(self, sensor_id=None):
        with self._conexao() as conn:
            if sensor_id:
                cur = conn.execute(
                    "SELECT COUNT(*) FROM pontos WHERE sensor_id = ?", (sensor_id,)
                )
            else:
                cur = conn.execute("SELECT COUNT(*) FROM pontos")
            return cur.fetchone()[0]

    def apagar_tudo(self):
        with self._lock, self._conexao() as conn:
            conn.execute("DELETE FROM pontos")
            conn.commit()


# ---------------------------------------------------------------------
#  Helpers de tempo
# ---------------------------------------------------------------------
def _para_iso(dt):
    if isinstance(dt, str):
        return dt
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
