"""
Loop em background que alimenta o banco de dados automaticamente.

A cada N segundos, gera o ponto "agora" de cada sensor (já aplicando
incidentes ativos) e insere no banco. Roda em uma thread daemon,
iniciada quando o FastAPI sobe.

O warm-up histórico (7 dias) também mora aqui — ao iniciar, se o
banco está vazio para um sensor, geramos a janela completa de uma vez.
"""

import threading
import time
from datetime import datetime, timezone, timedelta

from perfis import PERFIS
from geradores import gerar_ponto, gerar_janela, intervalo_amostragem
from incidentes import GERENCIADOR


# Intervalo do loop em segundos. Pode ser ajustado por env var
# em main.py se quiser acelerar pra demo.
TICK_PADRAO_S = 5


class Agendador:
    def __init__(self, armazenamento, tick_s: int = TICK_PADRAO_S):
        self.armazenamento = armazenamento
        self.tick_s = tick_s
        self._parar = threading.Event()
        self._thread = None
        # marca o próximo instante em que cada sensor deve emitir
        self._proximo_emit = {}

    # -----------------------------------------------------------------
    #  Warm-up histórico
    # -----------------------------------------------------------------
    def aquecer_historico(self, horas: int = 168):
        """
        Preenche o banco com `horas` de dados retroativos para cada sensor
        que ainda não tem nada. Idempotente: se você reiniciar com o BD
        cheio, este passo é praticamente instantâneo.
        """
        agora = datetime.now(timezone.utc)
        inicio = agora - timedelta(hours=horas)
        total = 0
        for sensor_id in PERFIS:
            if self.armazenamento.contar_pontos(sensor_id) > 0:
                continue
            # Sem limite: o warm-up tem que cobrir a janela inteira; a contagem
            # natural é (segundos da janela / cadência do tipo).
            pontos = gerar_janela(sensor_id, inicio, agora, limite=10_000_000)
            if pontos:
                self.armazenamento.salvar_pontos_em_lote(sensor_id, pontos)
                total += len(pontos)
        return total

    # -----------------------------------------------------------------
    #  Loop ao vivo
    # -----------------------------------------------------------------
    def iniciar(self):
        if self._thread and self._thread.is_alive():
            return
        self._parar.clear()
        self._thread = threading.Thread(target=self._rodar, daemon=True, name="agendador")
        self._thread.start()

    def parar(self):
        self._parar.set()

    def _rodar(self):
        # Cadência por sensor: gera novo ponto quando passou o intervalo
        # característico do tipo (energia=30s, temp/porta=60s).
        for sid, p in PERFIS.items():
            self._proximo_emit[sid] = time.time() + intervalo_amostragem(p["tipo"])

        while not self._parar.is_set():
            agora_ts = time.time()
            agora_dt = datetime.now(timezone.utc)
            for sensor_id, p in PERFIS.items():
                if agora_ts < self._proximo_emit[sensor_id]:
                    continue
                ponto = gerar_ponto(sensor_id, agora_dt)
                if ponto is not None:
                    ponto = GERENCIADOR.aplicar(sensor_id, ponto, agora_ts)
                if ponto is not None:
                    self.armazenamento.salvar_ponto(sensor_id, ponto)
                # reagenda
                self._proximo_emit[sensor_id] = agora_ts + intervalo_amostragem(p["tipo"])

            # Limpa incidentes expirados de vez em quando
            GERENCIADOR.limpar_expirados()
            self._parar.wait(self.tick_s)
