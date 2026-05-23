# Controle de produção e OEE · como a indústria resolve

Como inferir estado de máquina, calcular OEE e medir impacto da abertura de porta usando apenas medição elétrica e sensores de porta.

---

## Problema 1 · Inferência de estado da máquina (ligada / ociosa / parada)

### O método clássico

A partir da potência ativa total:

```
P_total = Σ (V_fase · I_fase · FP_fase)

Estado = RODANDO se P > T_alto
       = OCIOSO  se T_baixo ≤ P ≤ T_alto
       = PARADA  se P < T_baixo
```

### Como descobrir os thresholds automaticamente

| Método | Complexidade | Robustez | Quando usar |
|---|---|---|---|
| Histograma + vales (kernel density) | Baixa | Média | Primeira tentativa, didático |
| **K-Means (k=3)** sobre P em janelas de 1 min | Baixa | Boa | **Recomendado para hackathon** |
| GMM (Gaussian Mixture, n=3) | Média | Alta | Se houver tempo |
| Hidden Markov Model (HMM) | Alta | Muito alta | Refinamento avançado |

Para extrusoras de sorvete, a curva típica tem três modos claros:

- ~0 kW (desligado)
- ~motor em vazio + refrigeração mínima (idle)
- ~motor pleno + bomba + freezer (running)

O KDE no histograma de P já revela dois vales nítidos. K-Means com k=3 encontra os centróides automaticamente.

### Refinamentos clássicos

- **Histerese**: para evitar chaveamento espúrio, usar `T_alto_subida ≠ T_alto_descida` com margem de ~5-10%.
- **Debounce temporal**: só confirma transição após N amostras (ex.: 30 s) no novo estado.
- **HMM (Viterbi)**: matriz de transição com diagonal alta (estados são persistentes) suaviza ruído. Emissão gaussiana por estado, treinada via Baum-Welch ou inicializada do GMM.

Implementação prática em Python:

```python
from hmmlearn.hmm import GaussianHMM
model = GaussianHMM(n_components=3, covariance_type="diag", n_iter=100)
model.fit(P.reshape(-1, 1))
states = model.predict(P.reshape(-1, 1))   # 0, 1, 2 ordenados por média
```

---

## Problema 2 · OEE somente com sinal elétrico

### A fórmula canônica (ISO 22400)

```
OEE = Disponibilidade × Performance × Qualidade

Disponibilidade = Tempo_Rodando / Tempo_Planejado
Performance     = (Ciclos_Reais × Tempo_Ciclo_Ideal) / Tempo_Rodando
Qualidade       = Peças_Boas / Peças_Totais
```

### O que dá pra calcular com só medição elétrica

| Componente | Viabilidade | Como |
|---|---|---|
| Disponibilidade | **Total** | Soma dos intervalos no estado RODANDO ÷ janela do turno |
| Performance | **Parcial (proxy)** | Detectar ciclos via picos periódicos em P (autocorrelação) e comparar período observado vs período-alvo |
| Qualidade | **Não diretamente** | Exige integração externa (MES, contador de produção). Proxy possível: variância anômala de P por ciclo |

### Detecção de ciclo na curva de potência

Extrusora de sorvete tem ciclo de extrusão/corte com assinatura periódica em corrente. Técnicas:

- **Autocorrelação** ou **periodograma de Welch** em janelas de 5 a 10 min para estimar o período dominante T̂.
- `Performance ≈ T_ideal / T̂_observado` quando T̂ > T_ideal (ciclo lento = perda de performance).

### Relação com NILM

NILM (Non-Intrusive Load Monitoring) foi criado para *desagregar* uma única medição agregada em cargas individuais. Aqui já se tem medição **por máquina**, então NILM não é necessário para identificação — mas técnicas NILM são úteis para:

- Desagregar **dentro** da máquina (motor principal vs resistências vs ventilador) usando detecção de eventos e assinaturas transientes.
- Algoritmos clássicos: Hart (1992), FHMM (Factorial HMM), CO (Combinatorial Optimization), Seq2Point (deep learning).

NILMTK é o toolkit Python open-source de referência.

---

## Problema 3 · Tempo em operação por turno

### Segmentação automática de turnos

- Agregar P em buckets de 15 min ao longo de várias semanas
- Aplicar clustering temporal (k=2 ou k=3) sobre o vetor médio P(hora_do_dia)
- Detecta naturalmente padrão de 1, 2 ou 3 turnos sem precisar de cadastro manual

### Paradas planejadas vs não planejadas (heurísticas)

| Sinal | Classificação |
|---|---|
| Parada > 30 min em janela típica de almoço (11h-13h), recorrente | Planejada (refeição) |
| Parada simultânea em todas as 3 extrusoras | Planejada (setup/limpeza/troca de sabor) |
| Parada isolada em 1 máquina, fora de janela recorrente | **Não planejada** (falha) |
| Parada no início/fim de turno | Planejada (setup/teardown) |
| Microparadas (< 5 min) durante turno | Stoppage (entra em Performance, não Disponibilidade) |

Estratégia: marcar qualquer parada **recorrente** (mesmo horário, 3 ou mais dias por semana) como planejada e o resto como não planejada.

---

