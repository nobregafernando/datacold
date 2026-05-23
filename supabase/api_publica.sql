-- ============================================================
--  DataCold · RPCs públicas (PostgREST)
-- ============================================================
--  Endpoints REST automáticos:
--    POST /rest/v1/rpc/verificar_saude
--    POST /rest/v1/rpc/listar_catalogo
--    POST /rest/v1/rpc/buscar_dados   {p_sensor, p_start, p_stop, p_limit}
--    POST /rest/v1/rpc/criar_incidente / cancelar_incidente
--
--  Devolvem JSON no mesmo formato que o front já espera, pra
--  poder substituir a API BEM real sem mudar a estrutura do cliente.
-- ============================================================

-- ===== Helper: parser de tempo relativo (-30m, -1h, -7d, 'now', ISO) =====
create or replace function sim_parse_tempo(p_tempo text, p_ref timestamptz default now())
returns timestamptz language plpgsql immutable as $$
declare
  v_qtd      numeric;
  v_unidade  text;
  v_match    text[];
begin
  if p_tempo is null or p_tempo = '' or p_tempo = 'now' then
    return p_ref;
  end if;
  -- relativo: -30m, -6h, -167h, -7d, -10s
  v_match := regexp_match(p_tempo, '^-(\d+(?:\.\d+)?)(s|m|h|d)$');
  if v_match is not null then
    v_qtd     := v_match[1]::numeric;
    v_unidade := v_match[2];
    return p_ref - case v_unidade
      when 's' then make_interval(secs => v_qtd)
      when 'm' then make_interval(secs => v_qtd * 60)
      when 'h' then make_interval(secs => v_qtd * 3600)
      when 'd' then make_interval(secs => v_qtd * 86400)
    end;
  end if;
  -- ISO 8601 explícito
  return p_tempo::timestamptz;
end;
$$;


-- ===== /rest/v1/rpc/verificar_saude =====
create or replace function verificar_saude()
returns jsonb language sql security definer stable as $$
  select jsonb_build_object(
    'status', 'ok',
    'demo_mode', true,
    'agora', now(),
    'total_pontos', (
      (select count(*) from leituras_energia) +
      (select count(*) from leituras_temperatura) +
      (select count(*) from leituras_porta)
    ),
    'sensores', (select count(*) from sensores),
    'fonte', 'supabase'
  );
$$;


-- ===== /rest/v1/rpc/listar_catalogo =====
-- Devolve { sensors: [...], groups: [...] } no mesmo formato que a BEM real.
create or replace function listar_catalogo()
returns jsonb language sql security definer stable as $$
  select jsonb_build_object(
    'sensors', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',     id,
          'label',  rotulo,
          'type',   tipo,
          'group',  grupo_id,
          'status', status
        ) order by id
      ), '[]'::jsonb)
      from sensores
    ),
    'groups', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',          g.id,
          'label',       g.rotulo,
          'description', g.descricao,
          'sensors',     (
            select coalesce(jsonb_agg(s.id order by s.id), '[]'::jsonb)
              from sensores s where s.grupo_id = g.id
          )
        ) order by g.id
      ), '[]'::jsonb)
      from grupos g
    )
  );
$$;


-- ===== /rest/v1/rpc/buscar_dados =====
-- Devolve { sensor, type, count, fields, window, points: [...] } no mesmo
-- formato que a API BEM real e o simulador Python local.
create or replace function buscar_dados(
  p_sensor text,
  p_start  text default '-1h',
  p_stop   text default 'now',
  p_limit  int  default 1000
) returns jsonb language plpgsql security definer stable as $$
declare
  v_tipo    text;
  v_inicio  timestamptz;
  v_fim     timestamptz;
  v_pontos  jsonb;
  v_count   int;
  v_fields  jsonb;
begin
  select tipo into v_tipo from sensores where id = p_sensor;
  if v_tipo is null then
    return jsonb_build_object(
      'error',  format('sensor %s nao existe', p_sensor),
      'sensor', p_sensor
    );
  end if;

  v_inicio := sim_parse_tempo(p_start);
  v_fim    := sim_parse_tempo(p_stop);

  if v_tipo = 'energia' then
    v_fields := '["corrente_fase_a","corrente_fase_b","corrente_fase_c","tensao_fase_a","tensao_fase_b","tensao_fase_c","fator_potencia_a","fator_potencia_b","fator_potencia_c"]'::jsonb;
    with janela as (
      select * from leituras_energia
       where sensor_id = p_sensor
         and momento between v_inicio and v_fim
       order by momento desc
       limit p_limit
    )
    select coalesce(jsonb_agg(
        jsonb_build_object('time', momento) ||
        (to_jsonb(j) - 'id' - 'sensor_id' - 'momento' - 'criado_em')
        order by momento
      ), '[]'::jsonb), count(*)
      into v_pontos, v_count
      from janela j;

  elsif v_tipo = 'temperatura' then
    v_fields := '["temperatura"]'::jsonb;
    with janela as (
      select * from leituras_temperatura
       where sensor_id = p_sensor
         and momento between v_inicio and v_fim
       order by momento desc
       limit p_limit
    )
    select coalesce(jsonb_agg(
        jsonb_build_object('time', momento) ||
        (to_jsonb(j) - 'id' - 'sensor_id' - 'momento' - 'criado_em')
        order by momento
      ), '[]'::jsonb), count(*)
      into v_pontos, v_count
      from janela j;

  elsif v_tipo = 'porta' then
    v_fields := '["abertura_porta"]'::jsonb;
    with janela as (
      select * from leituras_porta
       where sensor_id = p_sensor
         and momento between v_inicio and v_fim
       order by momento desc
       limit p_limit
    )
    select coalesce(jsonb_agg(
        jsonb_build_object('time', momento) ||
        (to_jsonb(j) - 'id' - 'sensor_id' - 'momento' - 'criado_em')
        order by momento
      ), '[]'::jsonb), count(*)
      into v_pontos, v_count
      from janela j;
  end if;

  return jsonb_build_object(
    'sensor', p_sensor,
    'type',   v_tipo,
    'count',  v_count,
    'fields', v_fields,
    'window', jsonb_build_object('start', p_start, 'stop', p_stop),
    'points', v_pontos
  );
