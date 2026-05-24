-- =====================================================================
-- DataCold · Regras estendidas dos 4 agentes → notificações server-side
--
-- Hoje os agentes JS (AgenteEnergia/Temperatura/Porta) rodam só na tela
-- de cada sensor e detectam 30+ regras — mas nada disso vira notificação
-- no sino. Este arquivo PORTA pra PL/pgSQL as regras mais críticas pra
-- elas dispararem automaticamente em qualquer INSERT de leitura.
--
-- Reaproveita `fn_criar_notificacao` (dedup 1h por sensor+código) e
-- amplia os triggers já existentes (`fn_avaliar_energia`,
-- `fn_avaliar_temperatura`) + cria `fn_avaliar_porta` (que ainda não
-- existia).
--
-- Severidades usadas: 'critica' | 'alta'  (regras leves ficam no agente
-- JS pra não inundar o sino).
-- =====================================================================


-- ============================================================
-- ENERGIA (substitui fn_avaliar_energia com versão estendida)
-- ============================================================
create or replace function fn_avaliar_energia()
returns trigger language plpgsql as $$
declare
  v_sensor   sensores%rowtype;
  v_label    text;
  v_fp_a     numeric := coalesce(new.fator_potencia_a, 0);
  v_fp_b     numeric := coalesce(new.fator_potencia_b, 0);
  v_fp_c     numeric := coalesce(new.fator_potencia_c, 0);
  v_fp_comp  numeric := (abs(v_fp_a) + abs(v_fp_b) + abs(v_fp_c)) / 3.0;
  v_neg      boolean := (v_fp_a < 0 or v_fp_b < 0 or v_fp_c < 0);
  v_v_a      numeric := coalesce(new.tensao_fase_a, 0);
  v_v_b      numeric := coalesce(new.tensao_fase_b, 0);
  v_v_c      numeric := coalesce(new.tensao_fase_c, 0);
  v_i_a      numeric := coalesce(new.corrente_fase_a, 0);
  v_i_b      numeric := coalesce(new.corrente_fase_b, 0);
  v_i_c      numeric := coalesce(new.corrente_fase_c, 0);
  v_fases_zero text := '';
  v_i_media  numeric;
  v_v_media  numeric;
  v_cub_pct  numeric;
  v_vub_pct  numeric;
  v_i_max    numeric;
  v_v_max    numeric;
  v_tensao_nominal numeric;
  v_corrente_nominal numeric;
  v_media_recente numeric;
