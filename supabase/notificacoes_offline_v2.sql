-- =====================================================================
-- DataCold · Detecção de offline v2 — limites reduzidos + trigger imediato
--
-- Bug v1: limites (5/10/15min) eram MAIORES que a duração dos incidentes
-- típicos da sala-controle (3-5min). Sensor reconectava antes do limite,
-- notificação nunca era gerada.
--
-- Solução:
-- 1. Reduzir os limites pra 2/4/8 min (energia/temperatura/porta).
-- 2. Trigger ON INSERT em `incidentes` cria notificação IMEDIATA pra
--    gap/offline, sem esperar o cron de 1min.
-- =====================================================================

create or replace function fn_detectar_offlines()
returns int language plpgsql security definer
set search_path = public as $$
declare
  v_count int := 0;
  r record;
  v_min_silencio_s int;
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
    -- Limites menores: precisa detectar incidentes curtos da sala-controle
    v_min_silencio_s := case r.tipo
      when 'energia'     then 2 * 60   -- antes 5
      when 'temperatura' then 4 * 60   -- antes 10
      when 'porta'       then 8 * 60   -- antes 15
      else 4 * 60
    end;

    if r.ultima is null then continue; end if;
    if r.silencio_s < v_min_silencio_s then continue; end if;

    v_min_silencio_min := round(r.silencio_s / 60.0)::int;
    perform fn_criar_notificacao(
      'critica',
      'Sensor offline',
      r.rotulo || ' está sem enviar leitura há ' || v_min_silencio_min || ' min. ' ||
      'Verifique alimentação, rede local (logger/AP/switch) e conexão.',
      r.id, 'sensor-offline',
      jsonb_build_object('tipo','sensor','id',r.id,'label',r.rotulo),
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


-- =====================================================================
-- Trigger ON INSERT em `incidentes` — gera notificação imediata pra
-- gap/offline (sem esperar o cron de 1min).
-- =====================================================================
create or replace function fn_notificar_incidente_rede()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_label text;
  v_min   numeric;
begin
  -- Só nos interessa gap e offline (perda de rede do sensor)
  if new.tipo not in ('gap', 'offline') then
    return new;
  end if;
  select rotulo into v_label from sensores where id = new.sensor_id;
  if v_label is null then return new; end if;

  v_min := round(extract(epoch from (coalesce(new.fim, now() + interval '5 minutes') - new.inicio)) / 60.0, 1);

  perform fn_criar_notificacao(
    'critica',
    case when new.tipo = 'offline'
         then 'Equipamento offline'
         else 'Sensor desconectado da rede'
    end,
    v_label || ' · ' ||
    case when new.tipo = 'offline' then 'equipamento parou'
         else 'sem conectividade'
    end || ' por ' || v_min || ' min. Origem: ' || coalesce(new.descricao, 'incidente manual') || '.',
    new.sensor_id,
    case when new.tipo = 'offline' then 'incidente-offline' else 'incidente-gap' end,
    jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
    jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
    jsonb_build_object(
      'fonte','Sala de controle',
      'incidente_id', new.id,
      'duracao_min',  v_min,
      'inicio',       new.inicio,
      'fim',          new.fim
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_notificar_incidente_rede on incidentes;
create trigger trg_notificar_incidente_rede
  after insert on incidentes
  for each row execute function fn_notificar_incidente_rede();
