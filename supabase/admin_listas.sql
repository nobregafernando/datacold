-- ============================================================
--  DataCold · 3 RPCs auxiliares pro dashboard admin
--  Substituem chamadas REST diretas que vazavam URL do projeto.
-- ============================================================

-- 1) Lista de perfis (personalidade + parametros) por sensor.
create or replace function listar_perfis_sensores()
returns jsonb language sql security definer stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',           id,
      'personalidade', personalidade,
      'parametros',    parametros
    )), '[]'::jsonb)
  from sensores;
$$;

-- 2) Incidentes ativos (resumo: só sensor_id + tipo) — usado no dashboard
--    pra colorir os cards com incidente em andamento.
--    "Ativo" = não removido + janela [inicio, fim) cobre o agora.
--    Bug anterior: faltava o filtro de fim, então incidentes EXPIRADOS
--    continuavam aparecendo como ativos (zumbis no dashboard).
create or replace function listar_incidentes_ativos_resumo()
returns jsonb language sql security definer stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'sensor_id', sensor_id,
      'tipo',      tipo
    )), '[]'::jsonb)
  from incidentes
  where removido_em is null
    and inicio <= now()
    and (fim is null or fim > now());
$$;

-- 3) Última leitura por sensor — atalho pra calcular conectividade.
--    Se a view `ultima_leitura_por_sensor` não existir, calcula UNION ALL
--    das 3 tabelas de leituras.
create or replace function listar_ultimas_leituras()
returns jsonb language plpgsql security definer stable as $$
declare
  v_existe_view boolean;
  v_resultado   jsonb;
begin
  select exists(
    select 1 from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where c.relname = 'ultima_leitura_por_sensor'
      and n.nspname = 'public'
  ) into v_existe_view;

  if v_existe_view then
    execute $sql$
      select coalesce(jsonb_agg(jsonb_build_object(
          'sensor_id', sensor_id,
          'momento',   momento
        )), '[]'::jsonb)
      from ultima_leitura_por_sensor
    $sql$ into v_resultado;
  else
    -- Fallback: pega o max(momento) por sensor unindo as 3 tabelas.
    with todos as (
      select sensor_id, max(momento) as momento from leituras_energia    group by sensor_id
      union all
      select sensor_id, max(momento)            from leituras_temperatura group by sensor_id
      union all
      select sensor_id, max(momento)            from leituras_porta      group by sensor_id
    ),
    consolidado as (
      select sensor_id, max(momento) as momento from todos group by sensor_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'sensor_id', sensor_id,
        'momento',   momento
      )), '[]'::jsonb)
    into v_resultado
    from consolidado;
  end if;

  return v_resultado;
end;
$$;

grant execute on function listar_perfis_sensores()           to anon, authenticated;
grant execute on function listar_incidentes_ativos_resumo()  to anon, authenticated;
grant execute on function listar_ultimas_leituras()          to anon, authenticated;
