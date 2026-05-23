"""
Perfis (parâmetros base) de cada um dos 14 sensores da planta simulada.

Cada perfil define:
- Identificação (id, label, tipo, grupo, status).
- Parâmetros físicos (tensão nominal, corrente nominal, FP base, faixa
  ideal de temperatura, etc) — usados pelos geradores em geradores.py.
- "Personalidade": características/falhas crônicas embutidas no sensor,
  pra que a simulação reflita os achados que o explorador já documenta.

Quando o banco de dados real for plugado em armazenamento.py, este
arquivo continua sendo a fonte da verdade do *catálogo* (resposta de
/api/v1/sensors).
"""

# ---------------------------------------------------------------------
#  Grupos físicos (resposta de /api/v1/sensors → groups)
# ---------------------------------------------------------------------
GRUPOS = [
    {
        "id": "extrusao",
        "label": "Linha de Extrusão",
        "description": "Três extrusoras em paralelo na linha principal de produção de sorvete.",
        "sensors": ["extrusora_1", "extrusora_2", "extrusora_3"],
    },
    {
        "id": "camara_congelados",
        "label": "Câmara de Congelados",
        "description": "Câmara fria do produto acabado (faixa industrial -28 a -18°C).",
        "sensors": ["congelados_compressor", "congelados_temperatura"],
    },
    {
        "id": "camara_estoque",
        "label": "Câmara Fria Estoque",
        "description": "Câmara de matéria-prima refrigerada com dois compressores e controle de porta.",
        "sensors": [
            "estoque_compressor_1",
            "estoque_compressor_2",
            "estoque_temperatura",
            "estoque_porta",
        ],
    },
    {
        "id": "graxaria",
        "label": "Câmara Graxaria",
        "description": "Área de subprodutos, refrigerada. Sensores em modo histórico no momento.",
        "sensors": ["graxaria_energia", "graxaria_temperatura", "graxaria_porta"],
    },
    {
        "id": "externo_campo_grande",
        "label": "Ambiente Externo Campo Grande",
        "description": "Sensor de temperatura ambiente da unidade de Campo Grande/MS.",
        "sensors": ["externo_cg_temperatura"],
    },
    {
        "id": "externo_tres_lagoas",
        "label": "Ambiente Externo Três Lagoas",
        "description": "Sensor de temperatura ambiente da unidade de Três Lagoas/MS.",
        "sensors": ["externo_tl_temperatura"],
    },
]


# ---------------------------------------------------------------------
#  Perfis dos 14 sensores
# ---------------------------------------------------------------------
#  Convenções de parâmetros:
#
#  ENERGIA:
#    tensao_nominal_v       — tensão por fase em V (média esperada)
#    tensao_desvio_v        — desvio padrão da tensão (ruído gaussiano)
#    corrente_nominal_a     — corrente média por fase em A
#    corrente_desvio_a      — desvio padrão da corrente
#    fp_base                — fator de potência médio (-1.0 a 1.0; negativo = fluxo reverso)
#    fp_desvio              — desvio padrão do FP
#    cub_alvo_pct           — desequilíbrio de corrente alvo entre fases (%)
#    drops_por_semana       — quedas bruscas esperadas no período de 7 dias
#    fase_ausente           — None ou letra ("a"/"b") quando o sensor leva fase zerada
#
#  TEMPERATURA:
#    setpoint_c             — alvo central
#    desvio_c               — variação natural (σ)
#    faixa_ideal_min/max    — faixa "boa" pra alertas
#    ciclo_diario           — bool, se ativa ciclo dia/noite
#    amplitude_diaria_c     — amplitude do ciclo dia/noite (apenas se ciclo_diario)
#    sensor_defeituoso      — bool, se gera spikes/leituras impossíveis
#    prob_pico_defeito      — chance de ponto absurdo por amostra
#    prob_valor_impossivel  — chance de leitura tipo -3276°C
#    sobe_apos_porta_c      — quantos °C sobe após abertura de porta no mesmo grupo
#
#  PORTA:
#    aberturas_por_hora     — taxa média Poisson
#    duracao_media_s        — duração média da abertura (exponencial)
#    sinal_analogico        — se True, valor varia 0..N (caso estoque_porta);
#                             se False, valor binário 0/1
#    valor_aberto_max       — máximo do sinal quando aberta (analógico)
# ---------------------------------------------------------------------

