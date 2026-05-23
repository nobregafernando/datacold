# Eficiência energética · como a indústria resolve

Como empresas e plataformas comerciais transformam dados de medidores trifásicos em economia real.

---

## Problema 1 · Ranking de consumo (kWh) por equipamento

### O que se faz

O cálculo de potência ativa em circuitos trifásicos com cargas desbalanceadas (caso real de compressores e VFDs) é a soma das três fases medidas independentemente:

```
P_inst(t) = Va·Ia·FPa + Vb·Ib·FPb + Vc·Ic·FPc       (Watts)
```

A fórmula simplificada `P = √3 · V · I · FP` só é válida para cargas perfeitamente balanceadas — usar ela em compressores reais introduz erro de 5 a 15%.

O consumo acumulado em kWh é a integral de P ao longo do tempo, calculada na prática pela regra do trapézio entre amostras:

```
E_kWh = Σ ((P_i + P_{i+1}) / 2) · (Δt_i / 3600) / 1000
```

O Δt precisa ser o intervalo **real** entre amostras (a partir dos timestamps), não um valor fixo — assumir Δt constante quando a coleta falha causa erro grosseiro.

### Como apresentar

- **Tempo real**: kW instantâneo, média móvel de 1 min
- **Tático**: kWh por hora, por turno, por dia
- **Estratégico**: kWh por tonelada de sorvete produzido (EnPI, indicador da ISO 50001)
- **Pareto 80/20**: tipicamente 2 ou 3 equipamentos respondem por 80% do consumo
- **Heatmap dia × hora**: revela visualmente turnos e desperdícios em 2 segundos

### Quem faz isso

- **Schneider EcoStruxure Power Monitoring Expert**: Sankey de fluxo de energia entre equipamentos, análise 80/20, KPI customizável (kWh por unidade produzida), conformidade ISO 50001/50002/50006.
- **GreenAnt** (Brasil): benchmarking entre unidades consumidoras, detecção de cobrança indevida, manutenção preditiva por anomalia elétrica.
- **Siemens SIMATIC Energy Manager**: integra dados de medidores com indicadores de produção.

---

## Problema 2 · Alerta de baixo fator de potência

### O contexto regulatório no Brasil

A ANEEL, através do **PRODIST Módulo 8** (Resolução Normativa 1.000/2021), define:

- **Limite mínimo:** fator de potência ≥ **0,92** (indutivo ou capacitivo)
- **Janela de medição:** integralização horária — calcula-se o FP médio a cada hora a partir das energias ativa e reativa acumuladas
- **Período indutivo:** das 06h às 24h o FP deve ser ≥ 0,92 indutivo
- **Período capacitivo:** das 00h às 06h o FP deve ser ≥ 0,92 capacitivo (evita sobretensão quando capacitores ficam ligados sem carga indutiva)
- Aplica-se a todas as unidades consumidoras do Grupo A (média e alta tensão), categoria típica de uma indústria de sorvetes.

### Como a concessionária cobra

A energia reativa excedente é faturada hora a hora. Fórmula simplificada para a hora h:

```
ERE_h = EA_h · (0,92 / FP_h − 1)         quando FP_h < 0,92
```

onde EA_h é a energia ativa consumida na hora. Esse valor é multiplicado pela tarifa de reativo da concessionária local (em MS, Energisa) e vira linha extra na fatura.

### Como gerar o alerta

1. Calcular FP por fase **e** FP composto trifásico a cada amostra
2. Agregar em janelas de 1 hora respeitando os períodos indutivo/capacitivo
3. Classificar a severidade:
   - **WARN**: 0,85 ≤ FP < 0,92 (multa pequena)
   - **CRITICAL**: FP < 0,85 (multa pesada + risco de notificação da concessionária)
4. Estimar o R$ perdido por hora usando a tarifa local — essa é a métrica que vende o pitch

### Causas comuns em sorveteria

- Compressor de refrigeração antigo (motores de indução grandes têm FP baixo, ~0,7-0,8)
- Banco de capacitores descalibrado ou queimado
- Iluminação fluorescente sem reator eletrônico
- Motores rodando muito abaixo da carga nominal (motor superdimensionado)

---

## Problema 3 · Consumo fora do horário produtivo (phantom load)

### O conceito

"Phantom load" ou "consumo de fundo" é tudo que consome quando ninguém produz — fim de semana, madrugada, parada de manutenção. Em qualquer fábrica esse valor é maior do que se imagina, e em sorveteria especificamente, o compressor da câmara fria funciona 24/7, mas o consumo de fundo tem um valor esperado que pode ser estabelecido.

### Como inferir o horário produtivo sem cadastro manual

Três técnicas funcionam bem com telemetria de segundos:

**a) Clustering bimodal** — aplicar K-Means com k=2 ou GMM sobre a série de kW de 7 dias. O cluster de potência baixa é o standby; o de potência alta é produção. O corte natural entre os dois centróides vira o threshold de "ligado".

