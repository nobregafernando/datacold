-- =====================================================================
-- DataCold · status do email pra fluxo de recuperação de senha
--
-- Retorna o que o front precisa pra dar mensagem específica em vez
-- da resposta genérica do /auth/v1/recover (que sempre retorna 200
-- pra evitar enumeração — bom em geral, ruim pra UX onde o user
-- quer saber "essa conta existe?").
--
-- IMPORTANT: expor essa informação publicamente permite enumeração
-- de emails. Decisão consciente do produto.
--
-- Retornos:
--   'inexistente'  — não existe conta com esse email
--   'inativo'      — existe mas está desativada (admin bloqueou)
--   'ativo'        — existe e pode receber link de recuperação
-- =====================================================================
create or replace function status_email_recuperacao(p_email text)
returns text language plpgsql security definer
set search_path = public, auth as $$
declare
  v_id    uuid;
  v_ativo boolean;
begin
  if p_email is null or btrim(p_email) = '' then
    return 'inexistente';
  end if;
  select u.id, coalesce(p.ativo, true)
    into v_id, v_ativo
    from auth.users u
    left join perfis_usuarios p on p.id = u.id
   where lower(u.email) = lower(btrim(p_email));
  if v_id is null then return 'inexistente'; end if;
  if not v_ativo then return 'inativo'; end if;
  return 'ativo';
end;
$$;

comment on function status_email_recuperacao(text) is
  'Recuperação de senha: diferencia inexistente/inativo/ativo. Permite enumeração de emails — decisão consciente do produto pra UX.';

grant execute on function status_email_recuperacao(text) to anon, authenticated;
