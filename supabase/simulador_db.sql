-- ============================================================
--  DataCold · Simulador rodando dentro do banco
-- ============================================================
--  Cria funções PL/pgSQL que geram leituras sintéticas a partir
--  dos parâmetros guardados em sensores.parametros (jsonb), e
--  agenda execução automática via pg_cron.
--
--  Resultado: a sua máquina pode ficar desligada — o Supabase
--  continua gerando pontos sozinho.
-- ============================================================

-- ===================== EXTENSÕES =====================
create extension if not exists pg_cron;        -- agendador interno


-- ===================== HELPERS =====================

-- Retorna o ciclo dia/noite (0..1, pico às 18h UTC ≈ 15h BRT)
create or replace function sim_fator_dia_noite(p_ts timestamptz)
returns numeric language sql immutable as $$
  select 0.5 + 0.5 * cos(
    (extract(hour from p_ts) + extract(minute from p_ts)/60.0 - 18) * pi() / 12
  );
$$;


-- Dente-de-serra triangular (-1..+1) com período em segundos
create or replace function sim_sawtooth(p_ts timestamptz, p_periodo_s int)
returns numeric language sql immutable as $$
  select case
    when (extract(epoch from p_ts)::numeric % p_periodo_s) / p_periodo_s < 0.5
      then 4 * (extract(epoch from p_ts)::numeric % p_periodo_s) / p_periodo_s - 1
    else 3 - 4 * (extract(epoch from p_ts)::numeric % p_periodo_s) / p_periodo_s
  end;
$$;


-- Aplica os incidentes ativos do sensor sobre um valor numérico.
-- Retorna NULL se algum incidente do tipo gap/offline está ativo
-- (sinaliza pra função geradora não inserir o ponto).
create or replace function sim_aplicar_incidentes(
  p_sensor_id text,
  p_valor     numeric
) returns numeric language plpgsql as $$
declare
  r record;
  v_resultado numeric := p_valor;
begin
  for r in
    select tipo, magnitude, valor
      from incidentes
     where sensor_id = p_sensor_id
       and removido_em is null
       and (fim is null or fim > now())
       and inicio <= now()
  loop
    if r.tipo in ('gap','offline') then
      return null;
    elsif r.tipo = 'valor_impossivel' then
      v_resultado := r.valor;
    elsif r.tipo = 'spike' then
      v_resultado := v_resultado * r.magnitude;
    elsif r.tipo = 'drift' then
      v_resultado := v_resultado + r.magnitude;
    end if;
  end loop;
  return v_resultado;
end;
$$;


-- ===================== GERADOR: ENERGIA =====================
create or replace function sim_gerar_energia(p_sensor_id text, p_ts timestamptz default now())
returns void language plpgsql as $$
declare
  p             jsonb;
  v_grupo       text;
  v_tensao      numeric;
  v_desv_tensao numeric;
  v_corrente   numeric;
  v_desv_corr  numeric;
  v_fp_base    numeric;
  v_desv_fp    numeric;
  v_cub        numeric;
  v_ausente    text;
  v_op         numeric;
  v_i_a numeric; v_i_b numeric; v_i_c numeric;
  v_v_a numeric; v_v_b numeric; v_v_c numeric;
  v_fp_a numeric; v_fp_b numeric; v_fp_c numeric;
