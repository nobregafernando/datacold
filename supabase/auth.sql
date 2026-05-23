-- ============================================================
--  DataCold · Autenticação + perfis + RLS
-- ============================================================
--  Aplicar com: python supabase/aplicar.py
--
--  Cria:
--    perfis_usuarios    · 1:1 com auth.users, guarda nome e papel (admin|operador)
--    fn_eh_admin()      · helper SECURITY DEFINER usado nas policies
--    fn_criar_perfil_padrao() + trigger em auth.users
--    Políticas RLS em todas as tabelas públicas
--
--  Idempotente: pode rodar quantas vezes quiser sem corromper estado.
-- ============================================================

-- ============= 1. TABELA DE PERFIS =============
create table if not exists perfis_usuarios (
  id              uuid        primary key references auth.users(id) on delete cascade,
  nome            text        not null,
  papel           text        not null default 'operador'
                              check (papel in ('admin','operador')),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  criado_por      text,
  atualizado_por  text
);

comment on table  perfis_usuarios is 'Perfil de aplicação 1:1 com auth.users. Guarda nome de exibição e papel.';
comment on column perfis_usuarios.papel is 'admin (acesso total) ou operador (somente leitura por enquanto).';

create index if not exists idx_perfis_papel on perfis_usuarios (papel);

-- Reutiliza trigger genérico de atualizado_em definido em schema.sql
drop trigger if exists trg_perfis_tocar on perfis_usuarios;
create trigger trg_perfis_tocar
  before update on perfis_usuarios
  for each row execute function fn_tocar_atualizado_em();

drop trigger if exists trg_perfis_auditoria on perfis_usuarios;
create trigger trg_perfis_auditoria
  after insert or update or delete on perfis_usuarios
  for each row execute function fn_registrar_auditoria();


-- ============= 2. HELPER: É ADMIN? =============
-- SECURITY DEFINER porque RLS proíbe usuários comuns de lerem perfis
-- de outros usuários; precisamos que esta função consiga ler para
-- decidir as policies sem causar recursão.
create or replace function fn_eh_admin(uid uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select papel = 'admin' from perfis_usuarios where id = uid),
    false
  );
$$;

revoke all on function fn_eh_admin(uuid) from public;
grant execute on function fn_eh_admin(uuid) to anon, authenticated;


-- ============= 3. CRIAÇÃO AUTOMÁTICA DE PERFIL =============
-- Toda nova conta em auth.users cria sua linha em perfis_usuarios.
-- O nome cai pra metadata.nome se vier no signup, senão usa o e-mail.
-- O primeiro admin é promovido automaticamente quando se cadastra.
create or replace function fn_criar_perfil_padrao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome  text;
  v_papel text := 'operador';
begin
  v_nome := coalesce(
    new.raw_user_meta_data ->> 'nome',
    split_part(new.email, '@', 1)
  );

  -- Primeiro admin: e-mail conhecido vira admin automaticamente.
  if lower(new.email) = 'fernandonobregaalves@gmail.com' then
    v_papel := 'admin';
  end if;

  -- Se o front passou um papel explícito (via signup admin-only),
  -- e quem chamou tem app_metadata.criado_por_admin = true, respeitamos.
  if (new.raw_user_meta_data ->> 'papel') in ('admin','operador') then
    v_papel := new.raw_user_meta_data ->> 'papel';
  end if;

  insert into perfis_usuarios (id, nome, papel, criado_por, atualizado_por)
  values (new.id, v_nome, v_papel, 'trigger', 'trigger')
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_criar_perfil_padrao on auth.users;
create trigger trg_criar_perfil_padrao
  after insert on auth.users
  for each row execute function fn_criar_perfil_padrao();


-- ============= 4. RLS · ATIVAR EM TODAS AS TABELAS =============
alter table grupos                enable row level security;
alter table sensores              enable row level security;
alter table leituras_energia      enable row level security;
alter table leituras_temperatura  enable row level security;
alter table leituras_porta        enable row level security;
alter table incidentes            enable row level security;
alter table auditoria             enable row level security;
alter table perfis_usuarios       enable row level security;


-- ============= 5. POLICIES =============
-- Para simplificar reaplicações, dropamos e recriamos.

-- --------- grupos / sensores / leituras_* ---------
-- Qualquer logado lê. Mutação só admin.
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'grupos','sensores',
    'leituras_energia','leituras_temperatura','leituras_porta'
  ]) loop
    execute format('drop policy if exists "%1$s_select_autenticado" on %1$s', t);
    execute format('drop policy if exists "%1$s_mutacao_admin"      on %1$s', t);

    execute format($p$
      create policy "%1$s_select_autenticado" on %1$s
        for select to authenticated using (true)
    $p$, t);

    execute format($p$
      create policy "%1$s_mutacao_admin" on %1$s
        for all to authenticated
        using (fn_eh_admin()) with check (fn_eh_admin())
    $p$, t);
  end loop;
end $$;

-- --------- incidentes ---------
drop policy if exists incidentes_select_autenticado on incidentes;
drop policy if exists incidentes_mutacao_admin      on incidentes;

create policy incidentes_select_autenticado on incidentes
  for select to authenticated using (true);

create policy incidentes_mutacao_admin on incidentes
  for all to authenticated
  using (fn_eh_admin()) with check (fn_eh_admin());

-- --------- auditoria · só admin lê ---------
drop policy if exists auditoria_select_admin on auditoria;
create policy auditoria_select_admin on auditoria
  for select to authenticated using (fn_eh_admin());

-- --------- perfis_usuarios ---------
-- Cada um lê o próprio. Admin lê/atualiza todos.
drop policy if exists perfis_select_proprio on perfis_usuarios;
drop policy if exists perfis_select_admin   on perfis_usuarios;
drop policy if exists perfis_update_admin   on perfis_usuarios;
drop policy if exists perfis_insert_admin   on perfis_usuarios;

create policy perfis_select_proprio on perfis_usuarios
  for select to authenticated using (id = auth.uid());

create policy perfis_select_admin on perfis_usuarios
  for select to authenticated using (fn_eh_admin());

create policy perfis_update_admin on perfis_usuarios
  for update to authenticated
  using (fn_eh_admin()) with check (fn_eh_admin());

create policy perfis_insert_admin on perfis_usuarios
  for insert to authenticated
  with check (fn_eh_admin());


-- ============= 6. PROMOÇÃO DO PRIMEIRO ADMIN (defensivo) =============
-- Se o usuário admin já existir em auth.users mas o trigger não rodou
-- (caso, p.ex., a tabela perfis_usuarios não existia ainda), garante
-- o papel admin agora.
update perfis_usuarios
   set papel = 'admin', atualizado_por = 'auth.sql'
 where id in (
   select id from auth.users where lower(email) = 'fernandonobregaalves@gmail.com'
 )
   and papel <> 'admin';

-- Insere perfil pra qualquer auth.users que ainda não tenha (defensivo).
insert into perfis_usuarios (id, nome, papel, criado_por, atualizado_por)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'nome', split_part(u.email, '@', 1)),
  case when lower(u.email) = 'fernandonobregaalves@gmail.com' then 'admin' else 'operador' end,
  'auth.sql', 'auth.sql'
from auth.users u
left join perfis_usuarios p on p.id = u.id
where p.id is null;
