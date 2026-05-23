# DataCold · Simulador da API BEM

Servidor local em Python (FastAPI + SQLite) que **espelha os endpoints da
API BEM Inteligência** e gera dados sintéticos para os 14 sensores da
planta, alimentando o banco sozinho em tempo real.

Você usa o mesmo front (`paginas/admin/...`, `estudos/explorador-api.html`)
apontando pra este servidor — nada na lógica do front muda.

---

## Como rodar

```bash
cd simulador
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Na primeira execução o servidor gera **7 dias de histórico** (~160k pontos)
e grava no `datacold.db`. Demora ~3 segundos. Depois, o agendador acorda
a cada 5s e grava o ponto atual de cada sensor.

> Se a porta 8000 estiver ocupada (`address already in use`), troque
> para outra: `--port 8001` (e ajuste a URL no localStorage abaixo).

Variáveis de ambiente opcionais:

| Variável | Default | O que faz |
|---|---|---|
| `DATACOLD_DB` | `datacold.db` | Caminho do SQLite. |
| `DATACOLD_TICK_S` | `5` | Frequência do agendador (segundos entre verificações). |
| `DATACOLD_WARMUP_HORAS` | `168` | Tamanho do warm-up histórico (em horas). |

Docs interativas geradas pelo FastAPI: <http://127.0.0.1:8000/docs>

---

## Conectar o front

No console do navegador (com a página DataCold aberta):

```js
localStorage.setItem("datacold_api_url", "http://127.0.0.1:8000");
location.reload();
```

Pra voltar pra API real:

```js
localStorage.removeItem("datacold_api_url");
location.reload();
```

Quando o `ApiBEM.js` for atualizado (próximo passo, ver checklist no final),
isso já está pronto. Por enquanto, edite a constante `URL_PADRAO` no
arquivo se preferir.

---

## Endpoints públicos (espelham a API BEM)

### `GET /health`

```bash
curl http://127.0.0.1:8000/health
```

```json
{
  "status": "ok",
  "demo_mode": true,
  "agora": "2026-05-23T14:30:12.345678+00:00",
  "tick_s": 5,
  "total_pontos": 280123,
  "sensores": 14
}
```

### `GET /api/v1/sensors`

Catálogo completo dos 14 sensores + 6 grupos.

```bash
curl http://127.0.0.1:8000/api/v1/sensors | jq
```

Resposta resumida:

```json
{
  "sensors": [
    {"id": "extrusora_1", "label": "Extrusora 1", "type": "energia", "group": "extrusao", "status": "ativo"},
    {"id": "congelados_temperatura", "label": "Temperatura Interna", "type": "temperatura", "group": "camara_congelados", "status": "ativo"}
    // ... 12 a mais
  ],
  "groups": [
    {"id": "extrusao", "label": "Linha de Extrusão", "description": "...", "sensors": ["extrusora_1", "extrusora_2", "extrusora_3"]}
    // ... 5 a mais
  ]
}
```

### `GET /api/v1/data`

A série temporal. Mesmos parâmetros da BEM real.

```bash
# Últimos 60 min da extrusora 1
curl "http://127.0.0.1:8000/api/v1/data?sensor=extrusora_1&start=-1h&stop=now&limit=1000" | jq

# Sete dias inteiros (limite máximo da BEM)
curl "http://127.0.0.1:8000/api/v1/data?sensor=congelados_temperatura&start=-167h&stop=now&limit=20000" | jq

