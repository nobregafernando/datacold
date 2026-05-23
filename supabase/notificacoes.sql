-- ============================================================
--  DataCold · Sistema de Notificações multi-usuário
-- ============================================================
--  - notificacoes:           catálogo global (criada UMA vez)
--  - notificacoes_usuario:   estado por usuário (lida, arquivada)
--  - RLS:                    operador só vê notificações criadas
--                            APÓS sua data de cadastro; admin vê tudo
--  - Triggers AFTER INSERT:  em leituras_energia/temperatura/porta
--                            avaliam regras críticas e criam notificação
--  - Dedupe:                 não cria duplicada mesma (sensor, codigo)
--                            ativa nas últimas 1h
-- ============================================================

-- ===================== TABELAS =====================

create table if not exists notificacoes (
  id            uuid primary key default gen_random_uuid(),
  severidade    text not null check (severidade in ('critica','alta','media','comum')),
  titulo        text not null,
  mensagem      text,
  sensor_id     text references sensores(id) on delete cascade,
  origem        jsonb default '{}'::jsonb,
  acao          jsonb default '{}'::jsonb,
  metadados     jsonb default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  criado_por    text default 'sistema'
);
create index if not exists idx_notif_criado_em on notificacoes (criado_em desc);
create index if not exists idx_notif_sensor    on notificacoes (sensor_id);
create index if not exists idx_notif_codigo    on notificacoes (sensor_id, (metadados->>'codigo'), criado_em desc);

comment on table notificacoes is 'Catálogo global de notificações. Estado por usuário em notificacoes_usuario.';

create table if not exists notificacoes_usuario (
  id              bigserial primary key,
  notificacao_id  uuid not null references notificacoes(id) on delete cascade,
  usuario_id      uuid not null references auth.users(id) on delete cascade,
  lido_em         timestamptz,
  arquivado_em    timestamptz,
  unique (notificacao_id, usuario_id)
);
create index if not exists idx_nu_usuario      on notificacoes_usuario (usuario_id);
create index if not exists idx_nu_notificacao  on notificacoes_usuario (notificacao_id);

comment on table notificacoes_usuario is 'Estado por usuário (lida/arquivada) de cada notificação.';


-- ===================== RLS =====================

alter table notificacoes        enable row level security;
alter table notificacoes_usuario enable row level security;

-- Helper: usuário atual é admin?
create or replace function fn_eh_admin_atual()
returns boolean language sql security definer stable as $$
  select coalesce(
    (select papel = 'admin' from perfis_usuarios where id = auth.uid()),
    false
  );
$$;
grant execute on function fn_eh_admin_atual() to anon, authenticated;

-- Helper: data de cadastro do usuário atual
create or replace function fn_cadastro_usuario_atual()
returns timestamptz language sql security definer stable as $$
  select criado_em from perfis_usuarios where id = auth.uid();
$$;
grant execute on function fn_cadastro_usuario_atual() to anon, authenticated;

-- Política notificacoes:
--   admin vê tudo; operador vê só notificações criadas >= seu cadastro
drop policy if exists notificacoes_select on notificacoes;
create policy notificacoes_select on notificacoes
  for select using (
    fn_eh_admin_atual()
    or criado_em >= fn_cadastro_usuario_atual()
  );

-- Política notificacoes_usuario: só vê o próprio estado
drop policy if exists nu_select on notificacoes_usuario;
create policy nu_select on notificacoes_usuario
  for select using (usuario_id = auth.uid() or fn_eh_admin_atual());
drop policy if exists nu_insert on notificacoes_usuario;
create policy nu_insert on notificacoes_usuario
  for insert with check (usuario_id = auth.uid());
drop policy if exists nu_update on notificacoes_usuario;
create policy nu_update on notificacoes_usuario
  for update using (usuario_id = auth.uid());


-- ===================== DEDUPE + CRIAÇÃO =====================

create or replace function fn_criar_notificacao(
  p_severidade text,
  p_titulo     text,
  p_mensagem   text,
  p_sensor_id  text,
  p_codigo     text,
  p_origem     jsonb default '{}'::jsonb,
  p_acao       jsonb default '{}'::jsonb,
  p_metadados  jsonb default '{}'::jsonb,
  p_criado_por text default 'agente'
) returns uuid language plpgsql security definer as $$
declare
  v_id uuid;