begin
  select parametros, grupo_id into p, v_grupo from sensores where id = p_sensor_id;
  if p is null then return; end if;

  v_tensao      := coalesce((p->>'tensao_nominal_v')::numeric, 220);
  v_desv_tensao := coalesce((p->>'tensao_desvio_v')::numeric, 2);
  v_corrente    := coalesce((p->>'corrente_nominal_a')::numeric, 50);
  v_desv_corr   := coalesce((p->>'corrente_desvio_a')::numeric, 5);
  v_fp_base     := coalesce((p->>'fp_base')::numeric, 0.9);
  v_desv_fp     := coalesce((p->>'fp_desvio')::numeric, 0.05);
  v_cub         := coalesce((p->>'cub_alvo_pct')::numeric, 2) / 100.0;
  v_ausente     := coalesce(p->>'fase_ausente', '');

  -- Modulação por hora do dia: fábrica 24/7, então variação suave.
  -- Compressor varia 0.85 a 1.00 conforme calor; extrusora 0.92 a 1.00 (operação contínua).
  if v_grupo like 'camara_%' or v_grupo = 'graxaria' then
    v_op := 0.85 + 0.15 * sim_fator_dia_noite(p_ts);
  else
    v_op := 0.92 + 0.08 * sin((extract(hour from p_ts) + extract(minute from p_ts)/60.0 - 12) * pi() / 12);
  end if;

  -- Correntes (com CUB distribuído entre as fases)
  v_i_a := greatest(0, v_corrente * v_op * (1 - v_cub) + v_desv_corr * (random() - 0.5) * 2);
  v_i_b := greatest(0, v_corrente * v_op             + v_desv_corr * (random() - 0.5) * 2);
  v_i_c := greatest(0, v_corrente * v_op * (1 + v_cub) + v_desv_corr * (random() - 0.5) * 2);

  -- Tensões
  v_v_a := v_tensao + v_desv_tensao * (random() - 0.5) * 2;
  v_v_b := v_tensao + v_desv_tensao * (random() - 0.5) * 2;
  v_v_c := v_tensao + v_desv_tensao * (random() - 0.5) * 2;

  -- Fator de potência
  v_fp_a := greatest(-1, least(1, v_fp_base + v_desv_fp * (random() - 0.5) * 2));
  v_fp_b := greatest(-1, least(1, v_fp_base + v_desv_fp * (random() - 0.5) * 2));
  v_fp_c := greatest(-1, least(1, v_fp_base + v_desv_fp * (random() - 0.5) * 2));

  -- Fase ausente: zera tensão e corrente da(s) fase(s) configurada(s)
  if position('a' in v_ausente) > 0 then v_v_a := 0; v_i_a := 0; end if;
  if position('b' in v_ausente) > 0 then v_v_b := 0; v_i_b := 0; end if;
  if position('c' in v_ausente) > 0 then v_v_c := 0; v_i_c := 0; end if;

  -- Aplica spike/drift se houver incidente ativo (sobre a corrente fase A representativa)
  declare v_i_a_ajustada numeric := sim_aplicar_incidentes(p_sensor_id, v_i_a);
  begin
    if v_i_a_ajustada is null then
      return; -- gap/offline: não insere
    end if;
    if v_i_a_ajustada != v_i_a then
      -- propaga proporcionalmente
      v_i_b := v_i_b * (v_i_a_ajustada / nullif(v_i_a, 0));
      v_i_c := v_i_c * (v_i_a_ajustada / nullif(v_i_a, 0));
      v_i_a := v_i_a_ajustada;
    end if;
  end;

  insert into leituras_energia (
    sensor_id, momento,
    corrente_fase_a, corrente_fase_b, corrente_fase_c,
    tensao_fase_a, tensao_fase_b, tensao_fase_c,
    fator_potencia_a, fator_potencia_b, fator_potencia_c
  ) values (
    p_sensor_id, p_ts,
    round(v_i_a, 3), round(v_i_b, 3), round(v_i_c, 3),
    round(v_v_a, 3), round(v_v_b, 3), round(v_v_c, 3),
    round(v_fp_a, 4), round(v_fp_b, 4), round(v_fp_c, 4)
  )
  on conflict (sensor_id, momento) do nothing;
end;
$$;


-- ===================== GERADOR: TEMPERATURA =====================
create or replace function sim_gerar_temperatura(p_sensor_id text, p_ts timestamptz default now())
returns void language plpgsql as $$
declare
  p          jsonb;
  v_centro   numeric;
  v_desvio   numeric;
  v_ciclico  boolean;
  v_ampl     numeric;
  v_defeito  boolean;
  v_p_pico   numeric;
  v_p_imp    numeric;
  v_valor    numeric;
  v_periodo  int;
begin
  select parametros into p from sensores where id = p_sensor_id;
  if p is null then return; end if;

  v_centro  := coalesce((p->>'media_real_c')::numeric, (p->>'setpoint_c')::numeric, 0);
  v_desvio  := coalesce((p->>'desvio_c')::numeric, 1);
  v_ciclico := coalesce((p->>'ciclo_diario')::boolean, false);
  v_ampl    := coalesce((p->>'amplitude_diaria_c')::numeric, 0);
  v_defeito := coalesce((p->>'sensor_defeituoso')::boolean, false);
  v_p_pico  := coalesce((p->>'prob_pico_defeito')::numeric, 0);
  v_p_imp   := coalesce((p->>'prob_valor_impossivel')::numeric, 0);

  if v_ciclico then
    -- Ambiente: cosseno diário + ruído
    v_valor := v_centro + (v_ampl / 2) * (2 * sim_fator_dia_noite(p_ts) - 1)
             + v_desvio * (random() - 0.5) * 2;
  else
    -- Câmara: dente-de-serra do termostato + ruído pequeno
    v_periodo := case when position('congelados' in p_sensor_id) > 0 then 1800 else 900 end;
    v_valor := v_centro + (v_desvio / 2) * sim_sawtooth(p_ts, v_periodo)
             + v_desvio * 0.4 * (random() - 0.5) * 2;
  end if;

  -- Defeitos do sensor
  if v_defeito then
    if random() < v_p_pico then v_valor := 85.0; end if;
    if random() < v_p_imp  then v_valor := -3276.8; end if;
  end if;

  -- Incidentes ativos
  v_valor := sim_aplicar_incidentes(p_sensor_id, v_valor);
  if v_valor is null then return; end if;

  insert into leituras_temperatura (sensor_id, momento, temperatura)
  values (p_sensor_id, p_ts, round(v_valor, 2))
  on conflict (sensor_id, momento) do nothing;
