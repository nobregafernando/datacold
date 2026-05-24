-- ============================================================
--  DataCold · Gerenciamento de usuários (admin only)
--  - Coluna `ativo` em perfis_usuarios
--  - RPC listar_usuarios (com email + ativo)
--  - RPCs desativar/reativar/deletar
--  - RPC enviar_recuperacao_senha (admin dispara reset pra outro user)
-- ============================================================

-- 1) Coluna `ativo` (default true; usuários antigos continuam ativos)
alter table perfis_usuarios
  add column if not exists ativo boolean not null default true;

-- 2) listar_usuarios atualizado: inclui email (auth.users) + ativo
drop function if exists listar_usuarios();
create or replace function listar_usuarios()
returns table(
  id            uuid,
  nome          text,
  email         text,
  papel         text,
  ativo         boolean,
  criado_em     timestamptz,
  atualizado_em timestamptz,
  ultimo_acesso timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not fn_eh_admin() then
    raise exception 'Apenas administradores podem listar usuários.'
      using errcode = '42501';
  end if;
  return query
    select
      p.id,
      p.nome,
      u.email::text,
      p.papel,
      p.ativo,
      p.criado_em,
      p.atualizado_em,
      (select max(a.criado_em) from acessos a where a.user_id = p.id) as ultimo_acesso
    from perfis_usuarios p
    left join auth.users u on u.id = p.id
    order by p.ativo desc, p.papel asc, p.nome asc;
end;
$$;

-- 3) Desativar usuário (admin)
create or replace function desativar_usuario(p_id uuid)
returns jsonb language plpgsql security definer as $$
begin
  if not fn_eh_admin() then
    raise exception 'Apenas admin pode desativar usuários' using errcode = '42501';
  end if;
  if p_id = auth.uid() then
    raise exception 'Você não pode desativar a si mesmo' using errcode = '42501';
  end if;
  update perfis_usuarios set ativo = false, atualizado_em = now() where id = p_id;
  if not found then
    raise exception 'Usuário não encontrado' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'ativo', false);
end;
$$;

-- 4) Reativar usuário (admin)
create or replace function reativar_usuario(p_id uuid)
returns jsonb language plpgsql security definer as $$
begin
  if not fn_eh_admin() then
    raise exception 'Apenas admin pode reativar usuários' using errcode = '42501';
  end if;
  update perfis_usuarios set ativo = true, atualizado_em = now() where id = p_id;
  if not found then
    raise exception 'Usuário não encontrado' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'ativo', true);
end;
$$;

-- 5) Verificar se usuário está ativo (chamado pelo login — sem auth, security definer)
create or replace function checar_ativo_por_email(p_email text)
returns boolean language plpgsql security definer
set search_path = public, auth as $$
declare
  v_ativo boolean;
begin
  select p.ativo into v_ativo
    from perfis_usuarios p
    join auth.users u on u.id = p.id
   where lower(u.email) = lower(p_email);
  return coalesce(v_ativo, true);   -- se não tem perfil ainda, assume ativo
end;
$$;

-- 6) Disparar email de recuperação de senha pra outro usuário (admin)
--    Retorna só o email (o envio é feito pelo proxy via auth:recover).
create or replace function obter_email_usuario(p_id uuid)
returns text language plpgsql security definer
set search_path = public, auth as $$
declare
  v_email text;
begin
  if not fn_eh_admin() then
    raise exception 'Apenas admin' using errcode = '42501';
  end if;
  select u.email into v_email from auth.users u where u.id = p_id;
  if v_email is null then
    raise exception 'Usuário não encontrado' using errcode = 'P0002';
  end if;
  return v_email;
end;
$$;

-- 7) Grants
grant execute on function listar_usuarios()                  to authenticated;
grant execute on function desativar_usuario(uuid)            to authenticated;
grant execute on function reativar_usuario(uuid)             to authenticated;
grant execute on function checar_ativo_por_email(text)       to anon, authenticated;
grant execute on function obter_email_usuario(uuid)          to authenticated;

-- Revoga checar_ativo de anon? Não — login.html é anônimo quando chama.
-- A função é só boolean, sem PII.