begin
  -- Dedupe: não cria se já existe ativa do mesmo (sensor, codigo) na última hora
  select id into v_id
    from notificacoes
   where sensor_id = p_sensor_id
     and metadados->>'codigo' = p_codigo
     and criado_em > now() - interval '1 hour'
   limit 1;
  if v_id is not null then return v_id; end if;

  insert into notificacoes (severidade, titulo, mensagem, sensor_id, origem, acao,
                            metadados, criado_por)
  values (p_severidade, p_titulo, p_mensagem, p_sensor_id, p_origem, p_acao,
          p_metadados || jsonb_build_object('codigo', p_codigo), p_criado_por)
  returning id into v_id;
  return v_id;
end;
$$;


-- ===================== TRIGGERS: AVALIAÇÃO POR LEITURA =====================

-- ENERGIA: avalia o ponto inserido
create or replace function fn_avaliar_energia()
returns trigger language plpgsql as $$
declare
  v_sensor sensores%rowtype;
  v_label  text;
  v_fp_a   numeric := coalesce(new.fator_potencia_a, 0);
  v_fp_b   numeric := coalesce(new.fator_potencia_b, 0);
  v_fp_c   numeric := coalesce(new.fator_potencia_c, 0);
  v_fp_comp numeric := (abs(v_fp_a) + abs(v_fp_b) + abs(v_fp_c)) / 3.0;
  v_neg    boolean := (v_fp_a < 0 or v_fp_b < 0 or v_fp_c < 0);
  v_v_a numeric := coalesce(new.tensao_fase_a, 0);
  v_v_b numeric := coalesce(new.tensao_fase_b, 0);
  v_v_c numeric := coalesce(new.tensao_fase_c, 0);
  v_fases_zero text := '';
