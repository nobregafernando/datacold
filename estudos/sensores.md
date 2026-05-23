# Sensores e como funcionam

O desafio expõe 14 sensores agrupados em 6 grupos físicos, com 3 tipos de leitura: energia trifásica, temperatura e abertura de porta. Este documento explica o que cada um mede e como o sinal é gerado.

---

## Tipo 1 · Sensor de energia (medidor trifásico)

### O que mede

Cada medidor trifásico é instalado no quadro elétrico do equipamento e fornece **nove canais** de leitura, três para cada uma das três fases (A, B e C) da rede elétrica:

| Campo | Unidade | O que é |
|---|---|---|
| `corrente_fase_a` / `_b` / `_c` | Amperes (A) | corrente que passa em cada fase |
| `tensao_fase_a` / `_b` / `_c` | Volts (V) | tensão de cada fase |
| `fator_potencia_a` / `_b` / `_c` | adimensional, entre 0 e 1 | cosseno da defasagem entre tensão e corrente |

Na API, o fator de potência vem multiplicado por 1000 (já é normalizado pelo backend antes de chegar ao seu código, segundo a documentação).

### Como o sinal é gerado

Um medidor trifásico industrial típico tem:

- **Transformadores de corrente (TCs)**: anéis fechados em torno de cada condutor de fase. A corrente que passa pelo cabo induz uma corrente proporcional menor no secundário do TC (relação típica 100:5, 200:5 etc.), que o medidor lê.
- **Divisores de tensão**: medem diretamente a tensão fase-neutro ou fase-fase.
- **Processador interno**: amostra tensão e corrente a alta frequência (kHz), calcula a defasagem (ângulo φ entre as ondas) e devolve o fator de potência como cos(φ).

### Por que três fases

A rede elétrica industrial brasileira é trifásica: três tensões alternadas de 60 Hz defasadas em 120° entre si. Equipamentos pesados (motores, compressores) usam as três fases para entregar potência mais constante e com menor corrente por condutor.

Quando algo está errado — desbalanceamento de carga, problema na rede, falha no motor — as três fases deixam de se comportar de forma simétrica, e essa assimetria é o que dá pra diagnosticar a partir desses nove números.

### O que dá pra calcular

A partir dos nove campos brutos, vários indicadores derivados podem ser computados:

- **Potência ativa** (a que vira trabalho útil): `P = Σ Vx · Ix · FPx` em Watts
- **Potência aparente**: `S = Σ Vx · Ix` em VA
- **Potência reativa**: `Q = √(S² − P²)` em VAr
- **Fator de potência composto**: `FP = P / S`
- **kWh acumulado**: integral de P ao longo do tempo
- **Desequilíbrio de corrente (NEMA MG-1)**: `(max|Ix − Ī| / Ī) × 100`
- **Desequilíbrio de tensão**: mesmo cálculo aplicado às tensões

### Onde estão na fábrica

| Sensor | Equipamento | Status |
|---|---|---|
| `extrusora_1` | Extrusora 1 da linha de produção | ativo |
| `extrusora_2` | Extrusora 2 da linha de produção | ativo |
| `extrusora_3` | Extrusora 3 da linha de produção | ativo |
| `congelados_compressor` | Compressor da câmara de congelados | ativo |
| `estoque_compressor_1` | Compressor 1 da câmara fria de estoque | ativo |
| `estoque_compressor_2` | Compressor 2 da câmara fria de estoque | ativo |
| `graxaria_energia` | Energia da câmara de graxaria | histórico (desativado) |

---

## Tipo 2 · Sensor de temperatura

### O que mede

Um único campo: `temperatura` em graus Celsius.

A API já entrega o valor convertido (o backend divide o valor cru por 10 e devolve em °C, segundo a documentação).

### Como o sinal é gerado

Sensores industriais de temperatura usam, tipicamente, uma destas tecnologias:

- **PT100 / PT1000**: termorresistor de platina. A resistência elétrica do filamento de platina varia de forma quase linear com a temperatura (0,385 Ω/°C no PT100). Uma corrente conhecida atravessa o sensor, a queda de tensão é medida e convertida em temperatura. Faixa típica: −200 a +850 °C.
- **Termopar (tipo K, J, T)**: junção de dois metais diferentes. A diferença de temperatura entre a junção quente e a fria gera uma tensão (efeito Seebeck) de poucos milivolts, que é amplificada e convertida.
- **Termistor NTC**: resistor cerâmico cuja resistência cai rapidamente com a temperatura. Mais barato, menos linear, comum em câmaras frias de menor porte.

Para câmaras frias industriais (faixa típica de −25 °C a +5 °C), PT100 e PT1000 são o padrão por precisão e estabilidade.

### O que dá pra detectar

- **Temperatura instantânea** e tendência (slope) ao longo do tempo
- **Resíduo térmico**: diferença entre a temperatura observada e a esperada para aquela hora/clima/ciclo do compressor — isola degradação do equipamento de variações naturais
- **Door-to-Recovery time**: quanto tempo a câmara leva para voltar ao setpoint após uma abertura de porta (mede a saúde do isolamento e da capacidade do compressor)
- **Sensor travado**: variância próxima de zero por muito tempo indica falha do próprio sensor

### Onde estão na fábrica

| Sensor | Local | Status |
|---|---|---|
| `congelados_temperatura` | interna da câmara de congelados | ativo |
| `estoque_temperatura` | interna da câmara fria de estoque | ativo |
| `graxaria_temperatura` | interna da câmara de graxaria | histórico |
| `externo_cg_temperatura` | ambiente externo Campo Grande/MS | ativo |
| `externo_tl_temperatura` | ambiente externo Três Lagoas/MS | histórico |

A temperatura externa é fundamental: o compressor trabalha mais quando faz mais calor lá fora, e ignorar isso leva a falsos alarmes de manutenção. Toda análise séria de tendência interna precisa cruzar com a externa.

---

## Tipo 3 · Sensor de abertura de porta

### O que mede

Um único campo: `abertura_porta` com valor binário (0 = fechada, 1 = aberta).

### Como o sinal é gerado

Quase sempre um **reed switch** (chave magnética):

- Uma pequena cápsula com duas lâminas metálicas fica na moldura da porta.
- Um ímã permanente fica na porta em si.
- Quando a porta está fechada, o ímã aproxima as lâminas e fecha o circuito (0 ou 1 dependendo da convenção).
- Quando a porta abre, o ímã se afasta, as lâminas se separam e o estado inverte.

Alternativas industriais: chaves indutivas, sensores ópticos, ou um contato seco já presente no painel de controle da câmara. A leitura final é sempre digital: aberto ou fechado.

### O que dá pra detectar

- **Eventos de abertura**: contar quantas vezes a porta abriu por turno/hora/dia
- **Duração de cada abertura**: tempo entre a transição 0→1 e a transição 1→0 seguinte
- **Custo energético do evento**: cruzar com o consumo do compressor nos minutos seguintes para calcular o kWh extra causado
- **Padrões operacionais**: heatmap dia × hora revela horários problemáticos
- **Saúde da vedação**: se o tempo de recuperação da temperatura aumenta gradativamente para o mesmo perfil de abertura, a borracha de vedação está degradando

### Onde estão na fábrica

| Sensor | Local | Status |
|---|---|---|
| `estoque_porta` | câmara fria de estoque | ativo |
| `graxaria_porta` | câmara de graxaria | histórico |

---

## Resumo · o que vem da API

A API entrega séries temporais (`timestamp, valor`) para cada campo de cada sensor. O backend já normaliza unidades (FP ÷ 1000, temperatura ÷ 10) e expõe metadados via `/api/v1/sensors` e `/api/v1/groups`. Os dados brutos do InfluxDB ficam protegidos atrás da API; o desafio é transformar essas séries em informação acionável.