# Janela ISO explícita
curl "http://127.0.0.1:8000/api/v1/data?sensor=extrusora_1&start=2026-05-20T00:00:00Z&stop=2026-05-21T00:00:00Z"
```

Formato da resposta:

```json
{
  "sensor": "extrusora_1",
  "type": "energia",
  "count": 3360,
  "fields": [
    "corrente_fase_a", "corrente_fase_b", "corrente_fase_c",
    "tensao_fase_a",   "tensao_fase_b",   "tensao_fase_c",
    "fator_potencia_a", "fator_potencia_b", "fator_potencia_c"
  ],
  "window": {"start": "-1h", "stop": "now"},
  "points": [
    {
      "time": "2026-05-23T13:30:00.000000Z",
      "corrente_fase_a": 91.2, "corrente_fase_b": 94.5, "corrente_fase_c": 94.8,
      "tensao_fase_a":   123.1, "tensao_fase_b":   124.7, "tensao_fase_c":   124.2,
      "fator_potencia_a": 0.71, "fator_potencia_b": 0.69, "fator_potencia_c": 0.73
    }
    // ...
  ]
}
```

**Formato de tempo aceito** (start/stop):
- `now` — agora UTC
- `-30m`, `-1h`, `-6h`, `-167h`, `-7d` — relativo (antes de agora)
- `2026-05-23T13:00:00Z` — ISO 8601 explícito

---

## Endpoints administrativos (controle da simulação)

### `GET /sim/perfil/{sensor}` — ver parâmetros do sensor

```bash
curl http://127.0.0.1:8000/sim/perfil/congelados_temperatura | jq
```

```json
{
  "id": "congelados_temperatura",
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
    "sensor_defeituoso": true,
    "prob_pico_defeito": 0.02
  },
  "cadencia_s": 60
}
```

### `GET /sim/incidentes` — listar incidentes ativos

```bash
curl http://127.0.0.1:8000/sim/incidentes | jq
curl "http://127.0.0.1:8000/sim/incidentes?sensor=extrusora_1" | jq
```

### `POST /sim/incidente` — injetar uma falha

Body JSON:

| Campo | Tipo | Obrig. | Descrição |
|---|---|---|---|
| `sensor` | string | sim | ID do sensor (ex: `extrusora_1`) |
| `tipo` | string | sim | `spike`, `drift`, `gap`, `offline` ou `valor_impossivel` |
| `duracao_s` | int | não | Segundos até expirar. `null`/omitido = permanente até DELETE. |
| `magnitude` | float | depende | `spike`: multiplicador (ex: `3.0` triplica). `drift`: delta somado. |
| `valor` | float | depende | `valor_impossivel`: valor literal injetado. |
| `descricao` | string | não | Texto livre. |

**Exemplos práticos:**

```bash
# 1) Pico de 3x na corrente da extrusora 1 por 60 segundos
curl -X POST http://127.0.0.1:8000/sim/incidente \
  -H "Content-Type: application/json" \
  -d '{"sensor":"extrusora_1","tipo":"spike","magnitude":3.0,"duracao_s":60,"descricao":"demo pico"}'

# 2) Derretimento progressivo na câmara de congelados (sobe +5°C por 5 min)
curl -X POST http://127.0.0.1:8000/sim/incidente \
  -H "Content-Type: application/json" \
  -d '{"sensor":"congelados_temperatura","tipo":"drift","magnitude":5.0,"duracao_s":300}'

# 3) Sensor sai do ar por 2 minutos (silêncio total)
curl -X POST http://127.0.0.1:8000/sim/incidente \
  -H "Content-Type: application/json" \
  -d '{"sensor":"estoque_compressor_1","tipo":"offline","duracao_s":120}'

# 4) Leitura impossível injetada por 30s (testa detector de outlier)
curl -X POST http://127.0.0.1:8000/sim/incidente \
  -H "Content-Type: application/json" \
  -d '{"sensor":"externo_cg_temperatura","tipo":"valor_impossivel","valor":-3276.8,"duracao_s":30}'

# 5) Gap de 5 min nos dados (perda de pacotes)
curl -X POST http://127.0.0.1:8000/sim/incidente \
  -H "Content-Type: application/json" \
  -d '{"sensor":"extrusora_2","tipo":"gap","duracao_s":300}'
```

A resposta devolve o `id` do incidente:

```json
{
  "id": "9b1f2a3c",
  "sensor_id": "extrusora_1",
  "tipo": "spike",
  "inicio": "2026-05-23T14:30:12Z",
  "fim": "2026-05-23T14:31:12Z",
  "magnitude": 3.0,
  "valor": 0.0,
  "descricao": "demo pico"
}
```

### `DELETE /sim/incidente/{id}` — cancelar uma falha

```bash
curl -X DELETE http://127.0.0.1:8000/sim/incidente/9b1f2a3c
```

### `POST /sim/resetar` — limpar o banco e refazer o histórico

Útil pra recomeçar uma demo do zero. Apaga TODOS os pontos e regenera
o warm-up de 7 dias.

```bash
curl -X POST http://127.0.0.1:8000/sim/resetar
# Ou com janela menor pra ser mais rápido:
curl -X POST "http://127.0.0.1:8000/sim/resetar?horas=24"
```

---

## Como os dados são gerados (não é ruído branco)

Cada tipo de sensor usa um modelo próprio pra que o gráfico no front
**pareça vivo** — variação contínua, picos, ciclos — e não uma faixa
de ruído gaussiano constante. Tudo determinístico em função de
`(sensor_id, timestamp)`, então é reproduzível e o histórico bate
com o tempo real.

### Energia (motores industriais)

- **Operação por horário**: carga sobe em horário comercial e cai de
  madrugada (cossenoide de 24h).
- **Ciclo do compressor**: ondulação de período ~10 min sobreposta
  (compressor liga/desliga ao longo do tempo).
- **Picos de partida**: a cada ~30 min, ~40% de chance de a corrente
  saltar para 5-7× o nominal por uma amostra (e 2-3× nas vizinhas) —
  igual a quando o motor arranca de fato.
- **Drops esporádicos**: contator/proteção atuando — corrente cai
  abruptamente para ~1% por uma amostra. Frequência ajustada por sensor
  (`drops_por_semana` no perfil).
- **Fases ausentes**: configuráveis (graxaria tem fases A e B em zero,
  espelhando o achado real de "fase ausente — crítico").
- **Falhas crônicas embutidas**: FP baixo, fluxo reverso (TC invertido),
  desequilíbrio NEMA — cada sensor com seu próprio perfil.

### Temperatura (câmaras controladas)

Modelo de **termostato em dente-de-serra**:

```
   ↑ temp
   │   ╱╲      ╱╲      ╱╲       ← compressor desligado: temp sobe
   │  ╱  ╲    ╱  ╲    ╱  ╲      ← compressor ligado: temp cai
   │ ╱    ╲  ╱    ╲  ╱    ╲
   └─────────────────────────→ tempo
        15min     15min
