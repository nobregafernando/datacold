-- ============================================================
--  DataCold · Bloqueio server-side: só admin pode escrever
--  ============================================================
--  As RPCs abaixo eram SECURITY DEFINER e estavam executáveis por
--  qualquer chamador (anon ou authenticated), sem checar papel.
--  Aqui adicionamos validação interna via fn_eh_admin_atual().
--
--  fn_eh_admin_atual() já existe (definida em supabase/auth.sql) e
--  retorna boolean baseado em auth.uid() + perfis_usuarios.papel.
-- ============================================================

-- ---------- criar_incidente ----------
create or replace function criar_incidente(
  p_sensor    text,
  p_tipo      text,
  p_duracao_s int     default null,
  p_magnitude numeric default 0,
  p_valor     numeric default 0,
  p_descricao text    default ''
) returns jsonb language plpgsql security definer as $$
declare
  v_id   uuid;
  v_fim  timestamptz;
begin
  if not fn_eh_admin_atual() then
    raise exception 'Apenas admin pode criar incidente'
      using errcode = '42501';   -- insufficient_privilege
  end if;

  if p_duracao_s is not null then
    v_fim := now() + (p_duracao_s || ' seconds')::interval;
  end if;

  insert into incidentes (sensor_id, tipo, magnitude, valor, descricao, criado_em, fim_em)
  values (p_sensor, p_tipo, p_magnitude, p_valor, coalesce(p_descricao, ''), now(), v_fim)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'sensor', p_sensor, 'tipo', p_tipo, 'fim_em', v_fim);
end;
$$;

-- ---------- cancelar_incidente ----------
create or replace function cancelar_incidente(p_id uuid)
returns jsonb language plpgsql security definer as $$
begin
  if not fn_eh_admin_atual() then
    raise exception 'Apenas admin pode cancelar incidente'
      using errcode = '42501';
  end if;

  update incidentes
     set removido_em = now()
   where id = p_id and removido_em is null;

  if not found then
    return jsonb_build_object('removido', false, 'erro', 'não encontrado ou já removido');
  end if;
  return jsonb_build_object('removido', true, 'id', p_id);
end;
$$;

-- ---------- atualizar_parametros_sensor ----------
create or replace function atualizar_parametros_sensor(
  p_sensor     text,
  p_parametros jsonb
) returns jsonb language plpgsql security definer as $$
declare
  v_atuais jsonb;
begin
  if not fn_eh_admin_atual() then
    raise exception 'Apenas admin pode atualizar parâmetros'
      using errcode = '42501';
  end if;

  select parametros into v_atuais from sensores where id = p_sensor;
  if not found then
    raise exception 'sensor % não existe', p_sensor;
  end if;

  update sensores
     set parametros = coalesce(v_atuais, '{}'::jsonb) || coalesce(p_parametros, '{}'::jsonb),
         atualizado_em = now()
   where id = p_sensor;

  return jsonb_build_object('ok', true, 'sensor', p_sensor);
end;
$$;

grant execute on function criar_incidente(text, text, int, numeric, numeric, text) to authenticated;
grant execute on function cancelar_incidente(uuid) to authenticated;
grant execute on function atualizar_parametros_sensor(text, jsonb) to authenticated;

-- Revoga do anon — agora só usuário autenticado consegue tentar (e a checagem
-- interna ainda exige papel admin).
revoke execute on function criar_incidente(text, text, int, numeric, numeric, text) from anon;
revoke execute on function cancelar_incidente(uuid) from anon;
revoke execute on function atualizar_parametros_sensor(text, jsonb) from anon;
