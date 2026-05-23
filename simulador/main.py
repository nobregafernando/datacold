"""
DataCold · Simulador da API BEM Inteligência.

Sobe um servidor FastAPI que responde aos MESMOS endpoints da API real,
gerando dados sintéticos para os 14 sensores da planta. O front conecta
trocando a constante `urlBase` do ApiBEM (vide README).

Para rodar:

    cd simulador
    python3 -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000

Endpoints públicos (espelham a API BEM):

    GET  /health                     status do simulador
    GET  /api/v1/sensors             catálogo de sensores e grupos
    GET  /api/v1/data?sensor=...     série temporal de um sensor

Endpoints administrativos (controle da simulação):

    GET    /sim/perfil/{sensor}      parâmetros do sensor (faixas, baseline)
    GET    /sim/incidentes           lista incidentes ativos
    POST   /sim/incidente            cria incidente (spike/drift/gap/offline/valor_impossivel)
    DELETE /sim/incidente/{id}       cancela um incidente
    POST   /sim/resetar              apaga o banco e refaz o warm-up
"""

import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from perfis import (
    PERFIS,
    catalogo_sensores,
    catalogo_grupos,
    perfil_de,
    campos_por_tipo,
)
from armazenamento import Armazenamento
from incidentes import GERENCIADOR, TIPOS_VALIDOS
from estado import Agendador


# ---------------------------------------------------------------------
#  Bootstrap
# ---------------------------------------------------------------------
CAMINHO_DB = os.environ.get("DATACOLD_DB", "datacold.db")
TICK_S = int(os.environ.get("DATACOLD_TICK_S", "5"))
WARMUP_HORAS = int(os.environ.get("DATACOLD_WARMUP_HORAS", "168"))  # 7 dias

armazenamento = Armazenamento(CAMINHO_DB)
agendador = Agendador(armazenamento, tick_s=TICK_S)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1) preenche o histórico se vazio
    inseridos = agendador.aquecer_historico(WARMUP_HORAS)
    print(f"[simulador] warm-up: {inseridos} pontos inseridos no banco")
    # 2) inicia o loop que alimenta dados em tempo real
    agendador.iniciar()
    print(f"[simulador] agendador rodando (tick={TICK_S}s)")
    yield
    agendador.parar()


