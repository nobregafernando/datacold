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

Strategy + Rule Engine em `scripts/agentes/`. Cada agente é uma **subclasse
de `AgenteBase`** que define:
- `contexto(pontos)` → pré-mastiga métricas comuns às regras (FP composto,
  %CUB, faixa térmica, eventos de porta…). Roda **uma vez** por avaliação.
- `static REGRAS = [...]` → lista de instâncias de `Regra` (cada uma é um
  `{id, categoria, label, fonte, parametros, avaliar(ctx, p)}`).

O orquestrador `AnalisadorSensor.avaliar(sensor, pontos)` chama
`FabricaAgente.criar(sensor)` (escolhe a subclasse pelo `sensor.tipo`) e
devolve um array de vereditos `{status, resumo, detalhe, diagnostico,
valorMedido, valorIdeal, fonte}`.

### 3.1 `AgenteEnergia` — 9 regras (`scripts/agentes/AgenteEnergia.js`)

Contexto pré-calculado: `fp_composto`, `fp_negativo`, `correntes[]`,
`tensoes[]`, `cub_pct`, `vub_pct`, `fases_ausentes[]`, `pico_corrente_x`,
`potencia_kw`, `consumo_madrugada` vs `consumo_comercial`.

| Regra | O que checa | Fonte |
|---|---|---|
| `fp-baixo` | FP composto vs limite mínimo (warn) e crítico | PRODIST 8 ANEEL §3.2 |
| `fluxo-reverso` | Alguma fase com FP negativo (TC invertido) | PRODIST 8 |
| `desequilibrio-corrente` | %CUB vs zona de atenção/crítica | NEMA MG-1 §14.35 |
| `desequilibrio-tensao` | %VUB vs ideal/máximo tolerável | NEMA MG-1 |
| `fase-ausente` | Tensão < 10V em alguma fase | Convenção elétrica |
| `pico-corrente` | Pico / média vs faixa de partida típica (5–7×) | IEEE 141 |
| `phantom-load` | Corrente madrugada (00–05h) vs comercial (08–18h) | Boa prática operacional |
| `tensao-fora-faixa` | Tensão vs ±5% nominal (127V ou 220V) | PRODIST 8 Anexo VIII |
| `potencia-atual` | P = V × I × FP da última leitura (informativo) | Cálculo |

### 3.2 `AgenteTemperatura` — 7 regras

Contexto: `valores[]`, `media`, `desvio`, `min`, `max`, `tempo_fora_pct`,
`tendencia_c_h`, `picos_zscore`, `travado`, `faixa` (por grupo),
`impossivel_count`.

| Regra | O que checa | Fonte |
|---|---|---|
| `leitura-impossivel` | Valores fora do envelope físico (-100 a +100 °C) | Limite físico do termopar |
| `fora-da-faixa` | % do tempo fora da faixa ideal (por câmara) | ANVISA RDC 275, Codex |
| `temperatura-atual` | Valor da última leitura (informativo) | — |
| `oscilacao` | Desvio padrão vs limite (5°C warn) | Engenharia frigorífica |
| `tendencia` | Inclinação °C/h (drift) | Eng. frigorífica |
| `picos-zscore` | Pontos com |z-score| > 3 (outliers) | Estatística |
| `sensor-travado` | σ < 0.05 = sensor não varia (congelado) | Diagnóstico |

### 3.3 `AgentePorta` — 7 regras

Contexto: `eventos[]` (transições 0→>0), `abertas`, `duracao_total_s`,
`duracao_media_s`, `maior_evento_s`, `fracao_aberta`, `aberta_agora`,
`binario`, `metade1_abert` vs `metade2_abert`.

| Regra | O que checa | Fonte |
|---|---|---|
| `porta-esquecida` | Maior abertura > 10 min | Boa prática (perda de frio) |
| `tempo-medio-alto` | Duração média > 2 min | Boa prática operacional |
| `fracao-aberta` | % do período aberta vs aceitável | Custo elétrico |
| `padrao-evolutivo` | 1ª metade vs 2ª metade (mudança > 50%) | Análise de padrão |
| `rajada-aberturas` | Aberturas consecutivas com intervalo < 60s | Eng. operacional |
| `sinal-binario` | Sinal é coerente (binário ou perto disso) | Diagnóstico do sensor |
| `estado-atual` | Porta aberta ou fechada agora (informativo) | — |

### 3.4 `AgenteReconstrutor` — preenche lacunas (`scripts/agentes/AgenteReconstrutor.js`)

Esse não é "rule engine" — é um **algoritmo de inferência** que entra antes
da análise quando a janela tem gaps. Estratégia por campo:

