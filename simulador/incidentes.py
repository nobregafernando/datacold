"""
Modos de falha injetáveis em tempo real.

Cada incidente é uma instrução temporária para alterar/suprimir os
pontos gerados de um sensor. São criados via POST /sim/incidente e
sobrevivem em memória (não persistem entre restarts — proposital, pra
não envenenar o histórico).

Tipos suportados:

- spike            — multiplica o valor principal por `magnitude`
- drift            — soma `magnitude` ao valor principal (deriva linear)
- gap              — engole o ponto (retorna None → não vai pro banco)
- offline          — equivalente ao gap, mas semanticamente "sensor parou"
- valor_impossivel — substitui pelo valor literal em `valor`
"""

import time
import uuid
from dataclasses import dataclass, field, asdict
from threading import Lock
from typing import Optional, Dict, List


TIPOS_VALIDOS = {"spike", "drift", "gap", "offline", "valor_impossivel"}


@dataclass
class Incidente:
    id: str
    sensor_id: str
    tipo: str
    inicio_ts: float            # epoch seconds (UTC)
    fim_ts: Optional[float]     # None = enquanto não removido manualmente
    magnitude: float = 0.0      # usado por spike (multiplicador) e drift (delta)
    valor: float = 0.0          # usado por valor_impossivel
    descricao: str = ""

    def ativo_em(self, agora_epoch: float) -> bool:
        if agora_epoch < self.inicio_ts:
            return False
        if self.fim_ts is None:
            return True
        return agora_epoch <= self.fim_ts

    def serializar(self) -> dict:
        d = asdict(self)
        d["inicio"] = _iso(self.inicio_ts)
        d["fim"] = _iso(self.fim_ts) if self.fim_ts else None
        return d


class GerenciadorIncidentes:
    """
    Estado global em memória. Thread-safe.
    """

    def __init__(self):
        self._por_id: Dict[str, Incidente] = {}
        self._lock = Lock()

    # -----------------------------------------------------------------
    #  CRUD
    # -----------------------------------------------------------------
    def criar(
        self,
        sensor_id: str,
        tipo: str,
        duracao_s: Optional[int] = None,
        magnitude: float = 0.0,
        valor: float = 0.0,
        descricao: str = "",
    ) -> Incidente:
        if tipo not in TIPOS_VALIDOS:
            raise ValueError(f"Tipo inválido. Use um de: {sorted(TIPOS_VALIDOS)}")
        agora = time.time()
        fim = agora + duracao_s if duracao_s and duracao_s > 0 else None
        inc = Incidente(
            id=str(uuid.uuid4())[:8],
            sensor_id=sensor_id,
            tipo=tipo,
            inicio_ts=agora,
            fim_ts=fim,
            magnitude=magnitude,
            valor=valor,
            descricao=descricao,
        )
        with self._lock:
            self._por_id[inc.id] = inc
        return inc

    def remover(self, incidente_id: str) -> bool:
        with self._lock:
            return self._por_id.pop(incidente_id, None) is not None

    def listar(self, sensor_id: Optional[str] = None) -> List[Incidente]:
        agora = time.time()
        with self._lock:
            todos = list(self._por_id.values())
        # também limpa expirados pra resposta enxuta
        ativos = [i for i in todos if i.ativo_em(agora)]
        if sensor_id:
            ativos = [i for i in ativos if i.sensor_id == sensor_id]
        return ativos

    def limpar_expirados(self):
        agora = time.time()
        with self._lock:
            self._por_id = {
                iid: i for iid, i in self._por_id.items() if i.ativo_em(agora)
            }

    # -----------------------------------------------------------------
    #  Aplicação
    # -----------------------------------------------------------------
    def aplicar(self, sensor_id: str, ponto: dict, agora_epoch: float) -> Optional[dict]:
        """
        Aplica todos os incidentes ativos do sensor sobre o ponto.
        Retorna o ponto modificado ou None se algum incidente "engoliu"
        (gap/offline/etc).
        """
        ativos = [
            i for i in self.listar(sensor_id) if i.ativo_em(agora_epoch)
        ]
        if not ativos:
            return ponto

        # Determina o "valor principal" pra cada tipo de sensor.
        # Energia: aplicar no FP e na corrente; temperatura: na temp;
        # porta: no sinal.
        for inc in ativos:
            if inc.tipo in ("gap", "offline"):
                return None
            if inc.tipo == "valor_impossivel":
                _aplicar_em_campos_principais(ponto, lambda _: inc.valor)
            elif inc.tipo == "spike":
                _aplicar_em_campos_principais(ponto, lambda v: v * inc.magnitude)
            elif inc.tipo == "drift":
                _aplicar_em_campos_principais(ponto, lambda v: v + inc.magnitude)

        return ponto


# ---------------------------------------------------------------------
#  Helpers
# ---------------------------------------------------------------------
def _aplicar_em_campos_principais(ponto: dict, fn):
    """
    Modifica in-place os campos "principais" do ponto.
    Mantém o `time` intacto. Funciona para os 3 tipos.
    """
    for chave, valor in list(ponto.items()):
        if chave == "time":
            continue
        if isinstance(valor, (int, float)):
            try:
                ponto[chave] = float(fn(valor))
            except Exception:
                pass


def _iso(epoch: Optional[float]) -> Optional[str]:
    if epoch is None:
        return None
    from datetime import datetime, timezone
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# Singleton global, importado por main.py e estado.py
GERENCIADOR = GerenciadorIncidentes()