begin
  select * into v_sensor from sensores where id = new.sensor_id;
  if v_sensor.id is null then return new; end if;
  v_label := v_sensor.rotulo;

  v_tensao_nominal   := coalesce((v_sensor.parametros->>'tensao_nominal_v')::numeric, 220);
  v_corrente_nominal := coalesce((v_sensor.parametros->>'corrente_nominal_a')::numeric, 50);

  -- ============================================================
  -- 1) Fluxo reverso (mantido)
  -- ============================================================
  if v_neg then
    perform fn_criar_notificacao(
      'critica', 'Fluxo reverso detectado',
      v_label || ': FP negativo (TC invertido). Fiação do medidor pode estar invertida.',
      new.sensor_id, 'fluxo-reverso',
      jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
      jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
      jsonb_build_object('fonte','PRODIST 8 — ANEEL','valorMedido',v_fp_comp)
    );

  -- ============================================================
  -- 2) FP muito baixo (mantido)
  -- ============================================================
  elsif v_fp_comp < 0.85 and v_fp_comp > 0 then
    perform fn_criar_notificacao(
      'critica', 'FP muito baixo',
      v_label || ': FP composto = ' || round(v_fp_comp,2) || ' (limite ANEEL: 0,92).',
      new.sensor_id, 'fp-critico',
      jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
      jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
      jsonb_build_object('fonte','PRODIST 8 §3.2','valorMedido',v_fp_comp,'valorIdeal','≥ 0.92')
    );

  -- ============================================================
  -- 3) FP baixo (mantido)
  -- ============================================================
  elsif v_fp_comp < 0.92 and v_fp_comp > 0 then
    perform fn_criar_notificacao(
      'alta', 'FP abaixo do limite ANEEL',
      v_label || ': FP = ' || round(v_fp_comp,2) || '. Verificar banco de capacitores.',
      new.sensor_id, 'fp-baixo',
      jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
      jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
      jsonb_build_object('fonte','PRODIST 8 §3.2','valorMedido',v_fp_comp,'valorIdeal','≥ 0.92')
    );
  end if;

  -- ============================================================
  -- 4) Fase ausente (mantido)
  -- ============================================================
  if v_v_a < 10 then v_fases_zero := v_fases_zero || 'A '; end if;
  if v_v_b < 10 then v_fases_zero := v_fases_zero || 'B '; end if;
  if v_v_c < 10 then v_fases_zero := v_fases_zero || 'C '; end if;
  if length(v_fases_zero) > 0 then
    perform fn_criar_notificacao(
      'critica', 'Fase ausente',
      v_label || ': fase(s) ' || trim(v_fases_zero) || 'sem tensão. Risco de queima.',
      new.sensor_id, 'fase-ausente',
      jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
      jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
      jsonb_build_object('fonte','Convenção elétrica','fasesAusentes',trim(v_fases_zero))
    );
  end if;

  -- ============================================================
  -- 5) Desequilíbrio de corrente (CUB) — NOVO
  --    %CUB = (Imax − Imedia) / Imedia × 100
  --    Limite NEMA MG-1: > 10% atencao, > 15% crítico
  -- ============================================================
  v_i_media := (v_i_a + v_i_b + v_i_c) / 3.0;
  if v_i_media > 1 then
    v_i_max   := greatest(abs(v_i_a - v_i_media), abs(v_i_b - v_i_media), abs(v_i_c - v_i_media));
    v_cub_pct := (v_i_max / v_i_media) * 100.0;
    if v_cub_pct >= 15 then
      perform fn_criar_notificacao(
        'critica', 'Desequilíbrio de corrente crítico',
        v_label || ': CUB = ' || round(v_cub_pct,1) || '% (limite NEMA MG-1: 10%). Motor sofrendo.',
        new.sensor_id, 'desequilibrio-corrente',
        jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
        jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
        jsonb_build_object('fonte','NEMA MG-1','valorMedido',round(v_cub_pct,1),'valorIdeal','≤ 10%')
      );
    elsif v_cub_pct >= 10 then
      perform fn_criar_notificacao(
        'alta', 'Desequilíbrio de corrente',
        v_label || ': CUB = ' || round(v_cub_pct,1) || '%. Acima do limite NEMA (10%).',
        new.sensor_id, 'desequilibrio-corrente',
        jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
        jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
        jsonb_build_object('fonte','NEMA MG-1','valorMedido',round(v_cub_pct,1),'valorIdeal','≤ 10%')
      );
    end if;
  end if;

  -- ============================================================
  -- 6) Desequilíbrio de tensão (VUB) — NOVO
  --    %VUB = (Vmax − Vmedia) / Vmedia × 100
  --    PRODIST/NEMA: > 1% atencao, > 2% crítico
  -- ============================================================
  if v_v_a >= 10 and v_v_b >= 10 and v_v_c >= 10 then
    v_v_media := (v_v_a + v_v_b + v_v_c) / 3.0;
    v_v_max   := greatest(abs(v_v_a - v_v_media), abs(v_v_b - v_v_media), abs(v_v_c - v_v_media));
    v_vub_pct := (v_v_max / v_v_media) * 100.0;
    if v_vub_pct > 2 then
      perform fn_criar_notificacao(
        'critica', 'Desequilíbrio de tensão crítico',
        v_label || ': VUB = ' || round(v_vub_pct,2) || '% (limite NEMA: 2%).',
        new.sensor_id, 'desequilibrio-tensao',
        jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
        jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
        jsonb_build_object('fonte','PRODIST/NEMA','valorMedido',round(v_vub_pct,2),'valorIdeal','≤ 2%')
      );
    elsif v_vub_pct > 1 then
      perform fn_criar_notificacao(
        'alta', 'Desequilíbrio de tensão',
        v_label || ': VUB = ' || round(v_vub_pct,2) || '% (ideal: ≤ 1%).',
        new.sensor_id, 'desequilibrio-tensao',
        jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
        jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
        jsonb_build_object('fonte','PRODIST/NEMA','valorMedido',round(v_vub_pct,2),'valorIdeal','≤ 1%')
      );
    end if;
  end if;

  -- ============================================================
  -- 7) Tensão fora da faixa nominal ±5% — NOVO
  -- ============================================================
  if v_v_a >= 10 then
    if v_v_a < v_tensao_nominal * 0.95 or v_v_a > v_tensao_nominal * 1.05 then
      perform fn_criar_notificacao(
        'alta', 'Tensão fora da faixa',
        v_label || ': Fase A = ' || round(v_v_a,1) || 'V (esperado: ' || v_tensao_nominal || 'V ±5%).',
        new.sensor_id, 'tensao-fora-faixa-a',
        jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
        jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
        jsonb_build_object('fonte','PRODIST 8','fase','A','valorMedido',round(v_v_a,1),'valorIdeal',v_tensao_nominal||' ±5%')
      );
    end if;
  end if;

  -- ============================================================
  -- 8) Pico de corrente — NOVO
  --    Corrente atual > 5× média dos últimos 60 pontos (mesma fase A)
  --    5× é mais leve que 7× pra pegar partidas anormais sem falso-positivo
  --    constante em partidas normais.
  -- ============================================================
  if v_i_a > 5 then
    select avg(corrente_fase_a) into v_media_recente
      from (
        select corrente_fase_a from leituras_energia
         where sensor_id = new.sensor_id
           and momento < new.momento
         order by momento desc
         limit 60
      ) ult
     where corrente_fase_a > 0.1;

    if v_media_recente is not null and v_media_recente > 1 and v_i_a > v_media_recente * 5 then
      perform fn_criar_notificacao(
        'alta', 'Pico de corrente',
        v_label || ': Fase A = ' || round(v_i_a,1) || 'A (média recente: ' || round(v_media_recente,1) || 'A). Partida anormal ou contator com defeito.',
        new.sensor_id, 'pico-corrente',
        jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
        jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
        jsonb_build_object('valorMedido',round(v_i_a,1),'mediaRecente',round(v_media_recente,1),'razao',round(v_i_a / v_media_recente,1))
      );
    end if;
  end if;

  return new;