| Campo | Algoritmo |
|---|---|
| `tensao_*` | Média do contexto adjacente (sinal estável). |
| `corrente_*` | **SPLC multi-ciclo**: busca o "mesmo horário" 24h e 7d atrás, descarta outliers por z-score > 3, devolve média ponderada (24h tem peso 2× sobre 7d). |
| `fator_potencia_*` | Média local. |
| `temperatura (ambiente)` | SPLC com peso forte no ciclo diário (cossenoide 24h domina). |
| `temperatura (câmara)` | SPLC + correção pela tendência local da janela. |
| `abertura_porta` | **Step** (mantém último estado conhecido — não interpola). |

Cada ponto reconstruído carrega:
- `meta.fonte = "reconstruido"` (vs `"medido"`)
- `meta.confianca` ∈ [0, 1] — calculada por campo (quantos ciclos
  contribuíram sem outliers × tamanho do gap) e combinada na meta do ponto.

A UI pode usar a confiança pra desenhar linha pontilhada, baixar opacidade
ou esconder o ponto reconstruído.

### Catálogo de regras editável

`scripts/agentes/normas.js` consolida **todas as constantes técnicas** numa
única fonte: ANEEL/PRODIST 8, NEMA MG-1, IEEE 141, ANVISA RDC 275, Codex
Alimentarius CAC/GL 50, engenharia frigorífica, ISO 8000. Cada valor vem
com `{valor, fonte}` — a `fonte` é exibida no veredito da UI pra auditoria.

Para **sobrepor um limite só pra UM sensor** específico (ex: a extrusora 1
tem capacitor diferente e o FP mínimo dela é 0.85 em vez de 0.92), basta
gravar no `sensor.parametros` (jsonb na tabela `sensores` do Supabase). O
agente faz `mesclarParametros(defaults_norma, sensor.parametros)` antes de
avaliar. A página **Agentes** (`/paginas/admin/agentes/`) é a UI pra editar
isso sem tocar em SQL — chama `atualizar_parametros(sensor, patch jsonb)`.

---

## 4. Infraestrutura — 3 pilares

### 4.1 Identidade da infra

| Camada | Tecnologia | Onde |
|---|---|---|
| Front | HTML/CSS/JS puro (sem framework, sem build pesado) | **Firebase Hosting** (`datacold.web.app`) |
| API | PostgREST RPC + funções PL/pgSQL | **Supabase** (Postgres us-west-1) |
| Banco | Postgres 15 + pg_cron + RLS + auditoria automática | **Supabase** |
| Cache-bust | `versao.json` + querystring `?v=<build_id>` automática em todos os HTMLs | `scripts/build/versionar.js` |
| Auth | Supabase Auth opcional (hoje MVP local em `localStorage`) | Front |

**Por que Firebase Hosting?** O front é 100% estático (sem SSR, sem Node em
produção). Firebase entrega CDN global, HTTPS automático, deploys atômicos
com rollback (`firebase hosting:rollback`) e domínio padronizado
(`datacold.web.app`). Custo: zero no plano Spark até o tráfego deste MVP.
Config em `firebase.json` (rewrites, headers de cache, `404.html` próprio).
Deploy é `firebase deploy --only hosting`.

**Por que Supabase?** Precisamos de Postgres real (analytics, índice por
timestamp, jsonb pros parâmetros dos sensores), agendador no banco (pg_cron
pra `sim_tick` a cada 60s), API pública pronta (PostgREST gera HTTP RPC
direto das funções SQL) e autenticação opcional já integrada. Resolve tudo
num provedor só, com `.env` enxuto (`SUPABASE_PROJECT_ID` +
`SUPABASE_DB_PASSWORD`). Acesso ao banco via pooler
`aws-1-us-west-1.pooler.supabase.com:6543` no `supabase/aplicar.py`.

**Por que sem framework no front?** Como o estado do app é praticamente só
a resposta da API + estado local de UI, o ganho de React/Vue/Svelte
seria pequeno comparado ao overhead. Cada página é uma classe ES2022
(`PaginaSensor`, `PaginaGrupo`, `PaginaAdmin`...) que monta MenuLateral +
MenuTopo, chama `ApiBEM.buscarDados()` e usa `setInterval` pra atualizar.
Bundle = zero, tempo de carga = só os bytes do HTML/CSS/JS necessário.

**Build = 2 scripts Node** (`scripts/build/`). `versionar.js` gera um
`versao.json` novo. `aplicar-sem-cache.js` injeta em todos os HTMLs:
- bloco `BLOCO-SEM-CACHE` (desregistra service workers antigos, limpa Cache
  API, e detecta build novo via `versao.json`).
- querystring `?v=<build_id>` em **todos** os `<link>` e `<script>`
  (cache-bust automático sem precisar mudar nome de arquivo).

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

