"""
Aplica schema.sql e popula o seed (grupos + sensores) no Supabase.

Uso:
    python3 supabase/aplicar.py            # aplica schema + seed
    python3 supabase/aplicar.py --so-seed  # só re-roda o seed (idempotente)
    python3 supabase/aplicar.py --info     # mostra contagem de cada tabela

Lê credenciais de .env (raiz do projeto).
"""

import json
import os
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

# Importa perfis do simulador para usar como fonte de verdade do catálogo
RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "simulador"))
from perfis import PERFIS, GRUPOS  # noqa: E402


def conectar():
    """Conecta no Postgres do Supabase via Supavisor (pooler us-west-1)."""
    load_dotenv(RAIZ / ".env")
    return psycopg2.connect(
        host="aws-1-us-west-1.pooler.supabase.com",
        port=6543,
        dbname="postgres",
        user=f"postgres.{os.environ['SUPABASE_PROJECT_ID']}",
        password=os.environ["SUPABASE_DB_PASSWORD"],
        sslmode="require",
    )


def aplicar_schema(conn):
    sql = (Path(__file__).parent / "schema.sql").read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()
    print("[ok] schema.sql aplicado")


def aplicar_seed(conn):
    with conn.cursor() as cur:
        # Grupos
        valores_grupos = [
            (g["id"], g["label"], g.get("description"), "seed", "seed")
            for g in GRUPOS
        ]
        execute_values(
            cur,
            """
            insert into grupos (id, rotulo, descricao, criado_por, atualizado_por)
            values %s
            on conflict (id) do update set
              rotulo         = excluded.rotulo,
              descricao      = excluded.descricao,
              atualizado_por = excluded.atualizado_por
            """,
            valores_grupos,
        )
        print(f"[ok] {len(valores_grupos)} grupos inseridos/atualizados")

        # Sensores
        valores_sensores = [
            (
                sid,
                p["label"],
                p["tipo"],
                p["grupo"],
                p["status"],
                p["personalidade"],
                json.dumps(p["parametros"]),
                "seed",
                "seed",
            )
            for sid, p in PERFIS.items()
        ]
        execute_values(
            cur,
            """
            insert into sensores
              (id, rotulo, tipo, grupo_id, status, personalidade, parametros,
               criado_por, atualizado_por)
            values %s
            on conflict (id) do update set
              rotulo         = excluded.rotulo,
              tipo           = excluded.tipo,
              grupo_id       = excluded.grupo_id,
              status         = excluded.status,
              personalidade  = excluded.personalidade,
              parametros     = excluded.parametros,
              atualizado_por = excluded.atualizado_por
            """,
            valores_sensores,
        )
        print(f"[ok] {len(valores_sensores)} sensores inseridos/atualizados")

    conn.commit()


def mostrar_info(conn):
    with conn.cursor() as cur:
        for tabela in [
            "grupos", "sensores",
            "leituras_energia", "leituras_temperatura", "leituras_porta",
            "incidentes", "auditoria",
        ]:
            try:
                cur.execute(f"select count(*) from {tabela}")
                qtd = cur.fetchone()[0]
                print(f"  {tabela:<25} {qtd:>10}")
            except Exception as e:
                print(f"  {tabela:<25} (erro: {str(e)[:50]})")


def principal():
    args = sys.argv[1:]
    conn = conectar()
    try:
        if "--info" in args:
            mostrar_info(conn)
            return
        if "--so-seed" not in args:
            aplicar_schema(conn)
        aplicar_seed(conn)
        print()
        print("=== estado das tabelas ===")
        mostrar_info(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    principal()