end;
$$;


-- ============================================================
-- TEMPERATURA (estendida com 2 regras novas)
-- ============================================================
create or replace function fn_avaliar_temperatura()
returns trigger language plpgsql as $$
declare
  v_sensor   sensores%rowtype;
  v_label    text;
  v_faixa    jsonb;
  v_min      numeric;
  v_max      numeric;
  v_sigma    numeric;
  v_n        int;
begin
  select * into v_sensor from sensores where id = new.sensor_id;
  if v_sensor.id is null then return new; end if;
  v_label := v_sensor.rotulo;

  -- 1) Leitura impossível (mantido)
  if new.temperatura > 100 or new.temperatura < -100 then
    perform fn_criar_notificacao(
      'critica', 'Leitura impossível',
      v_label || ': ' || new.temperatura || '°C — sensor com defeito.',
      new.sensor_id, 'leitura-impossivel',
      jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
      jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
      jsonb_build_object('valorMedido',new.temperatura,'valorIdeal','-100 a +100 °C')
    );
    return new;
  end if;

  -- 2 e 3) Faixa controlada (mantido)
  v_faixa := case v_sensor.grupo_id
    when 'camara_congelados' then '{"min":-28,"max":-18,"label":"câmara de congelados"}'::jsonb
    when 'camara_estoque'    then '{"min":-4, "max":4, "label":"câmara fria de estoque"}'::jsonb
    when 'graxaria'          then '{"min":-10,"max":4, "label":"câmara da graxaria"}'::jsonb
    else null
  end;
  if v_faixa is not null then
    v_min := (v_faixa->>'min')::numeric;
    v_max := (v_faixa->>'max')::numeric;
    if new.temperatura > v_max then
      perform fn_criar_notificacao(
        'critica', 'Temperatura acima da faixa ideal',
        v_label || ': ' || round(new.temperatura, 1) || '°C (faixa: ' || v_min || ' a ' || v_max || '°C). Risco ao produto.',
        new.sensor_id, 'temp-acima-faixa',
        jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
        jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
        jsonb_build_object('fonte','ANVISA RDC 275','valorMedido',new.temperatura,'valorIdeal',v_min||' a '||v_max||' °C')
      );
    elsif new.temperatura < v_min then
      perform fn_criar_notificacao(
        'alta', 'Temperatura abaixo da faixa ideal',
        v_label || ': ' || round(new.temperatura, 1) || '°C (faixa: ' || v_min || ' a ' || v_max || '°C).',
        new.sensor_id, 'temp-abaixo-faixa',
        jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
        jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
        jsonb_build_object('fonte','ANVISA RDC 275','valorMedido',new.temperatura,'valorIdeal',v_min||' a '||v_max||' °C')
      );
    end if;
  end if;

  -- ============================================================
  -- 4) Sensor travado — NOVO
  --    σ das últimas 60 leituras < 0.05°C = leituras virtualmente
  --    idênticas → sensor "congelou", não mede de verdade.
  -- ============================================================
  select stddev_samp(temperatura), count(*) into v_sigma, v_n
    from (
      select temperatura from leituras_temperatura
       where sensor_id = new.sensor_id
         and momento <= new.momento
       order by momento desc
       limit 60
    ) ult;
  if v_n >= 30 and v_sigma is not null and v_sigma < 0.05 then
    perform fn_criar_notificacao(
      'critica', 'Sensor travado',
      v_label || ': leituras virtualmente idênticas (σ = ' || round(v_sigma,3) || '°C nas últimas ' || v_n || ' amostras). Verifique o sensor.',
      new.sensor_id, 'sensor-travado',
      jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
      jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
      jsonb_build_object('sigma',round(v_sigma,3),'amostras',v_n,'limiteSigma',0.05)
    );
    return new;   -- se travou, oscilação não faz sentido
  end if;

  -- ============================================================
  -- 5) Oscilação anormal — NOVO
  --    σ das últimas 30 leituras > 2°C dentro de câmara controlada
  --    → compressor com short-cycling ou termostato com defeito.
  --    Só dispara em câmara controlada (faixa definida).
  -- ============================================================
  if v_faixa is not null then
    select stddev_samp(temperatura), count(*) into v_sigma, v_n
      from (
        select temperatura from leituras_temperatura
         where sensor_id = new.sensor_id
           and momento <= new.momento
         order by momento desc
         limit 30
      ) ult;
    if v_n >= 20 and v_sigma is not null and v_sigma > 2 then
      perform fn_criar_notificacao(
        'alta', 'Oscilação anormal de temperatura',
        v_label || ': σ = ' || round(v_sigma,2) || '°C nas últimas ' || v_n || ' amostras. Possível short-cycling do compressor.',
        new.sensor_id, 'oscilacao',
        jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
        jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
        jsonb_build_object('sigma',round(v_sigma,2),'amostras',v_n,'limiteSigma',2)
      );
    end if;
  end if;

  return new;
