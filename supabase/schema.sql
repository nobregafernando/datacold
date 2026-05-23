-- ============================================================
--  DataCold · Schema completo (Supabase / PostgreSQL)
-- ============================================================
--  Tabelas (português):
--    grupos              · 6 grupos físicos da planta
--    sensores            · catálogo dos 14 sensores
--    leituras_energia    · série temporal dos sensores de energia
--    leituras_temperatura· série temporal dos sensores de temperatura
--    leituras_porta      · série temporal dos sensores de porta
--    incidentes          · falhas injetadas (histórico auditável)
--    auditoria           · log de toda mudança em grupos/sensores/incidentes
--
--  Auditoria automática via trigger em tabelas de cadastro
--  (leituras NÃO são auditadas — são append-only e geram muito volume).
-- ============================================================

-- =============== 1. EXTENSÕES ===============
create extension if not exists "pgcrypto";   -- gen_random_uuid()


-- =============== 2. FUNÇÕES DE INFRAESTRUTURA ===============

-- Atualiza `atualizado_em` automaticamente em qualquer UPDATE.
create or replace function fn_tocar_atualizado_em()
returns trigger as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$ language plpgsql;


-- Função genérica de auditoria. Grava o estado antes e depois em
-- formato JSON, com o "autor" lido da sessão (PostgREST seta no JWT;
-- via conexão direta usa current_user).
create or replace function fn_registrar_auditoria()
returns trigger as $$
declare
  v_autor    text;
  v_id_texto text;
begin
  -- autor da operação
  v_autor := coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'email',
    current_setting('app.autor', true),
    current_user
  );

  -- id do registro como texto
  if (tg_op = 'DELETE') then
    v_id_texto := coalesce(old.id::text, '');
  else
    v_id_texto := coalesce(new.id::text, '');
  end if;

  insert into auditoria (tabela, operacao, registro_id, dados_antes, dados_depois, autor)
  values (
    tg_table_name,
    tg_op,
    v_id_texto,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end,
    v_autor
  );
  return coalesce(new, old);
end;
$$ language plpgsql;


-- =============== 3. AUDITORIA ===============
create table if not exists auditoria (
  id           bigserial primary key,
  tabela       text        not null,
  operacao     text        not null check (operacao in ('INSERT','UPDATE','DELETE')),
  registro_id  text,
  dados_antes  jsonb,
  dados_depois jsonb,
  autor        text,
  momento      timestamptz not null default now()
);
create index if not exists idx_auditoria_tabela_momento on auditoria (tabela, momento desc);
create index if not exists idx_auditoria_registro       on auditoria (tabela, registro_id);

comment on table  auditoria is 'Log de mudanças em grupos, sensores e incidentes.';
comment on column auditoria.tabela        is 'Nome da tabela afetada.';
comment on column auditoria.operacao      is 'INSERT, UPDATE ou DELETE.';
comment on column auditoria.dados_antes   is 'Snapshot do registro antes da mudança (NULL em INSERT).';
comment on column auditoria.dados_depois  is 'Snapshot do registro depois da mudança (NULL em DELETE).';
comment on column auditoria.autor         is 'Email do usuário autenticado ou current_user.';


-- =============== 4. GRUPOS FÍSICOS ===============
create table if not exists grupos (
  id              text        primary key,
  rotulo          text        not null,
  descricao       text,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  criado_por      text,
  atualizado_por  text
);

comment on table  grupos is 'Grupos físicos da planta (linha de extrusão, câmaras, ambiente externo).';
comment on column grupos.id     is 'Identificador estável (ex: extrusao, camara_congelados).';
comment on column grupos.rotulo is 'Nome para exibição na UI.';

drop trigger if exists trg_grupos_tocar on grupos;
create trigger trg_grupos_tocar
  before update on grupos
  for each row execute function fn_tocar_atualizado_em();

drop trigger if exists trg_grupos_auditoria on grupos;
create trigger trg_grupos_auditoria
  after insert or update or delete on grupos
  for each row execute function fn_registrar_auditoria();


-- =============== 5. SENSORES ===============
create table if not exists sensores (
  id              text        primary key,
  rotulo          text        not null,
  tipo            text        not null check (tipo in ('energia','temperatura','porta')),
  grupo_id        text        not null references grupos(id) on delete restrict,
  status          text        not null default 'ativo'
                              check (status in ('ativo','historico','offline')),
  personalidade   text,
  parametros      jsonb       not null default '{}'::jsonb,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  criado_por      text,
  atualizado_por  text
);
create index if not exists idx_sensores_tipo  on sensores (tipo);
create index if not exists idx_sensores_grupo on sensores (grupo_id);

comment on table  sensores is 'Catálogo dos 14 sensores físicos da planta.';
comment on column sensores.tipo          is 'energia, temperatura ou porta.';
comment on column sensores.status        is 'ativo (gera dados), historico (só janela antiga) ou offline.';
comment on column sensores.personalidade is 'Descrição livre da característica/falha embutida.';
comment on column sensores.parametros    is 'Parâmetros físicos específicos do tipo (faixas, baselines, etc).';

