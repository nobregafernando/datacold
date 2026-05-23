# Conectividade e saúde da telemetria · como a indústria resolve

Como monitorar uma rede de sensores IIoT — saber se cada sensor está vivo, detectar lacunas, identificar dados ruins.

---

## Problema 1 · Painel de saúde do sensor

### KPIs essenciais (mesmo sem RSSI ou uptime nativos)

| KPI | Como calcular sem stack nativa |
|---|---|
| `last_seen` | timestamp da última mensagem recebida |
| `msg_rate` | contagem em janela deslizante de 1/5/15 min |
| `expected_interval` | média móvel exponencial (EWMA) dos deltas entre mensagens |
| `gap_count_24h` | número de intervalos > 3σ na janela |
| `freshness` | now − last_seen em segundos |
| `payload_integrity` | percentual de payloads com schema válido / sem NaN |
| `api_health` | proxy: latência HTTP da API e número de respostas 429 (rate-limit) |

### Classificação ternária (padrão indústria 4.0)

```
ONLINE      → freshness < expected_interval · 2  E  payload válido
DEGRADADO   → 2·expected_interval ≤ freshness < 5·expected_interval
              OU jitter > 50% da média
              OU > 5% de payloads inválidos na última hora
OFFLINE     → freshness ≥ max(5·expected_interval, 300s)
```

Como não há RSSI direto, a "saúde de link" pode ser inferida pelo **jitter da frequência de chegada** (sensor com link ruim acumula mensagens em rajadas) e pela **variância do drift de timestamp**.

---

## Problema 2 · Detecção de lacunas e atrasos

### Heartbeat virtual (algoritmo prático)

Para cada sensor s:

```python
mu  = EWMA(deltas, alpha=0.2)        # intervalo esperado
sig = EWMSD(deltas, alpha=0.2)        # desvio
deadline = last_seen + mu + 3*sig

if now > deadline:                    # WARN
    raise gap_warning
if now > last_seen + max(5*mu, 300s): # CRITICAL
    raise sensor_down
```

### Thresholds consagrados (NAMUR NE107, AWS IoT best practices)

- **WARN**: 3σ OU 2× intervalo esperado
- **CRITICAL**: 5× intervalo esperado OU > 5 min absoluto (o que vier antes para sensores de alta frequência)
- **DEAD**: > 15 min sem dado em sensor industrial padrão

### Caso especial · sensores event-driven

Sensores de abertura de porta só publicam quando há transição — o heartbeat puro falha. Soluções:

- Exigir um **keep-alive** mínimo do firmware (ping a cada 60 s mesmo sem evento)
- Fazer **polling sintético** se a API não suporta: GET no último valor periodicamente e marcar "stale" se não muda há N horas mas o sensor declarado-se "vivo"

---

## Problema 3 · Alerta quando sensor cai

### Canais escalonados (estilo PagerDuty)

1. **T+0**: anomalia detectada → Slack/Teams webhook
2. **T+5 min**: e-mail ao responsável da linha
3. **T+15 min**: push (FCM/APNs) ao engenheiro de plantão
4. **T+30 min**: SMS ou ligação (Twilio) ao supervisor

### SLA típico de indústria 4.0

- Linha de produção crítica: **99,9%** de uptime (~ 8h 45min de downtime/ano)
- Telemetria de monitoramento: **99,5%** (~ 1 dia 19h/ano)
- Sensores de frio (food safety, HACCP): para sorvete, a cadeia de frio é regulamentada pela RDC 275/Anvisa e exige rastreabilidade contínua. SLA prático > **99,5%** mensal e log auditável de gaps.

### Anti-flapping

Exigir N falhas consecutivas (ex.: 3) antes de disparar, e cooldown de 10 min antes de re-alertar o mesmo evento. Evita inundar com alertas duplicados em sensores intermitentes.

---

## Problema 4 · Detecção de dados anômalos

### Camada 1 · Sanity check físico (rápido, determinístico)

```
temperatura câmara fria:   -30°C ≤ T ≤ 10°C    (alarme físico)
                           -50°C ≤ T ≤ 50°C    (range de hardware)
corrente trifásica:        0 A   ≤ I ≤ I_nominal · 1,3
porta:                     {0, 1} (booleano estrito)
```

Tudo fora desses ranges é descartado ou marcado como inválido antes de qualquer análise downstream.

### Camada 2 · Detecção de "sensor travado" (stuck-at)

```
se std_dev(últimas N leituras) < ε_sensor
   E janela > T_min:
        flag = STUCK
```

Para temperatura industrial: ε = 0,05°C e T_min = 10 min. Para energia: 5 min sem variação > 0,1 A com carga declarada como ligada = suspeito.

### Camada 3 · Spike / outlier

- **Hampel filter** (mediana móvel + MAD): padrão em IIoT, robusto a outliers.
- **Z-score robusto**: `|x − mediana| / MAD > 3,5`.
- **Taxa de variação**: `|dT/dt| > rampa_física_máxima`. Câmara fria não muda mais que 2°C/min sem causa identificável.