```

- Oscila entre `faixa_ideal_min` e `faixa_ideal_max` quando o sistema
  funciona.
- Período do ciclo: 15 min em câmara fria comum, 30 min em congelados.
- Quando o sensor está em falha (caso `congelados_temperatura`, que
  vive em -8°C sem chegar ao alvo), a oscilação é menor e centrada
  no valor real, refletindo "compressor não dá conta".
- Sensor defeituoso (`congelados_temperatura`,
  `externo_tl_temperatura`): spikes para +85°C ou -3276°C com baixa
  probabilidade — replica os achados reais.

### Temperatura (ambiente externo)

- **Cossenoide diária** (24h): mín ~6h da manhã, máx às 15h Brasília.
- **Maré semanal** (frente fria/quente): senoide de período 3,5 dias.
- **Ruído colorido** (autocorrelado entre janelas) — sensação de
  variação "natural", não branca.

### Porta

- Eventos por dia gerados via **Poisson** com `aberturas_por_hora` do
  perfil.
- 75% concentrados em horário comercial (8h-20h Brasília), 25% espalhados.
- Duração de cada abertura: distribuição **exponencial** com média
  configurada — gera a cauda longa (esquecimentos) naturalmente.
- Sinal pode ser **binário** (graxaria_porta) ou **semi-analógico**
  (estoque_porta — espelha o sinal não-binário observado na API real).

---

## Sensores e suas "personalidades"

Cada sensor já nasce com a característica/falha que aparece nos achados
do explorador. Assim a UI mostra os mesmos diagnósticos sem precisar
"plantar" os dados manualmente.

| Sensor | Tipo | Característica embutida |
|---|---|---|
| `extrusora_1` | energia | FP baixo crônico (0,70) — banco de capacitores queimado |
| `extrusora_2` | energia | FP muito baixo (0,45) + drops frequentes de contator |
| `extrusora_3` | energia | Fluxo reverso (FP negativo) — TCs invertidos |
| `congelados_compressor` | energia | TC invertido (FP -0,43) + CUB 11% crítico |
| `congelados_temperatura` | temperatura | **Vive em -8°C** (alvo -22°C) + spikes para +85°C |
| `estoque_compressor_1` | energia | TC invertido + desequilíbrio CUB 22% (severo) |
| `estoque_compressor_2` | energia | TC invertido + volatilidade crescente (short-cycling) |
| `estoque_temperatura` | temperatura | Estável em -3,9°C, sobe +0,5°C após abrir porta |
| `estoque_porta` | porta | Aberturas raras mas longas (5h em média, sinal analógico) |
| `graxaria_energia` | energia (hist.) | **Fases A e B em zero** — fase ausente |
| `graxaria_temperatura` | temperatura (hist.) | Estável em -9,2°C |
| `graxaria_porta` | porta (hist.) | Padrão evolutivo (+292% entre metades do período) |
| `externo_cg_temperatura` | temperatura | Ciclo dia/noite natural (~13 a 30°C) |
| `externo_tl_temperatura` | temperatura (hist.) | **Sensor defeituoso** — leituras impossíveis (-3276°C) ocasionais |

Detalhes completos (faixas, desvios, taxas) em `perfis.py`.

---

## Arquitetura interna

```
simulador/
├── main.py            # FastAPI + rotas
├── perfis.py          # Parâmetros dos 14 sensores (fonte da verdade do catálogo)
├── geradores.py       # Funções de série temporal por tipo (energia/temp/porta)
├── incidentes.py      # Modos de falha injetáveis em tempo real
├── estado.py          # Loop em background (warm-up + tick contínuo)
├── armazenamento.py   # SQLite (interface trocável pelo BD real depois)
├── requirements.txt
└── README.md
```

**Trocar pelo banco real** quando chegar:
1. Crie uma nova classe em `armazenamento.py` com os métodos
   `salvar_ponto`, `salvar_pontos_em_lote`, `buscar_pontos`,
   `ultimo_ts`, `contar_pontos`, `apagar_tudo`.
2. Em `main.py`, troque `armazenamento = Armazenamento(...)` pela nova.
3. Pronto. Nada mais muda.

---

## Estado do front

- [x] `ApiBEM.js` aceita URL base do localStorage (`datacold_api_url`).
- [ ] (Opcional, futuro) UI no admin para alternar entre API real e simulador.