PERFIS = {
    # ============ LINHA DE EXTRUSÃO ============
    "extrusora_1": {
        "label": "Extrusora 1",
        "tipo": "energia",
        "grupo": "extrusao",
        "status": "ativo",
        "personalidade": "FP baixo crônico (banco de capacitores queimado). Drops esporádicos por contator.",
        "parametros": {
            "tensao_nominal_v": 124.0,
            "tensao_desvio_v": 1.5,
            "corrente_nominal_a": 93.0,
            "corrente_desvio_a": 12.0,
            "fp_base": 0.70,
            "fp_desvio": 0.05,
            "cub_alvo_pct": 1.7,
            "drops_por_semana": 12,
            "fase_ausente": None,
        },
    },
    "extrusora_2": {
        "label": "Extrusora 2",
        "tipo": "energia",
        "grupo": "extrusao",
        "status": "ativo",
        "personalidade": "FP muito baixo (0,45). Desequilíbrio NEMA moderado. Muitos drops de contator.",
        "parametros": {
            "tensao_nominal_v": 124.0,
            "tensao_desvio_v": 1.5,
            "corrente_nominal_a": 86.0,
            "corrente_desvio_a": 10.0,
            "fp_base": 0.45,
            "fp_desvio": 0.05,
            "cub_alvo_pct": 6.6,
            "drops_por_semana": 29,
            "fase_ausente": None,
        },
    },
    "extrusora_3": {
        "label": "Extrusora 3",
        "tipo": "energia",
        "grupo": "extrusao",
        "status": "ativo",
        "personalidade": "Fluxo reverso (TCs invertidos) — FP e potência negativos. CUB moderado.",
        "parametros": {
            "tensao_nominal_v": 124.0,
            "tensao_desvio_v": 1.5,
            "corrente_nominal_a": 64.0,
            "corrente_desvio_a": 8.0,
            "fp_base": -0.07,
            "fp_desvio": 0.04,
            "cub_alvo_pct": 5.9,
            "drops_por_semana": 0,
            "fase_ausente": None,
        },
    },

    # ============ CÂMARA DE CONGELADOS ============
    "congelados_compressor": {
        "label": "Compressor de Refrigeração",
        "tipo": "energia",
        "grupo": "camara_congelados",
        "status": "ativo",
        "personalidade": "TC invertido (FP negativo). Desequilíbrio severo entre fases (>10%).",
        "parametros": {
            "tensao_nominal_v": 124.0,
            "tensao_desvio_v": 0.6,
            "corrente_nominal_a": 93.0,
            "corrente_desvio_a": 14.0,
            "fp_base": -0.43,
            "fp_desvio": 0.05,
            "cub_alvo_pct": 11.5,
            "drops_por_semana": 0,
            "fase_ausente": None,
        },
    },
    "congelados_temperatura": {
        "label": "Temperatura Interna",
        "tipo": "temperatura",
        "grupo": "camara_congelados",
        "status": "ativo",
        "personalidade": "FALHA REAL: vive em -8,6°C (alvo -22°C). Sensor com defeito gera spikes até +85°C.",
        "parametros": {
            "setpoint_c": -22.0,
            "media_real_c": -8.6,
            "desvio_c": 1.5,
            "faixa_ideal_min": -28.0,
            "faixa_ideal_max": -18.0,
            "ciclo_diario": False,
            "amplitude_diaria_c": 0.0,
            "sensor_defeituoso": True,
            "prob_pico_defeito": 0.02,
            "prob_valor_impossivel": 0.0,
            "sobe_apos_porta_c": 0.0,
        },
    },

    # ============ CÂMARA FRIA ESTOQUE ============
    "estoque_compressor_1": {
        "label": "Motor do Compressor 1",
        "tipo": "energia",
        "grupo": "camara_estoque",
        "status": "ativo",
        "personalidade": "TC invertido. Desequilíbrio NEMA crítico (22%). VUB também alto (>2%).",
        "parametros": {
            "tensao_nominal_v": 221.0,
            "tensao_desvio_v": 4.5,
            "corrente_nominal_a": 100.0,
            "corrente_desvio_a": 32.0,
            "fp_base": -0.76,
            "fp_desvio": 0.06,
            "cub_alvo_pct": 22.2,
            "drops_por_semana": 15,
            "fase_ausente": None,
        },
    },
    "estoque_compressor_2": {
        "label": "Motor do Compressor 2",
        "tipo": "energia",
        "grupo": "camara_estoque",
        "status": "ativo",
        "personalidade": "TC invertido. Volatilidade crescente (short-cycling) indica falha mecânica.",
        "parametros": {
            "tensao_nominal_v": 223.0,
            "tensao_desvio_v": 1.8,
            "corrente_nominal_a": 60.0,
            "corrente_desvio_a": 18.0,
            "fp_base": -0.69,
            "fp_desvio": 0.06,
            "cub_alvo_pct": 17.9,
            "drops_por_semana": 11,
            "fase_ausente": None,
        },
    },
    "estoque_temperatura": {
        "label": "Temperatura Interna da Câmara",
        "tipo": "temperatura",
        "grupo": "camara_estoque",
        "status": "ativo",
        "personalidade": "Faixa -4 a +4°C, baseline ~-3,9°C. Sobe ~+0,5°C após cada abertura de porta.",
        "parametros": {
            "setpoint_c": -3.9,
            "media_real_c": -3.9,
            "desvio_c": 2.1,
            "faixa_ideal_min": -4.0,
            "faixa_ideal_max": 4.0,
            "ciclo_diario": False,
            "amplitude_diaria_c": 0.0,
            "sensor_defeituoso": False,
            "prob_pico_defeito": 0.0,
            "prob_valor_impossivel": 0.0,
            "sobe_apos_porta_c": 0.5,
        },
    },
    "estoque_porta": {
        "label": "Abertura de Porta",
        "tipo": "porta",
        "grupo": "camara_estoque",
        "status": "ativo",
        "personalidade": "Uso intenso em horário comercial, com algumas aberturas demoradas. ~30% do tempo aberta.",
        "parametros": {
            # Ajustado pra ficar visível em janela curta (1h):
            # 0.6 aberturas/hora × duração média 1800s ≈ porta aberta ~30% do tempo.
            "aberturas_por_hora": 0.6,
            "duracao_media_s": 1800,
            "sinal_analogico": True,
            "valor_aberto_max": 224.0,
        },
    },

    # ============ CÂMARA GRAXARIA (histórica) ============
    "graxaria_energia": {
        "label": "Energia",
        "tipo": "energia",
        "grupo": "graxaria",
        "status": "historico",
        "personalidade": "CRÍTICO: fases A e B com tensão ZERO — fase ausente. Equipamento operando monofásico.",
        "parametros": {
            "tensao_nominal_v": 219.0,
            "tensao_desvio_v": 2.0,
            "corrente_nominal_a": 173.0,
            "corrente_desvio_a": 20.0,
            "fp_base": 0.37,
            "fp_desvio": 0.10,
            "cub_alvo_pct": 1.7,
            "drops_por_semana": 0,
            "fase_ausente": "ab",  # zerar fase A e B
        },
    },
    "graxaria_temperatura": {
        "label": "Temperatura",
        "tipo": "temperatura",
        "grupo": "graxaria",
        "status": "historico",
        "personalidade": "Câmara estável em -9,2°C (faixa -10 a +4). Variação natural.",
        "parametros": {
            "setpoint_c": -9.2,
            "media_real_c": -9.2,
            "desvio_c": 3.9,
            "faixa_ideal_min": -10.0,
            "faixa_ideal_max": 4.0,
            "ciclo_diario": False,
            "amplitude_diaria_c": 0.0,
            "sensor_defeituoso": False,
            "prob_pico_defeito": 0.0,
            "prob_valor_impossivel": 0.0,
            "sobe_apos_porta_c": 0.0,
        },
    },
    "graxaria_porta": {
        "label": "Abertura de Porta",
        "tipo": "porta",
        "grupo": "graxaria",
        "status": "historico",
        "personalidade": "Padrão evolutivo: 11→46 aberturas entre as duas metades (+292%).",
        "parametros": {
            "aberturas_por_hora": 0.6,
            "duracao_media_s": 900,
            "sinal_analogico": False,
            "valor_aberto_max": 1.0,
        },
    },

    # ============ AMBIENTE EXTERNO ============
    "externo_cg_temperatura": {
        "label": "Temperatura Ambiente",
        "tipo": "temperatura",
        "grupo": "externo_campo_grande",
        "status": "ativo",
        "personalidade": "Sensor ambiente — ciclo dia/noite natural (~13 a 30°C). Sem faixa controlada.",
        "parametros": {
            "setpoint_c": 21.5,
            "media_real_c": 21.5,
            "desvio_c": 1.2,
            "faixa_ideal_min": None,
            "faixa_ideal_max": None,
            "ciclo_diario": True,
            "amplitude_diaria_c": 8.0,
            "sensor_defeituoso": False,
            "prob_pico_defeito": 0.0,
            "prob_valor_impossivel": 0.0,
            "sobe_apos_porta_c": 0.0,
        },
    },
    "externo_tl_temperatura": {
        "label": "Temperatura Ambiente",
        "tipo": "temperatura",
        "grupo": "externo_tres_lagoas",
        "status": "historico",
        "personalidade": "Sensor com DEFEITO: leituras impossíveis ocasionais (-3276°C). Médias reais ~13°C.",
        "parametros": {
            "setpoint_c": 13.0,
            "media_real_c": 13.0,
            "desvio_c": 4.0,
            "faixa_ideal_min": None,
            "faixa_ideal_max": None,
            "ciclo_diario": True,
            "amplitude_diaria_c": 10.0,
            "sensor_defeituoso": True,
            "prob_pico_defeito": 0.0,
            "prob_valor_impossivel": 0.003,
            "sobe_apos_porta_c": 0.0,
        },
    },
}


# ---------------------------------------------------------------------
#  Helpers
# ---------------------------------------------------------------------
def catalogo_sensores():
    """Formato exato esperado pelo front em /api/v1/sensors → sensors[]."""
    out = []
    for sid, p in PERFIS.items():
        out.append({
            "id": sid,
            "label": p["label"],
            "type": p["tipo"],
            "group": p["grupo"],
            "status": p["status"],
        })
    return out


def catalogo_grupos():
    """Cópia rasa dos grupos pra resposta de /api/v1/sensors → groups[]."""
    return [dict(g) for g in GRUPOS]


def perfil_de(sensor_id):
    """Retorna o perfil completo ou None se id desconhecido."""
    return PERFIS.get(sensor_id)


def campos_por_tipo(tipo):
    """Lista de campos numéricos retornados em cada ponto, por tipo."""
    if tipo == "energia":
        return [
            "corrente_fase_a", "corrente_fase_b", "corrente_fase_c",
            "tensao_fase_a",   "tensao_fase_b",   "tensao_fase_c",
            "fator_potencia_a", "fator_potencia_b", "fator_potencia_c",
        ]
    if tipo == "temperatura":
        return ["temperatura"]
    if tipo == "porta":
        return ["abertura_porta"]
    return []