### Diferenciar "sensor zoado" de "evento real"

- **Correlação cruzada**: se temp_câmara1 sobe e temp_câmara2 (sala adjacente) não sobe, sensor 1 é suspeito.
- **Coerência com contexto**: porta aberta + temperatura subindo = evento real. Temperatura subindo + porta fechada + sem queda na corrente do compressor = anomalia (sensor ou falha de refrigeração).
- **Confirmação multi-sensor**: voto 2-de-3 quando há redundância.
- **Histórico**: spike isolado seguido de retorno ao normal em 1 amostra = quase sempre sensor; mudança sustentada = evento real.

---

## Problema 5 · Score de qualidade da telemetria

Composição ponderada inspirada em **ISO 8000 Data Quality** e DAMA-DMBOK:

```
Q_sensor = 0,30 · Completude     # 1 − (gaps_24h / esperado_24h)
         + 0,25 · Pontualidade   # % de mensagens dentro de μ ± σ
         + 0,20 · Validade       # % de mensagens em range físico
         + 0,15 · Estabilidade   # 1 − jitter normalizado
         + 0,10 · Plausibilidade # 1 − taxa de outliers do Hampel

(todos em [0,1], multiplica por 100 para escala 0-100)
```

**Faixas**: 90-100 verde, 70-89 amarelo, < 70 vermelho. Score agregado da fábrica = média ponderada por criticidade do sensor.

---

## Problema 6 · Clock skew e mensagens fora de ordem

### Problemas comuns

- Sensor sem NTP → timestamp drift de minutos
- Buffer no gateway → mensagens chegam fora de ordem
- Fuso horário inconsistente (UTC vs local)

### Mitigações

- Usar sempre **dois timestamps**: `ts_sensor` (origem) e `ts_ingest` (servidor). Computar `skew = ts_ingest − ts_sensor`.
- Alerta se `|skew|` muda mais que 30 s entre mensagens consecutivas.
- **EWMA do skew por sensor** identifica clock drift gradual (bateria do RTC morrendo).
- Para ordenação, usar `ts_ingest` como autoridade e marcar `out_of_order = true` quando `ts_sensor[i] < ts_sensor[i−1]`.
- Quando disponível, usar **sequence numbers** (Sparkplug B usa 0-255 ciclando) que detectam perda exata de pacotes.

---

## Padrões e protocolos da indústria

- **ISA-95** — hierarquia L0-L4 (sensor → ERP). Define onde a "telemetria de saúde" vive (L2/L3).
- **NAMUR NE107** — padrão *de facto* para status de equipamento de campo. Quatro categorias:
  - `Good`
  - `Maintenance Required`
  - `Out of Specification`
  - `Function Check`
  - `Failure`
  Vale a pena adotar esse vocabulário no painel — sinaliza maturidade técnica.
- **OPC-UA Part 14 (PubSub)** + Companion Specs (Device Information Model) — expõe `DeviceHealth` enum exatamente nas categorias NAMUR.
- **MQTT Sparkplug B** — NBIRTH/NDEATH/DBIRTH/DDEATH messages dão heartbeat nativo via *Last Will Testament*. Sequence numbers garantem detecção de gap.
- **OneM2M / W3C WoT Thing Description** — metadados de saúde padronizados para web of things.

---

## Quem faz isso no mercado

| Ferramenta | O que mostram que vale imitar |
|---|---|
| **AWS IoT Device Defender** | métricas de conectividade, detecção de anomalia ML, audit rules |
| **Azure IoT Hub Device Twin** | `reported properties` com `lastActivityTime`, `connectionState` |
| **ThingsBoard** (open-source) | widget "Device status" com semáforo, RPC timeout, inactivity alarm configurável por device profile |
| **Losant / Datacake** | dashboards com "last reported", heatmap de silêncio |
| **Grafana + Prometheus `up{}`** | métrica binária + `rate()` e `absent_over_time()` — fácil de replicar |
| **HiveMQ / EMQX** | métricas de broker MQTT, sessões expiradas |

---

## Referências

- AWS IoT Device Defender Detect: https://docs.aws.amazon.com/iot-device-defender/latest/devguide/device-defender-detect.html
- NAMUR NE107 · Self-Monitoring and Diagnosis of Field Devices: https://www.namur.net/en/recommendations-and-worksheets/current-nena.html
- Eclipse Sparkplug B Specification: https://sparkplug.eclipse.org/specification/
- ThingsBoard Device Profile / Alarm Rules: https://thingsboard.io/docs/user-guide/device-profiles/
- Pearson · Generalized Hampel Filters (EURASIP, 2016): https://asp-eurasipjournals.springeropen.com/articles/10.1186/s13634-016-0383-6
- ISO 8000-8 · Information and Data Quality: https://www.iso.org/standard/60805.html
