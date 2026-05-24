-- =====================================================================
-- DataCold · Histórico de acessos (login)
--
-- Tabela `acessos` registra um evento por login bem-sucedido.
-- RLS: cada usuário lê apenas os próprios. Insert via RPC SECURITY
-- DEFINER pra que mesmo um operador autenticado consiga gravar o
-- próprio acesso sem precisar de service_role no front.
-- =====================================================================

create table if not exists acessos (
  id          bigserial primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  criado_em   timestamptz not null default now(),
  ip          text,
  user_agent  text,
  origem      text        not null default 'login'    -- login | refresh | mvp | manual
);

create index if not exists idx_acessos_user_data on acessos (user_id, criado_em desc);

comment on table  acessos is 'Histórico de acessos (login) — 1 linha por evento de autenticação bem-sucedido.';
comment on column acessos.origem is 'Como o acesso foi gerado: login (senha), refresh (token renovado), mvp, manual.';

alter table acessos enable row level security;

drop policy if exists acessos_select_proprio on acessos;
create policy acessos_select_proprio on acessos
  for select to authenticated
  using (user_id = auth.uid());

-- =====================================================================
-- RPC `registrar_acesso(p_ua, p_origem)`
-- Insere uma linha em `acessos` para o usuário autenticado atual.
-- SECURITY DEFINER pra contornar RLS no insert (a policy só permite
-- SELECT do próprio — sem ela o usuário não consegue inserir).
-- =====================================================================
create or replace function registrar_acesso(
  p_ua     text default null,
  p_origem text default 'login'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;   -- sem JWT válido: ignora silenciosamente
  end if;

  insert into acessos (user_id, user_agent, origem)
  values (
    auth.uid(),
    nullif(left(coalesce(p_ua, ''), 500), ''),
    coalesce(nullif(p_origem, ''), 'login')
  );
end;
$$;

grant execute on function registrar_acesso(text, text) to authenticated;

comment on function registrar_acesso(text, text) is
  'Insere 1 linha em `acessos` para auth.uid() atual. Idempotente quanto a falha de auth (no-op se sem JWT).';

-- =====================================================================
-- RPC `listar_meus_acessos(p_limite int)`
-- Histórico do próprio usuário (max 100). Mais novo primeiro.
-- =====================================================================
create or replace function listar_meus_acessos(p_limite int default 20)
returns table(id bigint, criado_em timestamptz, ip text, user_agent text, origem text)
language sql
stable
security definer
set search_path = public
as $$
  select id, criado_em, ip, user_agent, origem
    from acessos
   where user_id = auth.uid()
   order by criado_em desc
   limit greatest(1, least(coalesce(p_limite, 20), 100));
$$;

grant execute on function listar_meus_acessos(int) to authenticated;

-- =====================================================================
-- RPC `listar_usuarios()` — admin only.
-- Retorna todos os perfis. Usa fn_eh_admin() pra gatekeep.
-- =====================================================================
create or replace function listar_usuarios()
returns table(id uuid, nome text, papel text, criado_em timestamptz, atualizado_em timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not fn_eh_admin() then
    raise exception 'Apenas administradores podem listar usuários.' using errcode = '42501';
  end if;
  return query
    select p.id, p.nome, p.papel, p.criado_em, p.atualizado_em
      from perfis_usuarios p
      order by p.papel asc, p.nome asc;
end;
$$;

grant execute on function listar_usuarios() to authenticated;
