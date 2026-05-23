# Manutenção preditiva · como a indústria resolve

Como diagnosticar problemas em motores trifásicos e compressores de refrigeração antes da falha, usando apenas corrente, tensão, fator de potência e temperatura.

---

## Problema 1 · Desequilíbrio de corrente entre fases

### O que é

Um motor trifásico saudável puxa correntes praticamente iguais nas três fases. Quando aparece desequilíbrio, é sintoma de algo errado — na rede ou no próprio motor.

### Fórmula NEMA MG-1

Norma de referência mundial para motores elétricos:

```
Ī = (Ia + Ib + Ic) / 3
%CUB = max|Ix − Ī| / Ī × 100
```

### Thresholds práticos

| Faixa | Interpretação |
|---|---|
| < 5% | normal |
| 5 a 10% | atenção, investigar |
| > 10% | alarme crítico — derating obrigatório e diagnóstico imediato |

### Diagnóstico diferencial · rede vs motor

Esse é o ponto fino: o mesmo sintoma (corrente desequilibrada) tem causas opostas, e cruzar com o desequilíbrio de tensão diferencia.

- **Se a tensão também está desequilibrada** → o problema é da **rede**: cargas monofásicas mal distribuídas entre as fases, conexão ruim no QGBT, transformador degradado.
- **Se a tensão está OK mas a corrente está desbalanceada** → o problema é **interno do motor**: curto entre espiras do estator, isolação degradada, conexão frouxa nos terminais, barras quebradas no rotor (típico em extrusoras que sofrem partidas pesadas).

### Apresentação no dashboard

Gauge circular com três setas (uma por fase) saindo do centro, comprimento proporcional à corrente. Se assimétrico visualmente, alerta. Tendência temporal do %CUB em linha — degradação gradual aparece como uma rampa.

---

## Problema 2 · Desequilíbrio de tensão

### Fórmula NEMA

```
V̄ = (Vab + Vbc + Vca) / 3       (tensões de linha)
%VUB = max|Vx − V̄| / V̄ × 100
```

NEMA recomenda usar tensões de linha (fase-fase) e não fase-neutro, porque tensões de linha filtram desequilíbrios do neutro.

### Thresholds

- NEMA MG-1: < 1% ideal, máximo absoluto 2% para operação contínua
- IEEE 141: até 2% aceitável

### A regra dos 2% (crítica)

Para cada 1% de VUB, as perdas no motor aumentam em ~6-8%. A 2% de VUB, o aquecimento do enrolamento aumenta em aproximadamente 8 vezes — ou seja, 16-25% mais calor.

Pela **regra de Arrhenius** (que governa a vida útil de isolantes elétricos), cada 10°C acima da classe térmica do motor reduz a vida útil do isolamento pela metade. Pequenos desequilíbrios persistentes matam motores silenciosamente em meses.

### Derating NEMA

Acima de 1% VUB, é necessário "derate" — operar o motor abaixo da potência nominal. A 5% VUB, opera-se a no máximo 75% da nominal.

### Relação com o desequilíbrio de corrente

Desequilíbrio de corrente costuma ser **6 a 10 vezes maior** que o de tensão. Ou seja, 2% de VUB pode gerar 12-20% de %CUB — uma pequena assimetria na rede gera grande sintoma no motor. Isso reforça a necessidade do diagnóstico diferencial.

---

## Problema 3 · Tendência de temperatura subindo em compressor (pré-falha)

### Por que threshold fixo não funciona

Compressor trabalha mais quando faz mais calor lá fora. Câmara de congelados a −25°C em Campo Grande no verão (40°C externos) puxa muito mais que a mesma câmara em julho. Se você alarma "T_interna > −23°C", vai disparar falso positivo todos os dias quentes — e perder a degradação real que aparece como uma deriva lenta independente do clima.

### Stack recomendada (combinar, não escolher uma)

**EWMA (Exponentially Weighted Moving Average)** — baseline adaptativo, captura drift lento:

```
EWMA_t = α · T_t + (1 − α) · EWMA_{t−1}        com α entre 0,1 e 0,3
```

Alerta quando `|T_t − EWMA_t| > k · σ` (k = 3).

**CUSUM (Cumulative Sum)** — detecta mudanças sutis e persistentes. É o algoritmo certo para "subindo lentamente há 5 dias":

```
S_t = max(0, S_{t−1} + (T_t − μ_0 − K))
```

Dispara quando S_t > H (tipicamente H = 4-5σ, K = 0,5σ).

**Slope móvel** — regressão linear simples em janela de 24h. Se dT/dt > limiar e persiste por N janelas, alerta de tendência.

### O ponto crítico · baseline sazonal

Em vez de aplicar EWMA/CUSUM diretamente sobre a temperatura bruta, modela-se primeiro a temperatura esperada como função do contexto:

```
T_interna_esperada = f(T_externa, hora_do_dia, ciclo_de_degelo, setpoint)
```

Modelo prático: regressão linear multivariada ou regressão por janelas similares (mesma hora, mesmo dia da semana, últimas 4 semanas). Calcula-se então o **resíduo**:

```
resíduo = T_observada − T_predita
```

EWMA e CUSUM são aplicados no resíduo, não na temperatura bruta. Assim, isola-se degradação real (perda de gás, sujeira no condensador, válvula de expansão degradada) do efeito climático normal.

### Variação típica por câmara

- Câmara de **congelados** (~ −25°C): variação típica ±2°C. Resíduo > +3°C sustentado por 2h = alerta de pré-falha.
- Câmara **fria de estoque** (~ 0 a +4°C): variação ±1,5°C.

---

