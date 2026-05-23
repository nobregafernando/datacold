# DataCold

Plataforma de telemetria industrial em tempo real para a sorveteria Dale (MS).
Toma os dados dos 14 sensores que existem na planta, classifica em tempo real
o que cada um está dizendo, alerta sobre o que precisa de ação e disponibiliza
um banco para análise histórica.

**Site público:** https://datacold.web.app
**Repositório:** https://github.com/nobregafernando/datacold

> Projeto do hackathon **BEM Inteligência — Dale Sorvetes / Indústria** (54h).

---

## Sumário

1. [Arquitetura de ponta a ponta](#1-arquitetura-de-ponta-a-ponta)
2. [Os 14 sensores](#2-os-14-sensores)
3. [Os 4 agentes de análise](#3-os-4-agentes-de-análise)
4. [Infraestrutura — 3 pilares](#4-infraestrutura--3-pilares)
5. [Banco de dados](#5-banco-de-dados-supabase--postgresql)
6. [Simulador — nosso ambiente controlado de geração](#6-simulador--nosso-ambiente-controlado-de-geração)
7. [Sala de testes — injetando falhas reais](#7-sala-de-testes--injetando-falhas-reais)
8. [Passeio pelo código](#8-passeio-pelo-código)
9. [Como rodar localmente](#9-como-rodar-localmente)

---

## 1. Arquitetura de ponta a ponta

```
┌────────────────────────────────────────────────────────────────────┐
│  FRONT  (Firebase Hosting · HTML/CSS/JS sem framework)             │
│  ─────────────────────────────────────────────────────────────────│
│  Landing → Login (MVP) → Dashboard                                 │
│     ├─ Página de SENSOR  (14)   ← classe PaginaSensor              │
│     ├─ Página de GRUPO   (6)    ← classe PaginaGrupo               │
│     ├─ Sala de controle         ← injeta incidentes                │
│     └─ Agentes                  ← inspeciona/edita regras           │
└────────────────────────┬───────────────────────────────────────────┘
                         │ HTTPS (auto-refresh 30s)
                         ▼
┌────────────────────────────────────────────────────────────────────┐
│  API     ApiBEM.js  →  Supabase (PostgREST / RPC)                  │
│  ─────────────────────────────────────────────────────────────────│
│  GET  /rpc/listar_sensores       (catálogo + parâmetros)           │
│  POST /rpc/buscar_dados          (série temporal por janela)       │
│  POST /rpc/criar_incidente       (sala de testes)                  │
│  POST /rpc/atualizar_parametros  (override de norma por sensor)    │
└────────────────────────┬───────────────────────────────────────────┘
                         ▼
┌────────────────────────────────────────────────────────────────────┐
│  BANCO   Supabase Postgres (us-west-1)                             │
│  ─────────────────────────────────────────────────────────────────│
│  grupos · sensores · leituras_energia/temperatura/porta ·          │
│  incidentes · auditoria                                            │
└────────────────────────┬───────────────────────────────────────────┘
                         ▲
                         │ pg_cron 1 min
┌────────────────────────┴───────────────────────────────────────────┐
│  SIMULADOR — gera os dados                                         │
│  ─────────────────────────────────────────────────────────────────│
│  Versão A · Python local  (simulador/main.py · FastAPI + SQLite)   │
│  Versão B · Funções SQL   (supabase/simulador_db.sql · pg_cron)    │
│  Determinístico: mesma (sensor_id, ts) sempre dá o mesmo ponto.    │
└────────────────────────────────────────────────────────────────────┘
```

O front **não conhece o detector de anomalias** — ele recebe pontos, instancia
o agente do tipo certo, e a UI já consegue desenhar chip por chip o que está
saudável e o que não está. A regra é declarativa (`scripts/agentes/Regra.js`);
mudar limite é editar um JSON, não JavaScript.

---

## 2. Os 14 sensores

Três famílias de medição, distribuídas em 6 grupos físicos.

| # | Grupo | ID do sensor | Tipo | O que mede |
|---|---|---|---|---|
| 1 | Linha de Extrusão | `extrusora_1` | energia | corrente, tensão, FP por fase |
| 2 | Linha de Extrusão | `extrusora_2` | energia | idem |
| 3 | Linha de Extrusão | `extrusora_3` | energia | idem |
| 4 | Câmara de Congelados | `congelados_compressor` | energia | medidor trifásico do compressor |
| 5 | Câmara de Congelados | `congelados_temperatura` | temperatura | interna da câmara (-28 a -18 °C ideal) |
| 6 | Câmara Fria Estoque | `estoque_compressor_1` | energia | compressor 1 |
| 7 | Câmara Fria Estoque | `estoque_compressor_2` | energia | compressor 2 |
| 8 | Câmara Fria Estoque | `estoque_temperatura` | temperatura | interna (-4 a 4 °C) |
| 9 | Câmara Fria Estoque | `estoque_porta` | porta | sinal bruto da abertura |
| 10 | Câmara Graxaria | `graxaria_energia` | energia | quadro elétrico da câmara |
| 11 | Câmara Graxaria | `graxaria_temperatura` | temperatura | interna (-10 a 4 °C) |
| 12 | Câmara Graxaria | `graxaria_porta` | porta | abertura |
| 13 | Ambiente Externo CG | `externo_cg_temperatura` | temperatura | clima Campo Grande |
| 14 | Ambiente Externo TL | `externo_tl_temperatura` | temperatura | clima Três Lagoas |

**Modelagem em OOP** (`scripts/nucleo/`):

- `Sensor` (classe base) → métodos comuns (status, cor, formatação).
- `SensorEnergia`, `SensorTemperatura`, `SensorPorta` (subclasses).
- `FabricaSensor.criar(dadosDaApi)` → escolhe a subclasse certa.

Cada subclasse implementa `calcularIndicadores(pontos)` que devolve os KPIs
(potência média, FP composto, % CUB/VUB, faixa térmica etc.).

---

## 3. Os 4 agentes de análise

Strategy + Rule Engine em `scripts/agentes/`. O orquestrador
(`scripts/nucleo/AnalisadorSensor.js`) recebe `(sensor, pontos)` e delega
pro agente certo via `FabricaAgente.criar(sensor)`.

### 3.1 `AgenteEnergia`
Trifásico industrial. Pré-calcula contexto: FP composto, fluxo reverso (FP
negativo em alguma fase), %CUB e %VUB pela fórmula NEMA, fases ausentes, pico
de corrente, consumo dia vs noite (phantom load). Confronta com as normas
(PRODIST 8 ANEEL, NEMA MG-1) e emite vereditos por regra.

### 3.2 `AgenteTemperatura`
Câmaras controladas + ambiente externo. Calcula média, desvio, amplitude,
tempo fora da faixa ideal (por grupo: congelados −28/−18 °C, estoque −4/4 °C,
graxaria −10/4 °C), tendência °C/h, picos por z-score e leituras
fisicamente impossíveis (>85 °C numa câmara fria = sensor com defeito).

### 3.3 `AgentePorta`
Sinal binário (em alguns sensores é analógico próximo a binário). Extrai
eventos de abertura por transição (0 → >0), calcula tempo total aberta,
duração média/maior evento, fração do tempo aberta, padrão hora-a-hora,
quantas vezes na 1ª vs 2ª metade da janela.

### 3.4 `AgenteReconstrutor` — preenche lacunas
Quando a telemetria tem gaps (link caiu, gateway com fila, bateria fraca), o
reconstrutor **interpola sem inventar**:

- `tensao_*` → média do contexto adjacente (sinal estável).
- `corrente_*` → SPLC multi-ciclo (busca o "mesmo horário" 24h e 7d atrás,
  descarta outliers por z-score > 3, devolve média ponderada).
- `fator_potencia_*` → média local.
- `temperatura (ambiente)` → SPLC com peso forte no ciclo diário.
- `temperatura (câmara)` → SPLC + correção pela tendência local.
- `abertura_porta` → step (mantém último estado conhecido).

Cada ponto reconstruído carrega **score de confiança** (0–1) calculado por
campo e combinado. A UI pode mostrar (linha pontilhada, opacidade) que
aquele trecho foi inferido.

### Catálogo de regras editável

`scripts/agentes/normas.js` — todos os limites técnicos numa fonte só
(PRODIST, NEMA, ANVISA, Codex), com `valor` + `fonte` (string para auditoria
no front). Cada `sensor.parametros` no banco pode sobrepor a norma só pra
aquele sensor (jsonb, merge). A página **Agentes** (`/paginas/admin/agentes/`)
é a UI para editar isso sem tocar em SQL.

---

## 4. Infraestrutura — 3 pilares

### 4.1 Identidade da infra

| Camada | Tecnologia | Onde |
|---|---|---|
| Front | HTML/CSS/JS puro (sem framework, sem build pesado) | Firebase Hosting (`datacold.web.app`) |
| API | PostgREST RPC + funções PL/pgSQL | Supabase (Postgres us-west-1) |
| Banco | Postgres 15 + pg_cron + RLS | Supabase |
| Cache-bust | `versao.json` + querystring `?v=<build_id>` automática em todos os HTMLs | `scripts/build/versionar.js` |
| Auth | Supabase Auth opcional (hoje MVP local em `localStorage`) | Front |

Sem Node em produção. O build é `scripts/build/aplicar-sem-cache.js` que
injeta um snippet de service-worker cleanup nos HTMLs e gera um novo
`versao.json`. Tudo o resto é estático.

### 4.2 Reconexão automática e detecção de queda

O front trata o sensor como vivo/instável/offline pelo intervalo entre
leituras (baseline da indústria — heartbeat virtual):

```
intervalo_medio = EWMA(deltas)
desvio_atual    = agora − ultima_leitura

online    se desvio_atual ≤ 3 × intervalo_medio
instavel  se 3× < desvio_atual ≤ 10×
offline   se desvio_atual > 10× intervalo_medio
```

Implementado em `AgenteBase.verificarConectividade()` (todos os agentes
herdam) e renderizado no banner de cada página de sensor + no card mini do
comparativo de grupo. O **AgenteReconstrutor** entra em ação quando há gaps
no meio da série (não no fim) — preenche pra não quebrar gráficos.

### 4.3 Filas e cadência

| Camada | O que faz | Quanto |
|---|---|---|
| `sim_tick` (pg_cron no banco) | gera 1 ponto por sensor ativo | 60 s |
| Front auto-refresh | refaz `buscar_dados` e re-renderiza | 30 s |
| Front visibility | pausa auto-refresh quando aba fica oculta | imediato |
| `Notificacoes` bus | event bus em `localStorage` + `storage` event | sincroniza entre abas em < 50 ms |
| Cache HTTP | `versao.json` é lido a cada carga; build novo invalida | a cada page load |

Não há broker (Kafka/RabbitMQ) — o "fila" do projeto é a tabela
`leituras_*` (append-only, indexada por `sensor_id, momento`). O agente lê
sempre a janela `[start, stop]` e ignora o resto.

---

## 5. Banco de dados (Supabase / PostgreSQL)

Schema completo em `supabase/schema.sql`. 7 tabelas:

| Tabela | Propósito |
|---|---|
| `grupos` | os 6 ambientes físicos |
| `sensores` | catálogo dos 14 + `parametros` jsonb (overrides de norma) |
| `leituras_energia` | série temporal trifásica (3 sensores × N) |
| `leituras_temperatura` | série temporal de temperatura |
| `leituras_porta` | série temporal de abertura |
| `incidentes` | falhas injetadas pela sala de testes |
| `auditoria` | log automático de toda mudança em grupos/sensores/incidentes |

Trigger `fn_registrar_auditoria()` grava `dados_antes`/`dados_depois` em JSON
com autor lido do JWT. Leituras **não** são auditadas (append-only).

### API pública via RPC

Funções em `supabase/api_publica.sql`:

```
listar_sensores()                 → catálogo
buscar_dados(sensor, start, stop) → { sensor, type, count, fields, window, points }
criar_incidente(...)              → injeta falha (ver §7)
cancelar_incidente(id)
atualizar_parametros(sensor, patch jsonb)
```

A função `buscar_dados` aceita expressões relativas (`-1h`, `-7d`, `now`) via
`sim_parse_tempo()`, igual à API BEM original.

---

## 6. Simulador — nosso ambiente controlado de geração

Para conseguir testar comportamentos específicos (FP caindo, porta esquecida
aberta, fase ausente) sem esperar acontecer na fábrica, criamos um **gerador
próprio de dados sintéticos**. Duas versões:

### Versão A — Python local (`simulador/`)
FastAPI + SQLite. Sobe um servidor que espelha os endpoints da API BEM real.
Pra desenvolver com latência zero e dados controlados:

```
cd simulador
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Front aponta pra ele com:
```js
localStorage.setItem("datacold_api_url", "http://127.0.0.1:8000")
```

### Versão B — Funções SQL no Supabase (`supabase/simulador_db.sql`)
Mesma lógica de geração, mas portada pra PL/pgSQL e rodando via `pg_cron`
no próprio Supabase. É o que está em produção em `datacold.web.app`.

### Como cada tipo é modelado (`simulador/geradores.py`)

- **Energia (motor industrial)** — soma de oscilações em múltiplas
  frequências (carga, partida do compressor) + picos de partida 5–7× a
  corrente nominal + ruído.
- **Temperatura (câmara controlada)** — termostato em dente-de-serra
  (compressor liga/desliga oscilando entre limites da faixa ideal).
- **Temperatura (ambiente externo)** — cossenoide diária + ruído de
  baixa frequência (maré semanal).
- **Porta** — eventos por Poisson com janelas de duração exponencial;
  frequência maior em horário comercial.

Tudo determinístico em função de `(sensor_id, timestamp)` — chamar a mesma
combinação 2× devolve o mesmo valor. Isso permite gerar 7 dias de histórico
em batch (warm-up) e continuar gerando 1 ponto a cada minuto sem descontinuidade.

### "Personalidade" de cada sensor (`simulador/perfis.py`)

Cada um dos 14 tem uma personalidade que reflete os achados que a indústria
costuma ver:
- `extrusora_1` → FP baixo crônico (capacitor queimado), drops esporádicos.
- `extrusora_3` → fluxo reverso (TC do medidor invertido).
- `congelados_temperatura` → sensor com spikes ocasionais de +85 °C (falha do sensor).
- `estoque_compressor_1` → CUB alto (desequilíbrio severo de corrente).
- `graxaria_porta` → padrão de aberturas mudou na 2ª metade (turno novo).

---

## 7. Sala de testes — injetando falhas reais

`paginas/admin/sala-controle/` é uma página administrativa que cria
**incidentes** — alterações temporárias na geração de dados que vão valer
até serem canceladas.

| Tipo | O que faz |
|---|---|
| `spike` | multiplica o valor principal por `magnitude` (corrente, temperatura…) |
| `drift` | soma `magnitude` ao valor (deriva linear) |
| `gap` | suprime o ponto (sensor "desaparece") |
| `offline` | equivalente ao gap, semanticamente "sensor parou" |
| `valor_impossivel` | substitui pelo valor literal (ex: +85 °C numa câmara fria) |

Fluxo: o usuário escolhe sensor + tipo + magnitude → POST
`/rpc/criar_incidente` → grava em `incidentes` → o gerador (Python ou
SQL) consulta essa tabela em cada ponto novo e aplica a transformação.
Cancelar é um POST em `cancelar_incidente(id)`.

Resultado: dá pra **provocar** uma anomalia e ver os agentes detectando ela
em <60s (próximo `sim_tick`) e o front mostrando o alerta no menu superior
em <30s (próximo auto-refresh).

---

## 8. Passeio pelo código

```
datacold/
├── index.html                       Landing pública
├── landing.css, landing.js          Estilos/script da landing
├── 404.html                         Página de erro custom
├── versao.json                      Build id (cache-bust)
├── firebase.json                    Hosting config
│
├── estilos/                         CSS globais
│   ├── global.css                   paleta, tipografia, botões, tokens
│   ├── sensor.css                   layout da página de sensor
│   └── grupo.css                    layout da página de comparativo de grupo
│
├── assets/   logo/                  imagens, favicons
│
├── scripts/
│   ├── nucleo/                      "Modelo" — só dados/lógica, sem UI
│   │   ├── ApiBEM.js                cliente HTTP (Supabase RPC)
│   │   ├── Sensor.js + 3 subclasses (Energia/Temperatura/Porta)
│   │   ├── FabricaSensor.js         factory
│   │   ├── AnalisadorSensor.js      orquestrador fino → delega pro agente
│   │   ├── Notificacoes.js          event bus global em localStorage
│   │   ├── Usuario.js               domínio do usuário logado
│   │   └── Autenticacao.js          gate de login MVP
│   │
│   ├── agentes/                     Rule Engine — análise automática
│   │   ├── normas.js                PRODIST, NEMA, ANVISA, Codex (limites)
│   │   ├── Regra.js                 estrutura { pergunta, verifica, recomenda }
│   │   ├── verificacoesComuns.js    helpers (média, σ, gaps, EWMA)
│   │   ├── AgenteBase.js            classe-base + conectividade/telemetria
│   │   ├── AgenteEnergia.js         regras de FP, CUB, VUB, fluxo reverso
│   │   ├── AgenteTemperatura.js     faixa térmica, oscilação, impossíveis
│   │   ├── AgentePorta.js           eventos, fração aberta, padrões
│   │   ├── AgenteReconstrutor.js    interpolação multi-ciclo SPLC + confiança
│   │   └── FabricaAgente.js         Factory + catálogo
│   │
│   ├── componentes/                 UI reutilizável
│   │   ├── MenuLateral.{js,css}     drawer mobile + sublista de sensores
│   │   └── MenuTopo.{js,css}        header sticky + sino de notificações
│   │
│   └── build/                       Scripts Node (não rodam no browser)
│       ├── versionar.js             gera versao.json novo
│       └── aplicar-sem-cache.js     injeta BLOCO-SEM-CACHE + ?v= nos HTMLs
│
├── paginas/
│   ├── login/                       login MVP
│   ├── admin/
│   │   ├── admin.{html,css,js}      DASHBOARD — mapa da planta (14 cards)
│   │   ├── agentes/                 página: catálogo + edição de parâmetros
│   │   ├── sala-controle/           página: injetar incidentes
│   │   ├── apresentacao/            pptx + viewer embed
│   │   ├── sensores/
│   │   │   ├── _compartilhado/      pagina.js + estilo.css (FONTE ÚNICA)
│   │   │   └── <id>/index.html      14 pastas (uma por sensor)
│   │   └── grupos/
│   │       ├── _modelo/             template
│   │       └── <gid>/               6 pastas (comparativo entre sensores do mesmo grupo)
│   │
│
├── simulador/                       Versão A — Python local (FastAPI + SQLite)
│   ├── main.py                      endpoints
│   ├── perfis.py                    catálogo + personalidade dos 14
│   ├── geradores.py                 modelos físicos (puros, determinísticos)
│   ├── incidentes.py                injeção de falhas
│   ├── estado.py + armazenamento.py persistência local
│   └── requirements.txt
│
├── supabase/                        Versão B — Postgres (produção)
│   ├── schema.sql                   tabelas + triggers + auditoria
│   ├── simulador_db.sql             sim_tick (cron 1 min) + sim_warmup
│   ├── api_publica.sql              funções RPC expostas via PostgREST
│   └── aplicar.py                   migração via psycopg2
│
└── estudos/                         pesquisa anterior ao código
    ├── sensores.md
    ├── conectividade.md, conectividade/ (protótipo)
    ├── eficiencia-energetica.md
    ├── manutencao-preditiva.md
    └── controle-producao.md
```

### Fluxo de uma requisição (página de sensor)

```
1. Browser carrega .../sensores/extrusora_1/index.html
2. pagina.js (de _compartilhado/) detecta o id na URL
3. ApiBEM.buscarDados("extrusora_1", "-1h", "now") → RPC Supabase
4. Supabase retorna { points: [...], fields, type, count }
5. FabricaSensor.criar(catalogoDoSensor) → instancia SensorEnergia
6. SensorEnergia.calcularIndicadores(pontos) → 6 KPIs
7. FabricaAgente.criar(sensor) → instancia AgenteEnergia
8. AgenteEnergia.avaliar(pontos) → vereditos [{regra, severidade, mensagem}]
9. UI renderiza KPIs + chips de verificação + gráficos Chart.js
10. setInterval 30 s repete passos 3-9
```

---

## 9. Como rodar localmente

```bash
# 1. Clonar
git clone https://github.com/nobregafernando/datacold.git
cd datacold

# 2. Servir o front (qualquer servidor estático)
python3 -m http.server 8080
# acesse http://localhost:8080 → "Acessar painel" → "Entrar como Fernando"

# 3. (opcional) Subir o simulador Python pra dev rápido
cd simulador
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 4. Apontar o front pro simulador local
# no console do browser:
localStorage.setItem("datacold_api_url", "http://127.0.0.1:8000")
location.reload()
```

### Aplicar/atualizar o banco no Supabase

```bash
# Requer .env com SUPABASE_PROJECT_ID + SUPABASE_DB_PASSWORD
pip3 install psycopg2-binary python-dotenv
python3 supabase/aplicar.py            # schema + seed
python3 supabase/aplicar.py --so-seed  # só o catálogo (idempotente)
python3 supabase/aplicar.py --info     # contagem por tabela
```

### Publicar nova versão (Firebase)

```bash
node scripts/build/versionar.js          # gera versao.json novo
node scripts/build/aplicar-sem-cache.js  # injeta ?v= nos HTMLs
firebase deploy --only hosting
```