begin
  select * into v_sensor from sensores where id = new.sensor_id;
  if v_sensor.id is null then return new; end if;
  v_label := v_sensor.rotulo;

  -- Fluxo reverso (crítico)
  if v_neg then
    perform fn_criar_notificacao(
      'critica',
      'Fluxo reverso detectado',
      v_label || ': FP negativo (TC invertido). Fiação do medidor pode estar invertida.',
      new.sensor_id,
      'fluxo-reverso',
      jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
      jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
      jsonb_build_object('fonte','PRODIST 8 — ANEEL','valorMedido',v_fp_comp)
    );
  -- FP muito baixo (crítico)
  elsif v_fp_comp < 0.85 and v_fp_comp > 0 then
    perform fn_criar_notificacao(
      'critica',
      'FP muito baixo',
      v_label || ': FP composto = ' || round(v_fp_comp,2) || ' (limite ANEEL: 0,92).',
      new.sensor_id,
      'fp-critico',
      jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
      jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
      jsonb_build_object('fonte','PRODIST 8 §3.2','valorMedido',v_fp_comp,'valorIdeal','≥ 0.92')
    );
  -- FP baixo (alta)
  elsif v_fp_comp < 0.92 and v_fp_comp > 0 then
    perform fn_criar_notificacao(
      'alta',
      'FP abaixo do limite ANEEL',
      v_label || ': FP = ' || round(v_fp_comp,2) || '. Verificar banco de capacitores.',
      new.sensor_id,
      'fp-baixo',
      jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
      jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
      jsonb_build_object('fonte','PRODIST 8 §3.2','valorMedido',v_fp_comp,'valorIdeal','≥ 0.92')
    );
  end if;

  -- Fase ausente
  if v_v_a < 10 then v_fases_zero := v_fases_zero || 'A '; end if;
  if v_v_b < 10 then v_fases_zero := v_fases_zero || 'B '; end if;
  if v_v_c < 10 then v_fases_zero := v_fases_zero || 'C '; end if;
  if length(v_fases_zero) > 0 then
    perform fn_criar_notificacao(
      'critica',
      'Fase ausente',
      v_label || ': fase(s) ' || trim(v_fases_zero) || 'sem tensão. Risco de queima.',
      new.sensor_id,
      'fase-ausente',
      jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
      jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
      jsonb_build_object('fonte','Convenção elétrica','fasesAusentes',trim(v_fases_zero))
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_avaliar_energia on leituras_energia;
create trigger trg_avaliar_energia
  after insert on leituras_energia
  for each row execute function fn_avaliar_energia();


-- TEMPERATURA: avalia o ponto inserido
create or replace function fn_avaliar_temperatura()
returns trigger language plpgsql as $$
declare
  v_sensor   sensores%rowtype;
  v_label    text;
  v_faixa    jsonb;
  v_min      numeric;
  v_max      numeric;
begin
  select * into v_sensor from sensores where id = new.sensor_id;
  if v_sensor.id is null then return new; end if;
  v_label := v_sensor.rotulo;

  -- Leitura fisicamente impossível
  if new.temperatura > 100 or new.temperatura < -100 then
    perform fn_criar_notificacao(
      'critica',
      'Leitura impossível',
      v_label || ': ' || new.temperatura || '°C — sensor com defeito.',
      new.sensor_id,
      'leitura-impossivel',
      jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
      jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
      jsonb_build_object('valorMedido',new.temperatura,'valorIdeal','-100 a +100 °C')
    );
    return new;
  end if;

  -- Câmaras com faixa controlada
  v_faixa := case v_sensor.grupo_id
    when 'camara_congelados' then '{"min":-28,"max":-18,"label":"câmara de congelados"}'::jsonb
    when 'camara_estoque'    then '{"min":-4, "max":4, "label":"câmara fria de estoque"}'::jsonb
    when 'graxaria'          then '{"min":-10,"max":4, "label":"câmara da graxaria"}'::jsonb
    else null
  end;
  if v_faixa is null then return new; end if;

  v_min := (v_faixa->>'min')::numeric;
  v_max := (v_faixa->>'max')::numeric;

  if new.temperatura > v_max then
    perform fn_criar_notificacao(
      'critica',
      'Temperatura acima da faixa ideal',
      v_label || ': ' || round(new.temperatura, 1) || '°C (faixa: ' || v_min || ' a ' || v_max || '°C). Risco ao produto.',
      new.sensor_id,
      'temp-acima-faixa',
      jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
      jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
      jsonb_build_object('fonte','ANVISA RDC 275','valorMedido',new.temperatura,'valorIdeal',v_min||' a '||v_max||' °C')
    );
  elsif new.temperatura < v_min then
    perform fn_criar_notificacao(
      'alta',
      'Temperatura abaixo da faixa ideal',
      v_label || ': ' || round(new.temperatura, 1) || '°C (faixa: ' || v_min || ' a ' || v_max || '°C).',
      new.sensor_id,
      'temp-abaixo-faixa',
      jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
      jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
      jsonb_build_object('fonte','ANVISA RDC 275','valorMedido',new.temperatura,'valorIdeal',v_min||' a '||v_max||' °C')
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_avaliar_temperatura on leituras_temperatura;
create trigger trg_avaliar_temperatura
  after insert on leituras_temperatura
  for each row execute function fn_avaliar_temperatura();


-- ===================== RPCs PRA O FRONT =====================

-- Lista as notificações VISÍVEIS pro usuário atual (RLS filtra automaticamente)
-- com o estado (lida/arquivada) do próprio usuário.
create or replace function listar_minhas_notificacoes(
  p_limit       int     default 50,
  p_offset      int     default 0,
  p_status      text    default 'todas',    -- 'todas' | 'nao_lidas' | 'arquivadas' | 'ativas'
  p_severidade  text    default null
) returns jsonb language plpgsql security definer stable as $$
declare
  v_uid uuid := auth.uid();
  v_lista jsonb;
  v_total int;
begin
  if v_uid is null then
    return jsonb_build_object('error','nao_autenticado','notificacoes',jsonb_build_array(),'total',0);
  end if;

  with notif_visiveis as (
    select n.*
      from notificacoes n
     where (fn_eh_admin_atual() or n.criado_em >= fn_cadastro_usuario_atual())
       and (p_severidade is null or n.severidade = p_severidade)
  ),
  com_estado as (
    select v.*,
           nu.lido_em,
           nu.arquivado_em
      from notif_visiveis v
      left join notificacoes_usuario nu
        on nu.notificacao_id = v.id and nu.usuario_id = v_uid
  ),
  filtradas as (
    select *
      from com_estado
     where (p_status = 'todas')
        or (p_status = 'nao_lidas'    and lido_em is null and arquivado_em is null)
        or (p_status = 'arquivadas'   and arquivado_em is not null)
        or (p_status = 'ativas'       and arquivado_em is null)
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', id,
             'severidade', severidade,
             'titulo', titulo,
             'mensagem', mensagem,
             'sensor_id', sensor_id,
             'origem', origem,
             'acao', acao,
             'metadados', metadados,
             'criado_em', criado_em,
             'lido', lido_em is not null,
             'arquivado', arquivado_em is not null,
             'lido_em', lido_em,
             'arquivado_em', arquivado_em
           ) order by criado_em desc
         ), '[]'::jsonb),
         count(*)
    into v_lista, v_total
    from (select * from filtradas order by criado_em desc limit p_limit offset p_offset) t;

  return jsonb_build_object('notificacoes', v_lista, 'total', v_total);