end;
$$;


-- ===== /rest/v1/rpc/criar_incidente =====
create or replace function criar_incidente(
  p_sensor      text,
  p_tipo        text,
  p_duracao_s   int     default null,
  p_magnitude   numeric default 0,
  p_valor       numeric default 0,
  p_descricao   text    default ''
) returns jsonb language plpgsql security definer as $$
declare
  v_id   uuid;
  v_fim  timestamptz;
begin
  if not exists (select 1 from sensores where id = p_sensor) then
    return jsonb_build_object('error', format('sensor %s nao existe', p_sensor));
  end if;
  if p_duracao_s is not null and p_duracao_s > 0 then
    v_fim := now() + make_interval(secs => p_duracao_s);
  end if;
  insert into incidentes (sensor_id, tipo, magnitude, valor, descricao, fim, criado_por)
  values (p_sensor, p_tipo, p_magnitude, p_valor, p_descricao, v_fim, 'rpc')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'fim', v_fim);
end;
$$;


-- ===== /rest/v1/rpc/cancelar_incidente =====
create or replace function cancelar_incidente(p_id uuid)
returns jsonb language plpgsql security definer as $$
declare v_n int;
begin
  update incidentes set removido_em = now()
    where id = p_id and removido_em is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('removidos', v_n);
end;
$$;


-- =====================================================================
-- Atualizar parâmetros de um sensor (merge no jsonb existente)
-- =====================================================================
create or replace function atualizar_parametros_sensor(
  p_sensor      text,
  p_parametros  jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_atualizados int;
  v_atual       jsonb;
begin
  update sensores
     set parametros     = coalesce(parametros, '{}'::jsonb) || coalesce(p_parametros, '{}'::jsonb),
         atualizado_em  = now(),
         atualizado_por = 'admin'
   where id = p_sensor
   returning parametros into v_atual;
  get diagnostics v_atualizados = row_count;

  if v_atualizados = 0 then
    return jsonb_build_object('error', 'sensor não encontrado: ' || p_sensor);
  end if;
  return jsonb_build_object(
    'ok',         true,
    'sensor',     p_sensor,
    'parametros', v_atual
  );
end;
$$;

-- =====================================================================
-- Ler parâmetros de um sensor (devolve só o jsonb)
-- =====================================================================
create or replace function obter_parametros_sensor(p_sensor text)
returns jsonb
  language sql
  security definer
  set search_path = public
as $$
  select coalesce(parametros, '{}'::jsonb)
    from sensores
   where id = p_sensor;
$$;

-- =====================================================================
-- Listar incidentes ATIVOS de um sensor (ou de todos)
-- Ativo = inicio<=now() AND removido_em IS NULL AND (fim IS NULL OR fim>now())
-- Usado pela página individual do sensor pra mostrar "simulação em curso"
-- e forçar banner offline imediato em gap/offline.
-- =====================================================================
create or replace function incidentes_ativos(p_sensor text default null)
returns table (
  id           uuid,
  sensor_id    text,
  tipo         text,
  magnitude    numeric,
  valor        numeric,
  inicio       timestamptz,
  fim          timestamptz,
  segundos_restantes int,
  descricao    text
)
  language sql
  security definer
  set search_path = public
as $$
  select
    i.id,
    i.sensor_id,
    i.tipo,
    i.magnitude,
    i.valor,
    i.inicio,
    i.fim,
    case when i.fim is null then null
         else greatest(0, extract(epoch from (i.fim - now()))::int)
    end as segundos_restantes,
    i.descricao
    from incidentes i
   where i.removido_em is null
     and i.inicio <= now()
     and (i.fim is null or i.fim > now())
     and (p_sensor is null or i.sensor_id = p_sensor)
   order by i.inicio desc;
$$;

-- ===== GRANTS para anon e authenticated =====
grant execute on function sim_parse_tempo(text, timestamptz) to anon, authenticated;
grant execute on function verificar_saude() to anon, authenticated;
grant execute on function listar_catalogo() to anon, authenticated;
grant execute on function buscar_dados(text, text, text, int) to anon, authenticated;
grant execute on function criar_incidente(text, text, int, numeric, numeric, text) to anon, authenticated;
grant execute on function cancelar_incidente(uuid) to anon, authenticated;
grant execute on function atualizar_parametros_sensor(text, jsonb) to anon, authenticated;
grant execute on function obter_parametros_sensor(text) to anon, authenticated;
grant execute on function incidentes_ativos(text) to anon, authenticated;