app = FastAPI(
    title="DataCold Simulador",
    description="API simulada que espelha a BEM Inteligência para desenvolvimento local.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS aberto — é simulador local, não tem segredo.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------
#  PÚBLICOS · espelham a API BEM
# ---------------------------------------------------------------------
@app.get("/health")
def health():
    """Status do simulador. Idêntico ao /health da API real."""
    return {
        "status": "ok",
        "demo_mode": True,
        "agora": datetime.now(timezone.utc).isoformat(),
        "tick_s": TICK_S,
        "total_pontos": armazenamento.contar_pontos(),
        "sensores": len(PERFIS),
    }


@app.get("/api/v1/sensors")
def listar_sensores():
    """Catálogo público — usado pelo front pra montar o sidebar."""
    return {
        "sensors": catalogo_sensores(),
        "groups": catalogo_grupos(),
    }


@app.get("/api/v1/data")
def buscar_dados(
    sensor: str = Query(..., description="ID do sensor"),
    start: str = Query("-1h", description="Início da janela. Aceita '-Nh', '-Nm', '-Nd' ou ISO 8601."),
    stop: str = Query("now", description="Fim da janela. 'now' ou ISO 8601, ou relativo."),
    limit: int = Query(1000, ge=1, le=200000, description="Máximo de pontos a retornar."),
):
    """
    Série temporal de um sensor. Mesma assinatura da API real:

        GET /api/v1/data?sensor=extrusora_1&start=-167h&stop=now&limit=20000
    """
    perfil = perfil_de(sensor)
    if not perfil:
        raise HTTPException(status_code=404, detail=f"Sensor '{sensor}' não existe.")

    agora = datetime.now(timezone.utc)
    try:
        ini = _parse_tempo(start, agora)
        fim = _parse_tempo(stop, agora)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if ini > fim:
        raise HTTPException(status_code=400, detail="`start` é posterior a `stop`.")

    pontos = armazenamento.buscar_pontos(sensor, ini, fim, limite=limit)

    return {
        "sensor": sensor,
        "type": perfil["tipo"],
        "count": len(pontos),
        "fields": campos_por_tipo(perfil["tipo"]),
        "window": {"start": start, "stop": stop},
        "points": pontos,
    }


# ---------------------------------------------------------------------
#  ADMIN · controle da simulação
# ---------------------------------------------------------------------
@app.get("/sim/perfil/{sensor}")
def ver_perfil(sensor: str):
    """Retorna parâmetros base do sensor (faixas, baseline, personalidade)."""
    p = perfil_de(sensor)
    if not p:
        raise HTTPException(status_code=404, detail=f"Sensor '{sensor}' não existe.")
    return {
        "id": sensor,
        "label": p["label"],
        "tipo": p["tipo"],
        "grupo": p["grupo"],
        "status": p["status"],
        "personalidade": p["personalidade"],
        "parametros": p["parametros"],
        "cadencia_s": _cadencia_do_tipo(p["tipo"]),
    }


@app.get("/sim/incidentes")
def listar_incidentes(sensor: Optional[str] = None):
    """Lista incidentes ativos (opcionalmente filtrados por sensor)."""
    return {"incidentes": [i.serializar() for i in GERENCIADOR.listar(sensor)]}


class IncidenteRequest(BaseModel):
    sensor: str = Field(..., description="ID do sensor afetado.")
    tipo: str = Field(..., description=f"Um de: {sorted(TIPOS_VALIDOS)}")
    duracao_s: Optional[int] = Field(None, description="Segundos até expirar. None = permanente até DELETE.")
    magnitude: float = Field(0.0, description="Usado por spike (multiplicador, ex: 3.0) e drift (delta no valor).")
    valor: float = Field(0.0, description="Usado por valor_impossivel (valor literal injetado).")
    descricao: str = Field("", description="Texto livre pra você lembrar do porquê.")


@app.post("/sim/incidente")
def criar_incidente(req: IncidenteRequest):
    """
    Injeta uma falha em tempo real. Exemplos práticos no README.
    """
    if req.sensor not in PERFIS:
        raise HTTPException(status_code=404, detail=f"Sensor '{req.sensor}' não existe.")
    try:
        inc = GERENCIADOR.criar(
            sensor_id=req.sensor,
            tipo=req.tipo,
            duracao_s=req.duracao_s,
            magnitude=req.magnitude,
            valor=req.valor,
            descricao=req.descricao,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return inc.serializar()


@app.delete("/sim/incidente/{incidente_id}")
def remover_incidente(incidente_id: str):
    """Cancela um incidente ativo. Retorna 404 se não existe."""
    if not GERENCIADOR.remover(incidente_id):
        raise HTTPException(status_code=404, detail="Incidente não encontrado.")
    return {"removido": incidente_id}


@app.post("/sim/resetar")
def resetar(horas: int = 168):
    """
    Apaga todo o banco e refaz o warm-up. Útil quando você quiser
    voltar pro estado limpo durante uma demo.
    """
    armazenamento.apagar_tudo()
    inseridos = agendador.aquecer_historico(horas)
    return {"apagado": True, "warmup_horas": horas, "pontos_inseridos": inseridos}


# ---------------------------------------------------------------------
#  Helpers
# ---------------------------------------------------------------------
_REGEX_RELATIVO = re.compile(r"^-(\d+(?:\.\d+)?)(s|m|h|d)$")


def _parse_tempo(s: str, agora: datetime) -> datetime:
    """
    Aceita formatos do InfluxDB:
      'now'                → agora UTC
      '-30m' '-1h' '-7d'   → delta antes de agora
      ISO 8601             → datetime literal
    """
    if not s or s == "now":
        return agora
    m = _REGEX_RELATIVO.match(s)
    if m:
        n = float(m.group(1))
        unidade = m.group(2)
        mult = {"s": 1, "m": 60, "h": 3600, "d": 86400}[unidade]
        return agora - timedelta(seconds=n * mult)
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        raise ValueError(
            f"Tempo inválido: '{s}'. Use 'now', relativo (-30m/-1h/-7d) ou ISO 8601."
        )


def _cadencia_do_tipo(tipo: str) -> int:
    from geradores import intervalo_amostragem
    return intervalo_amostragem(tipo)