**b) Change-point detection** (PELT, Binary Segmentation) — detecta transições abruptas de regime na curva. É o estado da arte em monitoramento não-intrusivo de carga (NILM) industrial.

**c) Heurística simples e robusta para um hackathon:**
- Calcular o percentil 10 (P10) da potência de cada equipamento em janela móvel de 7 dias → **baseline de standby**
- Para cada hora atual, se P_média > 1,5 × P10 → considerar "produzindo"
- Detectar fim de semana automaticamente: dias da semana 6/7 com produção < 20% da média de dias úteis

### Detectar "phantom load anômalo"

Uma vez estabelecido o baseline noturno esperado (média móvel de 30 dias do P10 horário), gera-se alerta se o consumo atual passar do baseline + 2σ. Causas típicas em sorveteria:

- Vazamento de ar comprimido (consumo de fundo cresce gradualmente)
- Compressor da câmara fria ciclando errado (variância baixa + potência alta sustentada = compressor travado ligado)
- Sistema de degelo travado
- Motor que deveria estar desligado mas está em vazio

---

## Problema 4 · Tarifa horosazonal verde vs azul

### O quadro regulatório

- **Tarifa Verde**: demanda contratada única, **consumo** diferenciado entre ponta e fora-ponta. Subgrupos A3a, A4, AS. Boa quando a demanda na ponta é baixa.
- **Tarifa Azul**: demanda E consumo diferenciados entre ponta e fora-ponta. Obrigatória para A2/A3; opcional para A4. Melhor quando há controle ativo de carga na ponta.
- **Horário de ponta**: 3 horas consecutivas definidas pela distribuidora, geralmente 18h-21h em dias úteis. A tarifa de energia na ponta pode ser **5 a 7 vezes** a tarifa fora-ponta.

### Por que sorveteria tem vantagem natural

Câmaras frias têm **inércia térmica enorme**. Uma câmara de congelados a −25°C continua a −25°C por muito tempo mesmo com o compressor desligado, especialmente se foi pré-resfriada antes. Isso é uma "bateria térmica grátis".

### Estratégia clássica de shifting de carga

1. **Pré-resfriar** as câmaras entre 14h-17h, derrubando setpoint 2-3°C → chega em 18h com reserva térmica
2. **Desligar 1 dos 2 compressores** da câmara fria de estoque na janela de ponta, mantendo só o de congelados (que não pode parar)
3. **Programar batches de extrusão** para terminar antes das 18h ou começar depois das 21h
4. **KPI no dashboard**: percentual do consumo em ponta — meta abaixo de 8% para sorveteria bem gerida

---

## Benchmarks da indústria de sorvetes

- **Consumo específico**: 700 a 1200 kWh por tonelada de sorvete acabado (Erbay et al., Energy 2017). É um dos processos mais intensivos em energia da indústria de alimentos, por causa do freezing tunnel.
- **Eficiência exergética** do sistema de refrigeração: ~25,5% em plantas típicas — há muito espaço para melhoria.
- **Distribuição típica do consumo**:
  - Refrigeração e compressores: **55-70%** (câmaras + freezing tunnel + chiller de mistura)
  - Extrusão e processo: 15-25%
  - Iluminação, ar comprimido, utilidades: 10-20%
- **Potencial de economia**: 11-30% só com otimização de compressores (variadores de frequência, sequenciamento, manutenção preditiva).

---

## KPIs comuns que dashboards de mercado mostram

1. Consumo total kWh (dia/semana/mês) com comparação ano-a-ano
2. **Custo em R$** estimado, não só kWh — gerentes pensam em dinheiro
3. kWh por tonelada de produto
4. Ranking Pareto por equipamento
5. **Fator de potência por unidade** com semáforo e multa estimada
6. Heatmap dia × hora
7. Percentual de consumo em ponta vs fora-ponta
8. Alerta de anomalia (baseline + 2σ)
9. **Economia potencial em R$/mês** se ações sugeridas forem tomadas

---

## Referências

- ANEEL · PRODIST Módulo 8 versão 13: https://www2.aneel.gov.br/cedoc/aren2021956_prodist_modulo_8_v13.pdf
- O Setor Elétrico · Nova abordagem da cobrança de reativo: https://www.osetoreletrico.com.br/a-nova-abordagem-da-cobranca-da-energia-reativa-e-o-limite-do-fator-de-potencia/
- UNESP · Medidas de potência trifásica (didático): https://www.feis.unesp.br/Home/departamentos/engenhariaeletrica/exp07_2---medidas-de-potencia-trifasica---correcao-do-fator-de-potencia_eletrotecnica.pdf
- Schneider EcoStruxure Power Monitoring Expert: https://www.se.com/us/en/product-range/65404-ecostruxure-power-monitoring-expert/
- GreenAnt (plataforma BR): https://www.greenant.com.br/
- Erbay et al., Energy 2017 · Análise exergética de planta de sorvete: https://www.sciencedirect.com/science/article/abs/pii/S0360544217301810
- ISO 50001 · Gestão de energia (visão geral): https://www.iso.org/iso-50001-energy-management.html
