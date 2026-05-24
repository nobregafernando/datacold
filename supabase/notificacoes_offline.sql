-- =====================================================================
-- DataCold · Detecção de offline / falha de rede
--
-- Cobre o cenário "sensor parou de enviar leitura" — que nenhum trigger
-- ON INSERT consegue capturar (porque o trigger só dispara em insert).
--
-- Roda 1× por minuto via pg_cron e cria notificações server-side quando
-- a última leitura está acima do limite tolerado pra cada tipo:
--   energia       → 5 min
--   temperatura   → 10 min
--   porta         → 15 min
--
-- Dedup automático: fn_criar_notificacao já não cria duplicata do mesmo
-- (sensor_id, codigo) na última hora.
-- =====================================================================

create or replace function fn_detectar_offlines()
returns int language plpgsql security definer
set search_path = public as $$
declare
  v_count int := 0;
  r record;
  v_min_silencio_s int;
  v_label text;
  v_min_silencio_min int;
begin
  for r in
    with ultima as (
      select sensor_id, max(momento) as ultima from leituras_energia      group by sensor_id
      union all
      select sensor_id, max(momento)            from leituras_temperatura  group by sensor_id
      union all
      select sensor_id, max(momento)            from leituras_porta        group by sensor_id
    ),
    consolidada as (
      select s.id, s.tipo, s.rotulo, max(u.ultima) as ultima
        from sensores s
        left join ultima u on u.sensor_id = s.id
       where coalesce(s.status, 'ativo') = 'ativo'
       group by s.id, s.tipo, s.rotulo
    )
    select id, tipo, rotulo, ultima,
           extract(epoch from (now() - ultima))::int as silencio_s
      from consolidada
  loop
    -- Tolerância por tipo
    v_min_silencio_s := case r.tipo
      when 'energia'     then 5  * 60
      when 'temperatura' then 10 * 60
      when 'porta'       then 15 * 60
      else 10 * 60
    end;

    if r.ultima is null then
      -- Sensor cadastrado mas sem nenhuma leitura ainda — silencioso, ignora
      continue;
    end if;
    if r.silencio_s < v_min_silencio_s then
      continue;
    end if;

    v_min_silencio_min := round(r.silencio_s / 60.0)::int;
    v_label := r.rotulo;

    perform fn_criar_notificacao(
      'critica',
      'Sensor offline',
      v_label || ' está sem enviar leitura há ' || v_min_silencio_min || ' min. ' ||
      'Verifique alimentação, rede local (logger/AP/switch) e conexão.',
      r.id,
      'sensor-offline',
      jsonb_build_object('tipo','sensor','id',r.id,'label',v_label),
      jsonb_build_object('url','/paginas/admin/sensores/'||r.id||'/','texto','Abrir sensor'),
      jsonb_build_object(
        'fonte','Detecção automática (fn_detectar_offlines)',
        'silencio_min', v_min_silencio_min,
        'limite_min',   v_min_silencio_s/60,
        'ultima_leitura', r.ultima
      )
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function fn_detectar_offlines() is
  'Cria notificações pra sensores ativos que pararam de enviar leitura. Roda via pg_cron a cada minuto.';

grant execute on function fn_detectar_offlines() to authenticated;

-- =====================================================================
-- Agenda pg_cron: 1× por minuto
-- =====================================================================
do $$
begin
  -- Remove agendamento anterior se existir (idempotente em reaplicação)
  if exists (select 1 from cron.job where jobname = 'datacold_detectar_offlines') then
    perform cron.unschedule('datacold_detectar_offlines');
  end if;
  perform cron.schedule(
    'datacold_detectar_offlines',
    '* * * * *',                        -- a cada minuto
    $cmd$select fn_detectar_offlines()$cmd$
  );
end $$;