end;
$$;


-- ===================== GERADOR: PORTA =====================
create or replace function sim_gerar_porta(p_sensor_id text, p_ts timestamptz default now())
returns void language plpgsql as $$
declare
  p             jsonb;
  v_taxa_h      numeric;
  v_dur_media   numeric;
  v_analogico   boolean;
  v_max         numeric;
  v_prob_aberta numeric;
  v_valor       numeric := 0;
begin
  select parametros into p from sensores where id = p_sensor_id;
  if p is null then return; end if;

  v_taxa_h    := coalesce((p->>'aberturas_por_hora')::numeric, 0.3);
  v_dur_media := coalesce((p->>'duracao_media_s')::numeric, 600);
  v_analogico := coalesce((p->>'sinal_analogico')::boolean, false);
  v_max       := coalesce((p->>'valor_aberto_max')::numeric, 1);

  -- Probabilidade de a porta estar aberta neste instante = taxa × duração média
  -- (cap em 0.9 pra nunca ficar 100% do tempo)
  v_prob_aberta := least(0.9, v_taxa_h * v_dur_media / 3600.0);

  -- Levemente concentrada em horário comercial (10h-22h UTC ≈ 7h-19h BRT)
  if extract(hour from p_ts) between 10 and 22 then
    v_prob_aberta := v_prob_aberta * 1.4;
  else
    v_prob_aberta := v_prob_aberta * 0.6;
  end if;

  if random() < v_prob_aberta then
    if v_analogico then
      v_valor := greatest(0, least(v_max, v_max * 0.7 + v_max * 0.15 * (random() - 0.5) * 2));
    else
      v_valor := v_max;
    end if;
  end if;

  v_valor := sim_aplicar_incidentes(p_sensor_id, v_valor);
  if v_valor is null then return; end if;

  insert into leituras_porta (sensor_id, momento, abertura_porta)
  values (p_sensor_id, p_ts, round(v_valor, 2))
  on conflict (sensor_id, momento) do nothing;
end;
$$;


-- ===================== ORQUESTRADOR =====================
-- Roda 1× a cada minuto (via pg_cron) e gera 1 ponto pra cada sensor ativo.
create or replace function sim_tick()
returns table(sensor_id text, gerou boolean) language plpgsql as $$
declare
  r record;
begin
  for r in
    select id, tipo from sensores where status = 'ativo' order by id
  loop
    if r.tipo = 'energia' then
      perform sim_gerar_energia(r.id);
    elsif r.tipo = 'temperatura' then
      perform sim_gerar_temperatura(r.id);
    elsif r.tipo = 'porta' then
      perform sim_gerar_porta(r.id);
    end if;
    sensor_id := r.id; gerou := true; return next;
  end loop;
end;
$$;


-- ===================== WARM-UP HISTÓRICO =====================
-- Gera retroativamente N horas de dados pra cada sensor ativo.
-- Cadência: 1 ponto a cada 60s (compatível com tick a cada 1 min).
create or replace function sim_warmup(p_horas int default 24)
returns int language plpgsql as $$
declare
  v_inicio timestamptz := now() - (p_horas || ' hours')::interval;
  v_passo  interval := '60 seconds';
  v_ts     timestamptz;
  v_total  int := 0;
  r        record;
begin
  v_ts := v_inicio;
  while v_ts <= now() loop
    for r in select id, tipo from sensores where status = 'ativo' loop
      if r.tipo = 'energia' then
        perform sim_gerar_energia(r.id, v_ts);
      elsif r.tipo = 'temperatura' then
        perform sim_gerar_temperatura(r.id, v_ts);
      elsif r.tipo = 'porta' then
        perform sim_gerar_porta(r.id, v_ts);
      end if;
      v_total := v_total + 1;
    end loop;
    v_ts := v_ts + v_passo;
  end loop;
  return v_total;
end;
$$;


-- ===================== AGENDAMENTO =====================
-- Remove agendamento anterior (idempotente)
do $$
begin
  perform cron.unschedule('datacold_simulador_tick');
exception when others then null;
end$$;

-- Cron: roda sim_tick() a cada 3 segundos (sintaxe sub-minuto do pg_cron 1.4+).
-- Antes era '* * * * *' (1 ponto/min); agora cada sensor recebe ~20 pontos/min,
-- fazendo o velocímetro/gráfico ficarem "ao vivo" pra valer.
select cron.schedule(
  'datacold_simulador_tick',
  '3 seconds',
  $$ select sim_tick(); $$
);