## Problema 4 · Impacto da abertura de porta no consumo da câmara

### Modelo "event-based baseline"

Para cada evento de abertura `i` no instante t_i:

```
Baseline_i = média(P_compressor) na janela [t_i − 30min, t_i − 5min] com porta fechada
Consumo_evento_i = ∫ P_compressor(t) dt   para t ∈ [t_i, t_i + N min]
Extra_i = Consumo_evento_i − (Baseline_i · N min)
```

N = 15 a 30 min (tempo típico de recuperação térmica). Valida-se com a curva de temperatura interna: o evento "termina" quando T_interna volta ao setpoint.

### Apresentação para o gestor

1. **kWh extra médio por abertura** (por câmara)
2. **Custo R$ por abertura** = kWh_extra × tarifa_R$/kWh (TUSD + TE; ponta vs fora-ponta)
3. **Ranking de horários piores**: heatmap dia-da-semana × hora-do-dia colorido por kWh_extra acumulado
4. **Top 10 eventos mais caros do mês** (porta ficou aberta muito tempo)
5. **Pareto**: 20% das aberturas geram 80% do custo extra → foco operacional

### Modelo estatístico mais robusto (se houver tempo)

Regressão linear:

```
P_compressor ~ T_externa + T_interna + porta_aberta + lag(porta_aberta, 1..N)
```

Isola o efeito porta de outros fatores (clima, ciclo natural do compressor).

---

## Problema 5 · Correlação Temperatura × Porta × Compressor

### Visualizações recomendadas

**Painel sincronizado de 3 tracks** (mesma escala de tempo, 24h):

- Track 1: T_interna (linha) + setpoint (linha tracejada) + faixa de tolerância sombreada
- Track 2: P_compressor (área)
- Track 3: porta_aberta (barras verticais nos eventos, largura = duração)

Comunica visualmente o ciclo causal: abertura → pico de T → ciclo extra do compressor.

**Scatter "duração de abertura × kWh extra"** com linha de regressão. Comunica diretamente: "cada minuto de porta aberta custa R$ X".

**Door-to-Recovery time**: histograma do tempo que a câmara leva para voltar ao setpoint após cada abertura. Métrica de saúde do isolamento térmico e da vedação da porta — se o D2R cresce gradualmente para o mesmo perfil de abertura, a borracha está degradando.

**Duty cycle do compressor**: percentual do tempo ligado, antes e durante turno operacional, quantifica o overhead causado pelas aberturas.

---

## Estado da arte · power-based machine state detection

### Linhagem técnica

- **G.W. Hart (MIT, 1992)** — paper seminal de NILM, baseado em detecção de eventos (degraus em P e Q) e clustering no plano P-Q.
- **Kolter & Johnson (MIT, 2011)** — dataset REDD, primeira referência pública.
- **Kelly & Knottenbelt (Imperial College, 2015)** — UK-DALE e redes neurais (Denoising Autoencoder, Seq2Point) para desagregação.
- **Zhong et al.** — Factorial HMM signal-aware.
- **Fraunhofer / CMU (Mario Berges)** — NILM industrial aplicado a fábricas, inferindo estado de máquinas sem instrumentação adicional.

### Ferramentas open-source

- **NILMTK** — toolkit Python de referência (https://github.com/nilmtk/nilmtk)
- **NILMTK-Contrib** — algoritmos modernos (Seq2Point, WaveNILM)
- **hmmlearn / pomegranate** — HMMs gerais
- **ruptures** — detecção de change-points em séries temporais
- **tslearn / sktime** — clustering e classificação de séries

---

## Quem faz isso no mercado

| Plataforma | O que destacam em OEE |
|---|---|
| **MachineMetrics** | OEE em tempo real, downtime tracking automático com classificação por motivo, Pareto de causas, comparativo turno-a-turno, alertas de microparadas |
| **Tulip** | Apps low-code com OEE configurável, andon digital, integração operador-no-loop para classificar paradas |
| **FogHorn (Johnson Controls Edge)** | Edge ML para anomalia em assinatura elétrica, predição de falha de motor/compressor |
| **NI SystemLink** | Centralização multi-sítio, KPIs hierárquicos (linha → célula → máquina) |
| **Senseye / AVEVA PI** | Combinam OEE com prognóstico (RUL — Remaining Useful Life) |

### Padrão visual de dashboards OEE no mercado

- Gauge grande de OEE atual + componentes A/P/Q como sub-gauges
- Timeline de estado (Gantt colorido) por máquina e turno
- Pareto de motivos de parada
- Tendência OEE (linha) das últimas 4 semanas
- Heatmap turno × dia

---

## Referências

- Hart, G.W. · Nonintrusive Appliance Load Monitoring · Proc. IEEE 1992: https://ieeexplore.ieee.org/document/192069
- NILMTK · toolkit e papers de referência: https://github.com/nilmtk/nilmtk e http://nilmtk.github.io/
- Kelly & Knottenbelt · Neural NILM (UK-DALE): https://arxiv.org/abs/1507.06594
- ISO 22400-2 · KPIs de manufatura (OEE oficial): https://www.iso.org/standard/54497.html
- MachineMetrics · OEE & Downtime Analytics: https://www.machinemetrics.com/oee