drop trigger if exists trg_sensores_tocar on sensores;
create trigger trg_sensores_tocar
  before update on sensores
  for each row execute function fn_tocar_atualizado_em();

drop trigger if exists trg_sensores_auditoria on sensores;
create trigger trg_sensores_auditoria
  after insert or update or delete on sensores
  for each row execute function fn_registrar_auditoria();


-- =============== 6. LEITURAS POR TIPO ===============
--  Três tabelas separadas porque cada tipo tem colunas diferentes.
--  Sensores compartilham apenas (id, momento) — restante é específico.

-- ----- 6.1 ENERGIA (motores trifásicos) -----
create table if not exists leituras_energia (
  id                bigserial   primary key,
  sensor_id         text        not null references sensores(id) on delete cascade,
  momento           timestamptz not null,
  corrente_fase_a   numeric(10,3),
  corrente_fase_b   numeric(10,3),
  corrente_fase_c   numeric(10,3),
  tensao_fase_a     numeric(10,3),
  tensao_fase_b     numeric(10,3),
  tensao_fase_c     numeric(10,3),
  fator_potencia_a  numeric(6,4),
  fator_potencia_b  numeric(6,4),
  fator_potencia_c  numeric(6,4),
  criado_em         timestamptz not null default now(),
  unique (sensor_id, momento)
);
create index if not exists idx_leit_energia_sensor_momento
  on leituras_energia (sensor_id, momento desc);

comment on table leituras_energia is 'Série temporal dos sensores de energia (3 fases: corrente, tensão, FP).';

-- ----- 6.2 TEMPERATURA -----
create table if not exists leituras_temperatura (
  id          bigserial   primary key,
  sensor_id   text        not null references sensores(id) on delete cascade,
  momento     timestamptz not null,
  temperatura numeric(7,2) not null,
  criado_em   timestamptz not null default now(),
  unique (sensor_id, momento)
);
create index if not exists idx_leit_temp_sensor_momento
  on leituras_temperatura (sensor_id, momento desc);

comment on table leituras_temperatura is 'Série temporal dos sensores de temperatura.';

-- ----- 6.3 PORTA -----
create table if not exists leituras_porta (
  id              bigserial   primary key,
  sensor_id       text        not null references sensores(id) on delete cascade,
  momento         timestamptz not null,
  abertura_porta  numeric(8,2) not null,
  criado_em       timestamptz not null default now(),
  unique (sensor_id, momento)
);
create index if not exists idx_leit_porta_sensor_momento
  on leituras_porta (sensor_id, momento desc);

comment on table leituras_porta is 'Série temporal dos sensores de porta (binário ou semi-analógico).';


-- =============== 7. INCIDENTES (falhas injetadas) ===============
create table if not exists incidentes (
  id              uuid        primary key default gen_random_uuid(),
  sensor_id       text        not null references sensores(id) on delete cascade,
  tipo            text        not null
                              check (tipo in ('spike','drift','gap','offline','valor_impossivel')),
  magnitude       numeric     not null default 0,
  valor           numeric     not null default 0,
  descricao       text,
  inicio          timestamptz not null default now(),
  fim             timestamptz,
  removido_em     timestamptz,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  criado_por      text,
  atualizado_por  text
);
create index if not exists idx_incidentes_sensor on incidentes (sensor_id);
create index if not exists idx_incidentes_nao_removidos on incidentes (sensor_id)
  where removido_em is null;

comment on table  incidentes is 'Histórico de incidentes injetados no simulador (falhas controladas).';
comment on column incidentes.tipo  is 'spike, drift, gap, offline ou valor_impossivel.';
comment on column incidentes.fim   is 'Quando expira automaticamente; NULL = permanente até DELETE.';
comment on column incidentes.removido_em is 'Quando o incidente foi cancelado manualmente.';

drop trigger if exists trg_incidentes_tocar on incidentes;
create trigger trg_incidentes_tocar
  before update on incidentes
  for each row execute function fn_tocar_atualizado_em();

drop trigger if exists trg_incidentes_auditoria on incidentes;
create trigger trg_incidentes_auditoria
  after insert or update or delete on incidentes
  for each row execute function fn_registrar_auditoria();


-- =============== 8. VIEW DE CONVENIÊNCIA ===============
--  Última leitura de cada sensor (independente do tipo) — útil pro front
--  fazer "tempo real" sem precisar consultar 3 tabelas.
create or replace view ultima_leitura_por_sensor as
select sensor_id, momento, 'energia' as tipo,
       to_jsonb(l) - 'id' - 'criado_em' as dados
  from leituras_energia l
 where (sensor_id, momento) in (
   select sensor_id, max(momento) from leituras_energia group by sensor_id
 )
union all
select sensor_id, momento, 'temperatura', to_jsonb(l) - 'id' - 'criado_em'
  from leituras_temperatura l
 where (sensor_id, momento) in (
   select sensor_id, max(momento) from leituras_temperatura group by sensor_id
 )
union all
select sensor_id, momento, 'porta', to_jsonb(l) - 'id' - 'criado_em'
  from leituras_porta l
 where (sensor_id, momento) in (
   select sensor_id, max(momento) from leituras_porta group by sensor_id
 );
