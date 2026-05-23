"""
Geradores de séries temporais por tipo de sensor.

Princípio: cada função `gerar_ponto(sensor_id, ts)` é (quase) PURA —
chamada duas vezes com a mesma combinação devolve o mesmo valor. Isso
permite gerar histórico em batch e ao vivo de forma consistente.

Estratégia de modelagem (pra dado parecer "vivo", não ruído branco):

- **Energia (motor industrial)**: modelo de operação por horário + ciclo
  de carga (compressor liga/desliga) + picos de partida esporádicos
  (5-7× a corrente nominal por uma amostra). Implementado como soma
  de oscilações em múltiplas frequências mais ruído curto.

- **Temperatura (câmara controlada)**: modelo de TERMOSTATO em
  dente-de-serra. A temperatura sobe linearmente (compressor desligado,
  ganho térmico) e cai linearmente (compressor ligado), oscilando
  entre os limites da faixa ideal. Sensor defeituoso injeta spikes.

- **Temperatura (ambiente externo)**: cossenoide diária (24h) + maré
  semanal (ruído de baixa frequência) + ruído curto.

- **Porta**: eventos por dia gerados via Poisson, com janelas de
  duração exponencial. Frequência maior em horário comercial.

Tudo determinístico em função de `(sensor_id, timestamp)`.
"""

import math
import random
from datetime import datetime, timezone, timedelta
from typing import Optional

from perfis import PERFIS, campos_por_tipo


# ---------------------------------------------------------------------
#  Cadência de amostragem por tipo (segundos entre pontos)
# ---------------------------------------------------------------------
INTERVALO_S = {
    "energia": 30,
    "temperatura": 60,
    "porta": 60,
}


def intervalo_amostragem(tipo: str) -> int:
    return INTERVALO_S.get(tipo, 60)


# ---------------------------------------------------------------------
#  API pública
# ---------------------------------------------------------------------
def gerar_ponto(sensor_id: str, ts: datetime) -> Optional[dict]:
    perfil = PERFIS.get(sensor_id)
    if not perfil:
        return None

    # Sensores históricos só geram para o período "antigo" (>7d atrás).
    if perfil["status"] == "historico":
        agora = datetime.now(timezone.utc)
        if ts > agora - timedelta(hours=167):
            return None

    tipo = perfil["tipo"]
    if tipo == "energia":
        return _gerar_energia(sensor_id, ts, perfil)
    if tipo == "temperatura":
        return _gerar_temperatura(sensor_id, ts, perfil)
    if tipo == "porta":
        return _gerar_porta(sensor_id, ts, perfil)
    return None


def gerar_janela(sensor_id: str, inicio: datetime, fim: datetime, limite=20000):
    perfil = PERFIS.get(sensor_id)
    if not perfil:
        return []
    passo = intervalo_amostragem(perfil["tipo"])
    pontos = []
    t = inicio
    while t <= fim and len(pontos) < limite:
        p = gerar_ponto(sensor_id, t)
        if p is not None:
            pontos.append(p)
        t = t + timedelta(seconds=passo)
    return pontos