## Problema 4 · Assinatura elétrica anômala sem FFT

MCSA (Motor Current Signature Analysis) clássico usa FFT da corrente para detectar harmônicos típicos de falhas mecânicas. Sem amostragem em alta frequência, só se tem corrente RMS — mas mesmo assim dá pra detectar muita coisa por **regras determinísticas sobre séries temporais**:

### Pico de corrente de partida

```
razão = I_partida / I_nominal
```

Motor saudável: 5 a 7 vezes a nominal no instante da partida. Se a razão sobe para 8-10 ao longo de semanas → rolamento ou enrolamento degradando.

### Short-cycling em compressor

Contar partidas por hora. Normal: 3 a 6/h. Alarme: > 10/h. Indica:

- falta de gás refrigerante
- termostato com defeito
- condensador sujo (alta pressão dispara proteção rapidamente)

### Corrente em vazio crescente

Quando o compressor desliga mas o motor ainda gira por inércia (ou em idle nas extrusoras), mede-se a corrente "em vazio". Aumento de mais de 15% sobre o baseline indica perdas magnéticas crescentes — isolação envelhecendo.

### Tempo de ciclo on/off (duty cycle)

Um compressor que historicamente ficava 50% do tempo ligado e começa a ficar 80% do tempo ligado, para o mesmo perfil de uso, está perdendo eficiência.

### Razão I_pico / I_RMS

Aumenta com cavitação ou golpe de líquido em compressor.

### ML como complemento

Para um hackathon, **Isolation Forest** é o ganhador:

- Não-supervisionado (não exige rótulos de falha que não temos)
- Treina em minutos com scikit-learn
- Multivariado nativo (corrente + tensão + FP + temperatura + features derivadas)
- Interpretável via SHAP

Pipeline típico:

```python
features = [I_média, %CUB, %VUB, FP_médio, T_interna,
            resíduo_T, ciclos_última_hora, P_ativa, P_ativa/baseline]
modelo = IsolationForest(contamination=0.05)
score = modelo.decision_function(X)
```

Autoencoders só compensam com mais de 30 dias de dados normais e tempo de tuning — não cabem em 54h.

---

## Indicadores derivados úteis (calcular sempre)

```
P_ativa     = Σ Vx · Ix · FPx              (Watts) · trabalho útil
P_aparente  = Σ Vx · Ix                     (VA)
FP_composto = P_ativa / P_aparente          (deve estar entre 0,85 e 0,95)
P_reativa   = √(S² − P²)                    (VAr)
```

Comportamentos a vigiar:

- **FP caindo lentamente** = enrolamento envelhecendo ou rotor com problema. FP < 0,75 sustentado = alarme.
- **P_ativa subindo com a mesma carga térmica** = perda de eficiência. Compressor com gás baixo trabalha mais; motor com mancal seco puxa mais corrente.

---

## Padrões de falha em compressores de refrigeração (5-7 dias antes)

Compressores de amônia (industrial pesado) e freon/R-404A/R-134a (médio porte) compartilham assinaturas.

| Falha | Sintoma elétrico (5-7 dias antes) | Sintoma térmico |
|---|---|---|
| Vazamento de refrigerante | I_média cai (menos massa para comprimir), depois sobe (sistema trabalha mais) | T_interna sobe mesmo com compressor ligado mais tempo |
| Condensador sujo / ventilador fraco | I_média sobe 10-20% (alta pressão de descarga) | T_interna oscila mais; resíduo positivo crescente |
| Válvula de expansão travada | Short-cycling aumenta; FP cai | T oscila em dente-de-serra agressivo |
| Rolamento do motor | %CUB aumenta gradualmente; pico de partida cresce | Sem sintoma térmico claro |
| Curto entre espiras | %CUB > 8%; FP cai abruptamente | Sem mudança térmica até a falha |
| Golpe de líquido (líquido na sucção) | Pico de I_RMS no início do ciclo, razão I_pico/I_RMS > 1,6 | T_sucção anormalmente baixa |
| Contator com pitting | I oscilando ciclo-a-ciclo, partidas erráticas | Sem sintoma |

---

## Quem faz isso no mercado

- **Fluke** — guias técnicos de motor health, instrumentos portáteis de análise.
- **Schaeffler Lifetime Analytics** — plataforma de prognóstico que combina elétrica, vibração e térmica.
- **SKF Condition Monitoring** — handbook de referência em monitoramento de motores elétricos.
- **EATON** — application notes de desequilíbrio de tensão e derating.
- **ABB Motor Protection** — guia clássico de proteção e monitoramento.
- **Senseye / AVEVA PI** — Remaining Useful Life de equipamentos rotativos.

---

## Referências

- NEMA MG-1 · Motors and Generators: https://www.nema.org/standards/view/Motors-and-Generators
- Fluke · Three-Phase Voltage Unbalance: https://www.fluke.com/en-us/learn/blog/motors-drives-pumps-compressors/three-phase-voltage-unbalance
- EATON · Voltage Unbalance and Motors (AP083003EN): https://www.eaton.com/content/dam/eaton/markets/utilities/grid-automation-system/white-paper/wp083003en-voltage-unbalance.pdf
- ABB Motor Protection Application Guide: https://library.abb.com/d/9AKK107992A4259
- SKF Condition Monitoring de motores: https://www.skf.com/group/industries/industrial-distribution/condition-monitoring
- Schaeffler Lifetime Analytics: https://www.schaeffler.com/en/products-and-solutions/industrial/lifetime-analytics/
- Bonnett & Yung · Review of Condition Monitoring of Induction Motors Based on Stator Current · IEEE Trans. Industry Applications (paper acadêmico de referência)
