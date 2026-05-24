"""
Habilita Supabase Realtime nas tabelas de leituras — dispara eventos
WebSocket pra qualquer cliente subscrito quando uma row é inserida.
"""
import os
from pathlib import Path
import psycopg2
from dotenv import load_dotenv

load_dotenv(Path('.env'))
conn = psycopg2.connect(
    host='aws-1-us-west-1.pooler.supabase.com', port=6543, dbname='postgres',
    user=f"postgres.{os.environ['SUPABASE_PROJECT_ID']}",
    password=os.environ['SUPABASE_DB_PASSWORD'], sslmode='require'
)

SQL = """
-- Garante que a publication existe (criada pelo Supabase por padrão)
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- Adiciona as 3 tabelas de leituras (idempotente: 'add table' falha se já existe,
-- então usamos try/except simulado)
do $$
begin
  begin
    alter publication supabase_realtime add table leituras_energia;
    raise notice 'leituras_energia adicionada à publication';
  exception when duplicate_object then
    raise notice 'leituras_energia já estava';
  end;
  begin
    alter publication supabase_realtime add table leituras_temperatura;
    raise notice 'leituras_temperatura adicionada';
  exception when duplicate_object then
    raise notice 'leituras_temperatura já estava';
  end;
  begin
    alter publication supabase_realtime add table leituras_porta;
    raise notice 'leituras_porta adicionada';
  exception when duplicate_object then
    raise notice 'leituras_porta já estava';
  end;
end $$;
"""

with conn.cursor() as cur:
    cur.execute(SQL)
    # imprime as notices
    for notice in conn.notices:
        print('  ', notice.strip())

conn.commit()

# Confirma
with conn.cursor() as cur:
    cur.execute("""
      select schemaname, tablename
      from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename like 'leituras_%'
      order by tablename;
    """)
    print('\nTabelas no publication supabase_realtime:')
    for row in cur.fetchall():
        print(f'  {row[0]}.{row[1]}')

conn.close()
print('\n[ok] Realtime habilitado nas tabelas de leituras')