Schema completo em `supabase/schema.sql` (266 linhas). 7 tabelas:

| Tabela | Propósito |
|---|---|
| `grupos` | os 6 ambientes físicos (id, rotulo, descricao) |
| `sensores` | catálogo dos 14 (id, tipo, grupo, status, parametros jsonb) |
| `leituras_energia` | série temporal trifásica (3 sensores × N pontos) |
| `leituras_temperatura` | série temporal de temperatura (4 sensores) |
| `leituras_porta` | série temporal de abertura (2 sensores) |
| `incidentes` | falhas injetadas pela sala de testes |
| `auditoria` | log automático de toda mudança em grupos/sensores/incidentes |

**Convenções:**
- Tudo em **português** (`grupos`, `sensores`, `leituras_*`, `auditoria`).
- `momento` (timestamp) em todas as leituras, indexado em `(sensor_id, momento DESC)`.
- `parametros jsonb` em `sensores` é o que permite override fino das normas
  por sensor (ver §3 — `mesclarParametros`).
- Leituras são **append-only** (sem update/delete em produção) — por isso
  não são auditadas (geram volume demais).

**Auditoria automática:**
Trigger `fn_registrar_auditoria()` em `grupos`, `sensores` e `incidentes`
grava em JSON o estado **antes** e **depois** da mudança, junto com o autor
(lido do JWT do Supabase Auth via `request.jwt.claims` ou
`current_setting('app.autor')`). Permite responder "quem alterou o limite
de FP da extrusora_2 em 17/05" sem ferramenta externa.

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
aberta, fase ausente, sensor com defeito) sem esperar acontecer na fábrica,
criamos um **gerador próprio de dados sintéticos** que reproduz fielmente o
contrato da API BEM real. Existe em **duas versões equivalentes**:

### Versão A — Python local (`simulador/main.py`, FastAPI + SQLite)

Sobe um servidor que **espelha os endpoints da API BEM real** (mesmo
formato de resposta, mesmas expressões de janela tipo `-1h`/`-7d`). O front
não precisa saber se está conversando com a BEM, o Supabase ou o
simulador local — o `ApiBEM.js` lê a URL base de `localStorage`.

**Endpoints públicos (espelham a API BEM):**

| Endpoint | Resposta |
|---|---|
| `GET /health` | `{ ok: true, demo_mode: true }` |
| `GET /api/v1/sensors` | Catálogo: `{ sensors: [...], groups: [...] }` |
| `GET /api/v1/data?sensor=ID&start=-1h&stop=now&limit=1000` | `{ sensor, type, count, fields, window, points: [...] }` |

**Endpoints administrativos (extras, controlam a simulação):**

| Endpoint | O que faz |
|---|---|
| `GET /sim/perfil/{sensor}` | Mostra os parâmetros físicos do sensor (FP base, faixa, etc.) |
| `GET /sim/incidentes` | Lista incidentes ativos |
| `POST /sim/incidente` | Injeta falha (spike/drift/gap/offline/valor_impossivel) |
| `DELETE /sim/incidente/{id}` | Cancela um incidente |
| `POST /sim/resetar` | Apaga o banco local e refaz o warm-up |

**Para rodar:**
```bash
cd simulador
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt           # FastAPI, uvicorn, pydantic
uvicorn main:app --reload --port 8000
```

**Para o front usar o simulador local** (em vez do Supabase):
```js
// Console do browser, qualquer página do datacold:
localStorage.setItem("datacold_api_url", "http://127.0.0.1:8000")
location.reload()
```

Por padrão, no boot, o simulador faz **warm-up de 168h** (7 dias) gerando
1 ponto a cada 60s para cada sensor, e depois um **agendador** (`Agendador`
em `estado.py`) gera 1 ponto novo a cada `TICK_S` segundos (default 5s no
local, dá pra acelerar com `DATACOLD_TICK_S=1`).

### Versão B — Funções SQL no Supabase (`supabase/simulador_db.sql`)

A **mesma lógica de geração**, portada pra PL/pgSQL. É o que está em
produção em `datacold.web.app`:

- `sim_gerar_energia(sensor, ts?)`, `sim_gerar_temperatura(sensor, ts?)`,
  `sim_gerar_porta(sensor, ts?)` — geradores determinísticos espelhados.
- `sim_tick()` — orquestrador chamado por **pg_cron a cada 1 minuto**, gera
  1 ponto pra cada sensor com `status = 'ativo'`.
- `sim_warmup(p_horas)` — backfill retroativo das últimas N horas
  (configurável). Usado uma vez no setup ou após mudanças no catálogo.

Vantagem: zero infraestrutura adicional. O banco é o cron, o gerador e o
endpoint, tudo no mesmo lugar.

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