# ---------------------------------------------------------------------
#  Núcleo determinístico
# ---------------------------------------------------------------------
def _rnd(sensor_id: str, ts: datetime, intervalo_s: int) -> random.Random:
    """RNG semeado por (sensor, bucket de tempo). Reproduzível."""
    bucket = int(ts.timestamp() // intervalo_s)
    return random.Random(f"{sensor_id}:{bucket}")


def _rnd_janela(sensor_id: str, ts: datetime, janela_s: int, etiqueta: str = "") -> random.Random:
    """RNG semeado por janela maior (ex: 10min, 1h) — usado pra eventos esparsos."""
    bucket = int(ts.timestamp() // janela_s)
    return random.Random(f"{sensor_id}:{etiqueta}:{bucket}")


def _iso(ts: datetime) -> str:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


# ---------------------------------------------------------------------
#  Funções analíticas (puras em ts)
# ---------------------------------------------------------------------
def _fator_dia_noite(ts: datetime) -> float:
    """Cossenoide 24h. Pico do calor às 18h UTC (~15h Brasília). Range 0..1."""
    h = ts.hour + ts.minute / 60 + ts.second / 3600
    return math.cos((h - 18) * math.pi / 12) * 0.5 + 0.5


def _fator_operacao_industrial(ts: datetime) -> float:
    """
    Carga típica de planta 24/7 com pico em horário comercial.
    Range 0.35 (madrugada) a 1.0 (tarde). Curva suave.
    """
    h_local = (ts.hour + ts.minute / 60 - 3) % 24   # UTC → Brasília
    # senoide deslocada com mínimo às ~3h, máximo às ~15h
    return 0.675 + 0.325 * math.sin((h_local - 9) * math.pi / 12)


def _ondulacao_compressor(ts: datetime, periodo_s: float = 600) -> float:
    """
    Ondulação de 'carga subindo/descendo' típica de ciclo de
    compressor de refrigeração. Range -1..+1.
    """
    fase = (ts.timestamp() % periodo_s) / periodo_s
    return math.sin(2 * math.pi * fase)


def _sawtooth_termostato(ts: datetime, periodo_s: float) -> float:
    """
    Dente-de-serra triangular pra modelar termostato.
    Sobe 50% do período (compressor off, temp subindo),
    desce 50% (compressor on, temp caindo). Range -1..+1.
    """
    fase = (ts.timestamp() % periodo_s) / periodo_s
    return 4 * fase - 1 if fase < 0.5 else 3 - 4 * fase


def _ruido_colorido(rng_atual: random.Random, rng_anterior: random.Random,
                    sigma: float, persistencia: float = 0.7) -> float:
    """
    Ruído com leve autocorrelação (parecido com browniano amortecido).
    Mistura uma amostra "lenta" (janela anterior) com uma "rápida" (atual).
    """
    lento = rng_anterior.gauss(0, sigma)
    rapido = rng_atual.gauss(0, sigma)
    return persistencia * lento + (1 - persistencia) * rapido


# =====================================================================
#  ENERGIA — motor industrial com ciclo + partidas
# =====================================================================
def _gerar_energia(sensor_id: str, ts: datetime, perfil: dict) -> dict:
    p = perfil["parametros"]
    rng = _rnd(sensor_id, ts, INTERVALO_S["energia"])

    # ---- modulação operacional (carga vai subindo/descendo no dia) ----
    if perfil["grupo"].startswith("camara") or perfil["grupo"] == "graxaria":
        # Compressores: trabalham MAIS no calor (compensam ganho térmico)
        op = 0.55 + 0.45 * _fator_dia_noite(ts)
    else:
        # Extrusoras: operação industrial padrão
        op = _fator_operacao_industrial(ts)

    # Ondulação de "ciclo de compressor" (período de 10 min) — visível no gráfico
    ondula = 0.08 * _ondulacao_compressor(ts, periodo_s=600)
    op = max(0.0, op + ondula)

    # ---- pico de partida esporádico (probabilidade ~1 a cada 30 min) ----
    # Determinístico por janela de 30 min
    rng_partida = _rnd_janela(sensor_id, ts, 1800, "partida")
    multiplicador_partida = 1.0
    if rng_partida.random() < 0.4:
        # essa janela tem uma partida; em que segundo dela?
        seg_partida = int(rng_partida.random() * 1800)
        seg_atual = int(ts.timestamp()) % 1800
        delta = abs(seg_atual - seg_partida)
        if delta <= INTERVALO_S["energia"]:
            multiplicador_partida = rng_partida.uniform(5.0, 7.0)
        elif delta <= INTERVALO_S["energia"] * 3:
            multiplicador_partida = rng_partida.uniform(2.0, 3.5)  # decay

    # ---- tensões por fase ----
    base_v = p["tensao_nominal_v"]
    sigma_v = p["tensao_desvio_v"]
    fases_v = [
        rng.gauss(base_v, sigma_v),
        rng.gauss(base_v, sigma_v),
        rng.gauss(base_v, sigma_v),
    ]

    # fase ausente (graxaria_energia)
    ausente = p.get("fase_ausente") or ""
    for i, letra in enumerate("abc"):
        if letra in ausente:
            fases_v[i] = 0.0

    # ---- correntes com CUB alvo ----
    i_base = p["corrente_nominal_a"] * op * multiplicador_partida
    i_sigma = p["corrente_desvio_a"] * (0.3 if multiplicador_partida > 2 else 1.0)
    cub_pct = p["cub_alvo_pct"]
    multipliers = [1.0 - cub_pct / 100, 1.0, 1.0 + cub_pct / 100]
    rng.shuffle(multipliers)
    correntes = [
        max(0.0, rng.gauss(i_base * multipliers[i], i_sigma))
        for i in range(3)
    ]
    for i, letra in enumerate("abc"):
        if letra in ausente:
            correntes[i] = 0.0

    # ---- fator de potência ----
    fp_base = p["fp_base"]
    fp_sigma = p["fp_desvio"]
    fps = [_clip_fp(rng.gauss(fp_base, fp_sigma)) for _ in range(3)]

    # ---- drops esporádicos (contator/proteção atuando) ----
    drops_semana = p["drops_por_semana"]
    if drops_semana > 0:
        # ~drops_semana eventos / 20160 amostras semanais
        if rng.random() < (drops_semana / 20160):
            correntes = [c * 0.01 for c in correntes]

    return {
        "time": _iso(ts),
        "corrente_fase_a": round(correntes[0], 2),
        "corrente_fase_b": round(correntes[1], 2),
        "corrente_fase_c": round(correntes[2], 2),
        "tensao_fase_a":   round(fases_v[0], 2),
        "tensao_fase_b":   round(fases_v[1], 2),
        "tensao_fase_c":   round(fases_v[2], 2),
        "fator_potencia_a": round(fps[0], 3),
        "fator_potencia_b": round(fps[1], 3),
        "fator_potencia_c": round(fps[2], 3),
    }


def _clip_fp(v: float) -> float:
    if v > 1.0:  return 1.0
    if v < -1.0: return -1.0
    return v


# =====================================================================
#  TEMPERATURA — termostato em dente-de-serra + ambiente cíclico
# =====================================================================
def _gerar_temperatura(sensor_id: str, ts: datetime, perfil: dict) -> dict:
    p = perfil["parametros"]
    rng = _rnd(sensor_id, ts, INTERVALO_S["temperatura"])

    if p.get("ciclo_diario"):
        # ------- SENSOR AMBIENTE -------
        # cossenoide diária + leve maré semanal + ruído colorido
        base = p["setpoint_c"]
        amp = p["amplitude_diaria_c"] / 2
        diario = amp * (2 * _fator_dia_noite(ts) - 1)
        # ruído colorido (autocorrelado) — sensação de variação "natural"
        rng_anterior = _rnd(sensor_id, ts - timedelta(minutes=10), INTERVALO_S["temperatura"])
        ruido = _ruido_colorido(rng, rng_anterior, sigma=p["desvio_c"], persistencia=0.6)
        # maré semanal (frente fria/quente)
        sem = math.sin(ts.timestamp() / (86400 * 3.5)) * (p["desvio_c"] * 0.5)
        valor = base + diario + ruido + sem
    else:
        # ------- CÂMARA (termostato dente-de-serra) -------
        centro = p["media_real_c"]
        # Amplitude da oscilação do termostato: meia faixa, no máximo 3°C
        # Se a média real está fora da faixa ideal (caso congelados em -8°C),
        # mantém a amplitude pequena (defeito real: equipamento não chega lá).
        f_min = p.get("faixa_ideal_min")
        f_max = p.get("faixa_ideal_max")
        if f_min is not None and f_max is not None and f_min <= centro <= f_max:
            amp = min((f_max - f_min) / 4, 3.0)
        else:
            amp = p["desvio_c"] / 2
        # Período do ciclo: 15 min em câmara fria comum, 30 min em congelados
        periodo_s = 1800 if "congelados" in sensor_id else 900
        oscilacao = amp * _sawtooth_termostato(ts, periodo_s)
        # ruído curto sobreposto
        ruido = rng.gauss(0, p["desvio_c"] * 0.4)
        valor = centro + oscilacao + ruido

    # ---- sensor defeituoso ----
    if p.get("sensor_defeituoso"):
        # spike para +85°C ocasional
        if rng.random() < p.get("prob_pico_defeito", 0):
            valor = 85.0
        # leitura impossível tipo termopar com cabo solto
        if rng.random() < p.get("prob_valor_impossivel", 0):
            valor = -3276.8

    return {
        "time": _iso(ts),
        "temperatura": round(valor, 2),
    }


# =====================================================================
#  PORTA — eventos por dia (Poisson) com janelas operacionais
# =====================================================================
def _gerar_porta(sensor_id: str, ts: datetime, perfil: dict) -> dict:
    p = perfil["parametros"]
    aberturas_h = p["aberturas_por_hora"]
    duracao_media = p["duracao_media_s"]
    analogico = p.get("sinal_analogico", False)
    maximo = p.get("valor_aberto_max", 1.0)

    # Eventos do dia, semeados pela data (idênticos sempre que perguntar).
    dia = ts.date().isoformat()
    rng_dia = random.Random(f"{sensor_id}:porta:{dia}")
    n_eventos = _poisson(rng_dia, aberturas_h * 24)

    eventos = []
    for _ in range(n_eventos):
        # Aberturas concentradas em horário comercial (Brasília 8h-20h)
        # ⇒ horas UTC 11..23. Sorteia bias triangular nessa janela.
        if rng_dia.random() < 0.75:
            h = 11 + rng_dia.triangular(0, 12, 6)
        else:
            h = rng_dia.random() * 24
        dur = rng_dia.expovariate(1 / duracao_media) if duracao_media > 0 else 0
        inicio_dt = datetime.combine(
            ts.date(), datetime.min.time(), tzinfo=timezone.utc
        ) + timedelta(hours=h)
        fim_dt = inicio_dt + timedelta(seconds=dur)
        eventos.append((inicio_dt, fim_dt))

    aberto = any(ini <= ts <= fim for (ini, fim) in eventos)
    if aberto:
        if analogico:
            rng_p = _rnd(sensor_id, ts, INTERVALO_S["porta"])
            # valor "ruidoso" entre 0 e máximo (replica o sinal não-binário
            # observado em estoque_porta na API real)
            valor = max(0.0, min(maximo, rng_p.gauss(maximo * 0.7, maximo * 0.15)))
        else:
            valor = float(maximo)
    else:
        valor = 0.0

    return {
        "time": _iso(ts),
        "abertura_porta": round(valor, 2),
    }


def _poisson(rng, lam):
    """Amostra Knuth — rápido pra lambda pequeno (nossos casos: 1 a 15)."""
    L = math.exp(-lam)
    k = 0
    pp = 1.0
    while True:
        k += 1
        pp *= rng.random()
        if pp <= L:
            return k - 1