end;
$$;
grant execute on function listar_minhas_notificacoes(int, int, text, text) to anon, authenticated;


-- Conta não-lidas visíveis pro usuário atual (pro badge do sino)
create or replace function contar_nao_lidas()
returns jsonb language plpgsql security definer stable as $$
declare
  v_uid uuid := auth.uid();
  v_total int;
  v_critica int;
begin
  if v_uid is null then return jsonb_build_object('total',0,'critica',0); end if;
  select count(*), count(*) filter (where n.severidade = 'critica')
    into v_total, v_critica
    from notificacoes n
    left join notificacoes_usuario nu
      on nu.notificacao_id = n.id and nu.usuario_id = v_uid
   where (fn_eh_admin_atual() or n.criado_em >= fn_cadastro_usuario_atual())
     and (nu.lido_em is null and nu.arquivado_em is null);
  return jsonb_build_object('total', coalesce(v_total,0), 'critica', coalesce(v_critica,0));
end;
$$;
grant execute on function contar_nao_lidas() to anon, authenticated;


-- Marca como lida (cria registro em notificacoes_usuario se não existir)
create or replace function marcar_notificacao_lida(p_id uuid)
returns void language plpgsql security definer as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  insert into notificacoes_usuario (notificacao_id, usuario_id, lido_em)
  values (p_id, v_uid, now())
  on conflict (notificacao_id, usuario_id)
  do update set lido_em = coalesce(notificacoes_usuario.lido_em, excluded.lido_em);
end;
$$;
grant execute on function marcar_notificacao_lida(uuid) to anon, authenticated;


-- Arquiva (marca arquivado_em + lido_em se ainda não lido)
create or replace function arquivar_notificacao(p_id uuid)
returns void language plpgsql security definer as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  insert into notificacoes_usuario (notificacao_id, usuario_id, lido_em, arquivado_em)
  values (p_id, v_uid, now(), now())
  on conflict (notificacao_id, usuario_id)
  do update set arquivado_em = now(),
                lido_em = coalesce(notificacoes_usuario.lido_em, now());
end;
$$;
grant execute on function arquivar_notificacao(uuid) to anon, authenticated;


-- Desarquiva
create or replace function desarquivar_notificacao(p_id uuid)
returns void language plpgsql security definer as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  update notificacoes_usuario set arquivado_em = null
   where notificacao_id = p_id and usuario_id = v_uid;
end;
$$;
grant execute on function desarquivar_notificacao(uuid) to anon, authenticated;


-- Marca TODAS visíveis como lidas (não toca em arquivadas)
create or replace function marcar_todas_lidas()
returns int language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_n int := 0;
begin
  if v_uid is null then return 0; end if;
  insert into notificacoes_usuario (notificacao_id, usuario_id, lido_em)
  select n.id, v_uid, now()
    from notificacoes n
    left join notificacoes_usuario nu
      on nu.notificacao_id = n.id and nu.usuario_id = v_uid
   where (fn_eh_admin_atual() or n.criado_em >= fn_cadastro_usuario_atual())
     and (nu.lido_em is null and nu.arquivado_em is null)
  on conflict (notificacao_id, usuario_id)
  do update set lido_em = coalesce(notificacoes_usuario.lido_em, now());
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function marcar_todas_lidas() to anon, authenticated;
