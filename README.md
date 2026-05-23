# Datacold

Estamos estudando a infraestrutura de sensores da indústria para entender, antes de escrever uma linha de código, o que está medido, o que está faltando e o que dá pra responder com os dados que existem.

Este repositório guarda a pesquisa de fundo e as primeiras explorações visuais. O software vem depois — só vamos construir o que comprovadamente resolve um problema real da fábrica.

---

## O desafio

Projeto do hackathon **BEM Inteligência — Dale Sorvetes / Indústria** (54 horas).

Uma indústria de sorvetes em Mato Grosso do Sul tem **14 sensores** distribuídos em **6 grupos físicos**, cobrindo extrusoras, compressores, câmaras frias e ambiente externo. Os dados chegam via API REST controlada pela BEM, sem expor o token original do InfluxDB.

A tarefa é transformar essas séries temporais em informação acionável — em **eficiência energética, manutenção preditiva, controle de produção e conectividade**.

---

## Como o estudo está organizado

### `README.md`

Este arquivo. Explica o que estamos fazendo e por quê.

### `estudos/`

Pesquisa de fundo, um arquivo por tema. Cada documento responde a uma pergunta simples: como a indústria já resolve esse tipo de problema hoje?

- **`sensores.md`** — os 14 sensores, como cada tipo funciona fisicamente, onde estão na fábrica
- **`eficiencia-energetica.md`** — fórmulas de potência trifásica, PRODIST 8 da ANEEL, phantom load, tarifa horosazonal
- **`manutencao-preditiva.md`** — NEMA MG-1, EWMA/CUSUM, padrões de falha em compressor de refrigeração
- **`controle-producao.md`** — inferência de estado da máquina, OEE elétrico, impacto da abertura de porta
- **`conectividade.md`** — heartbeat virtual, Hampel filter, score de qualidade ISO 8000, NAMUR NE107
- **`conectividade.html`** — protótipo visual interativo, focado em Conectividade, com perguntas que cada sensor responde e soluções que podem sair delas

---

## O que estudamos até agora

### Sensores

Confirmamos com a própria API que são 3 tipos de medição (energia trifásica, temperatura e abertura de porta) distribuídos em 14 dispositivos físicos. Documentamos como cada tecnologia funciona, o que mede e onde a indústria normalmente usa esse tipo de sensor.

### Práticas da indústria

Pesquisamos como Schneider, Siemens, ThingsBoard, AWS IoT, NAMUR e outras referências resolvem cada uma das quatro frentes do desafio. Anotamos as fórmulas, os padrões regulatórios e os benchmarks aplicáveis ao caso de uma sorveteria.

### Protótipo visual

Construímos uma primeira tela exploratória para o tema de **Conectividade**, com mockups de painel de saúde, detecção de lacunas e alertas. Cada sensor tem uma lista de perguntas que ele consegue responder e checkboxes para decidir o que vira feature do software.

---

## Próximos passos

Depois de fechar quais perguntas queremos responder por sensor, partimos para a definição da arquitetura e construção do software.
