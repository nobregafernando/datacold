# DataCold · Backend Supabase

Tudo roda **dentro do Supabase** (Postgres + pg_cron). Sua máquina pode ficar
desligada — o banco continua gerando pontos sozinho a cada minuto. O site vai
puxar dados via REST/PostgREST que o Supabase já expõe pra todas as tabelas.

---

## Arquivos

```
supabase/
├── schema.sql          Estrutura: tabelas, índices, triggers, view de conveniência
├── auth.sql            perfis_usuarios + trigger auth.users + RLS em tudo
├── simulador_db.sql    Funções PL/pgSQL que geram dados + agendamento pg_cron
├── api_publica.sql     RPCs expostas via PostgREST
├── aplicar.py          Aplica schema.sql + auth.sql + popula seed
└── README.md           Este arquivo
```

---

## Setup de autenticação (Supabase Dashboard)

Antes do primeiro login real, configure no Dashboard do Supabase
(<https://supabase.com/dashboard>):

### Authentication → Providers
- **Email** habilitado.
- **"Confirm email"** ⇒ **DESABILITADO** (login libera direto, alinhado com a decisão do projeto).

### Authentication → Policies
- **Minimum password length** ⇒ `10`.

### Authentication → URL Configuration
- **Site URL** ⇒ `https://datacold.web.app`
- **Redirect URLs** (adicionar **as duas**):
  - `https://datacold.web.app/paginas/conta/redefinir/`  (esqueci senha)
  - `https://datacold.web.app/paginas/conta/definir/`    (convite de novo usuário)

Sem isso, o link que o Supabase envia por e-mail volta como "Invalid Redirect URL".

### Authentication → Email Templates → "Reset Password"

Cole o conteúdo de **`supabase/email-template-convite.html`** no editor de
"Reset Password" (a Supabase usa o mesmo template para o nosso fluxo de
convite, já que internamente disparamos `/auth/v1/recover`).

- **Subject** sugerido: `Você foi convidado para a DataCold`
- O template já contém todas as variáveis Go (`{{ .ConfirmationURL }}`,
  `{{ .Email }}`, `{{ .SiteURL }}`) e está com CSS inline para funcionar
  em Outlook/Gmail.

### Primeiro admin

O usuário `fernandonobregaalves@gmail.com` é promovido automaticamente
para `admin` pelo trigger `fn_criar_perfil_padrao` (definido em
`auth.sql`) assim que cria conta no Supabase. Qualquer outra conta
começa como `operador` — só admin pode criar usuários via
`/paginas/conta/criar/`.

---

## Como aplicar do zero

```bash
cd /Users/fernando/Documents/Projetos/datacold
simulador/.venv/bin/python supabase/aplicar.py        # cria tabelas + seed
```

Depois, para ligar a geração automática:

```bash
simulador/.venv/bin/python -c "
import os, psycopg2; from dotenv import load_dotenv; from pathlib import Path
load_dotenv('.env')
c = psycopg2.connect(host='aws-1-us-west-1.pooler.supabase.com', port=6543,
    dbname='postgres', user=f'postgres.{os.environ[\"SUPABASE_PROJECT_ID\"]}',
    password=os.environ['SUPABASE_DB_PASSWORD'], sslmode='require')
c.autocommit = True
c.cursor().execute(Path('supabase/simulador_db.sql').read_text())
print('ok')
"
```

E para gerar histórico retroativo (ex: últimas 24h):

```sql
select sim_warmup(24);    -- retorna nº de pontos gerados
```

Para resetar tudo:

```sql
truncate leituras_energia, leituras_temperatura, leituras_porta restart identity;
truncate incidentes, auditoria restart identity;
-- sensores e grupos permanecem (vêm do seed do aplicar.py)
```

---

## Tabelas

| Tabela | Conteúdo |
|---|---|
| `grupos` | 6 grupos físicos (extrusao, camara_congelados, …) |
| `sensores` | catálogo dos 14 sensores + parâmetros em jsonb |
| `leituras_energia` | série temporal — sensores trifásicos (corrente A/B/C, tensão A/B/C, FP A/B/C) |
| `leituras_temperatura` | série temporal — sensores de temperatura |
| `leituras_porta` | série temporal — sensores de porta (binário ou semi-analógico) |
| `incidentes` | falhas injetadas (spike/drift/gap/offline/valor_impossivel) com histórico |
| `auditoria` | log automático de INSERT/UPDATE/DELETE em grupos/sensores/incidentes |

Todas as tabelas têm `criado_em`, `atualizado_em`, `criado_por`, `atualizado_por`.
Triggers cuidam de `atualizado_em` e da auditoria automaticamente.

A `auditoria` **não** registra inserts de leituras (são append-only, geram
volume demais). Cobre `grupos`, `sensores` e `incidentes`.

View extra: **`ultima_leitura_por_sensor`** — devolve a leitura mais recente
de qualquer sensor (independente do tipo) num único `select`.

---

## Como a geração funciona (sem depender da sua máquina)

```
       pg_cron (extensão Postgres dentro do Supabase)
             │
             │  '* * * * *' (a cada minuto)
             ▼
        sim_tick()  ── itera todos os sensores ativos
             │
   ┌─────────┼──────────────────────────┐
   ▼         ▼                          ▼
sim_gerar_energia   sim_gerar_temperatura   sim_gerar_porta
   │                  │                      │
   │  lê parâmetros do sensor (jsonb)        │
   │  aplica modulação dia/noite, ciclo,     │
   │  consulta incidentes ativos             │
   ▼                  ▼                      ▼
leituras_energia   leituras_temperatura   leituras_porta
```

**A cadência hoje é 1 ponto por sensor por minuto.** Pra mudar, edite o
agendamento:

```sql
select cron.unschedule('datacold_simulador_tick');
select cron.schedule('datacold_simulador_tick', '*/30 * * * * *',
                     'select sim_tick();');  -- a cada 30s
```

(formato com 6 campos = inclui segundos, depende da versão do pg_cron)

---

## Como o site puxa dados (REST automático)

O Supabase expõe **PostgREST** automaticamente em todas as tabelas. Não
precisa criar API — já está pronta.

```
URL base: https://fcverbceppwdbveustvq.supabase.co/rest/v1
Header:   apikey: <SUPABASE_ANON_KEY ou SERVICE_ROLE>
          Authorization: Bearer <mesma chave>
```

### Exemplos práticos

```bash
URL="https://fcverbceppwdbveustvq.supabase.co/rest/v1"
KEY="$SUPABASE_ANON_KEY"   # do .env

# Catálogo de sensores
curl -s -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  "$URL/sensores?select=*&order=id"

# Últimos 100 pontos da extrusora_1
curl -s -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  "$URL/leituras_energia?sensor_id=eq.extrusora_1&order=momento.desc&limit=100"

# Últimas 24h de temperatura da câmara de congelados
curl -s -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  "$URL/leituras_temperatura?sensor_id=eq.congelados_temperatura&momento=gte.$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ)&order=momento.asc"

# Última leitura de cada sensor (view)
curl -s -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  "$URL/ultima_leitura_por_sensor?select=*"

# Injetar um incidente (POST com service_role; anon não consegue por padrão)
curl -X POST -s -H "apikey: $SVC" -H "Authorization: Bearer $SVC" \
  -H "Content-Type: application/json" \
  -d '{"sensor_id":"extrusora_1","tipo":"spike","magnitude":5,"fim":"2026-05-24T00:00:00Z","descricao":"demo"}' \
  "$URL/incidentes"
```

### Conectando o front no Supabase

No `ApiBEM.js`, basta trocar a URL base e o cabeçalho. Para um adapter
limpo, criar um novo cliente `ApiSupabase.js` que mapeia:

- `/api/v1/sensors` → `SELECT * FROM sensores` (REST)
- `/api/v1/data?sensor=X&start=...&stop=...` → `SELECT * FROM leituras_<tipo> WHERE sensor_id=X AND momento >= start AND momento <= stop`

A diferença grande vs a BEM real: o REST do PostgREST devolve **só os campos
das tabelas**, sem o wrapper `{type, count, fields, points: [...]}` que o
front espera. A solução mais simples é uma **RPC** (`select * from
buscar_dados('extrusora_1', '-1h', 'now')`) que retorna no formato esperado.
Quando você quiser que eu plugue o front no Supabase, eu crio essa RPC.

---

## Diagnóstico rápido

```sql
-- Cron está rodando?
select jobid, jobname, schedule, active from cron.job;

-- Últimas execuções
select job_pid, runid, status, return_message, start_time, end_time
from cron.job_run_details order by start_time desc limit 5;

-- Quantos pontos por sensor?
select sensor_id, count(*) from leituras_energia group by sensor_id;
select sensor_id, count(*) from leituras_temperatura group by sensor_id;
select sensor_id, count(*) from leituras_porta group by sensor_id;

-- Incidentes ativos
select * from incidentes
where removido_em is null and (fim is null or fim > now());

-- Auditoria das últimas mudanças
select tabela, operacao, registro_id, autor, momento
from auditoria order by momento desc limit 20;
```

---

## Credenciais

Em `.env` na raiz do projeto (já ignorado pelo `.gitignore`):

```
SUPABASE_PROJECT_ID=fcverbceppwdbveustvq
SUPABASE_URL=https://fcverbceppwdbveustvq.supabase.co
SUPABASE_DB_PASSWORD=...
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Connection string para acesso direto ao Postgres:

```
postgresql://postgres.fcverbceppwdbveustvq:<DB_PASSWORD>@aws-1-us-west-1.pooler.supabase.com:6543/postgres?sslmode=require
```