end;
$$;


-- ============================================================
-- PORTA — novo trigger inteiro (não existia)
-- ============================================================
create or replace function fn_avaliar_porta()
returns trigger language plpgsql as $$
declare
  v_sensor   sensores%rowtype;
  v_label    text;
  v_thr      numeric;   -- threshold pra considerar "aberta"
  v_aberta   boolean;
  v_aberta_desde_s int;
  v_fracao   numeric;
  v_total    int;
  v_aberturas int;
  v_max_aberto bigint;
begin
  select * into v_sensor from sensores where id = new.sensor_id;
  if v_sensor.id is null then return new; end if;
  v_label := v_sensor.rotulo;

  -- Threshold: se sinal_analogico, metade do valor_aberto_max; senão 0.5
  v_thr := case
    when (v_sensor.parametros->>'sinal_analogico')::boolean is true
      then coalesce((v_sensor.parametros->>'valor_aberto_max')::numeric, 100) * 0.5
    else 0.5
  end;
  v_aberta := coalesce(new.abertura_porta, 0) > v_thr;

  -- ============================================================
  -- 1) Porta esquecida — aberta há > 5 min sem fechar
  -- ============================================================
  if v_aberta then
    -- Conta segundos desde a última leitura COM porta abaixo do threshold
    select extract(epoch from (new.momento - max(momento)))::int into v_aberta_desde_s
      from leituras_porta
     where sensor_id = new.sensor_id
       and momento < new.momento
       and abertura_porta <= v_thr;

    if v_aberta_desde_s is not null and v_aberta_desde_s > 5 * 60 then
      perform fn_criar_notificacao(
        case when v_aberta_desde_s > 15 * 60 then 'critica' else 'alta' end,
        'Porta esquecida aberta',
        v_label || ' aberta há ' || round(v_aberta_desde_s / 60.0)::int || ' min. Perdendo frio.',
        new.sensor_id, 'porta-esquecida',
        jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
        jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
        jsonb_build_object('abertaDesde_s',v_aberta_desde_s,'limite_s',5*60)
      );
    end if;
  end if;

  -- ============================================================
  -- 2) Fração aberta nas últimas 2h — alta se > 25%
  -- ============================================================
  select
    count(*) filter (where abertura_porta > v_thr),
    count(*)
    into v_aberturas, v_total
    from leituras_porta
   where sensor_id = new.sensor_id
     and momento >= new.momento - interval '2 hours'
     and momento <= new.momento;
  if v_total >= 30 then
    v_fracao := v_aberturas::numeric / v_total::numeric;
    if v_fracao >= 0.25 then
      perform fn_criar_notificacao(
        case when v_fracao >= 0.50 then 'critica' else 'alta' end,
        'Porta aberta ' || round(v_fracao * 100)::int || '% do tempo',
        v_label || ': ' || round(v_fracao * 100)::int || '% das últimas 2h com porta aberta. Operação ou vedação ruim.',
        new.sensor_id, 'fracao-aberta',
        jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
        jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
        jsonb_build_object('fracao',round(v_fracao,2),'janelaH',2,'amostras',v_total)
      );
    end if;
  end if;

  -- ============================================================
  -- 3) Rajada de aberturas — > 5 transições fechada→aberta em 5 min
  -- ============================================================
  with leituras as (
    select abertura_porta > v_thr as aberta,
           lag(abertura_porta > v_thr) over (order by momento) as anterior
      from leituras_porta
     where sensor_id = new.sensor_id
       and momento >= new.momento - interval '5 minutes'
       and momento <= new.momento
  )
  select count(*) into v_aberturas
    from leituras
   where aberta = true and (anterior = false or anterior is null);

  if v_aberturas > 5 then
    perform fn_criar_notificacao(
      'alta',
      'Rajada de aberturas',
      v_label || ': ' || v_aberturas || ' aberturas nos últimos 5 min. Possível operação fora do padrão.',
      new.sensor_id, 'rajada-aberturas',
      jsonb_build_object('tipo','sensor','id',new.sensor_id,'label',v_label),
      jsonb_build_object('url','/paginas/admin/sensores/'||new.sensor_id||'/','texto','Abrir sensor'),
      jsonb_build_object('aberturas',v_aberturas,'janelaMin',5)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_avaliar_porta on leituras_porta;
create trigger trg_avaliar_porta
  after insert on leituras_porta
  for each row execute function fn_avaliar_porta();
