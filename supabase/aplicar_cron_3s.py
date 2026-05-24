"""
One-shot: troca o agendamento do simulador de '1 minuto' pra '3 segundos'.
Requer pg_cron 1.5+ no Supabase (sintaxe interval para sub-minuto).

Uso:
    simulador/.venv/bin/python supabase/aplicar_cron_3s.py
"""

import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parent.parent
load_dotenv(RAIZ / ".env")

conn = psycopg2.connect(
    host="aws-1-us-west-1.pooler.supabase.com",
    port=6543,
    dbname="postgres",
    user=f"postgres.{os.environ['SUPABASE_PROJECT_ID']}",
    password=os.environ["SUPABASE_DB_PASSWORD"],
    sslmode="require",
)

with conn.cursor() as cur:
    # Remove o agendamento antigo (idempotente)
    cur.execute("select cron.unschedule('datacold_simulador_tick');")
    print("[ok] agendamento antigo removido")

    # Cria novo agendamento a cada 3 segundos
    cur.execute(
        "select cron.schedule('datacold_simulador_tick', '3 seconds', "
        "$$ select sim_tick(); $$);"
    )
    novo_jobid = cur.fetchone()[0]
    print(f"[ok] novo agendamento criado (jobid={novo_jobid}, intervalo=3s)")

    # Confirma
    cur.execute("select jobid, schedule, command from cron.job where jobname = 'datacold_simulador_tick';")
    for row in cur.fetchall():
        print(f"[info] jobid={row[0]} schedule='{row[1]}' command={row[2][:60]}...")

conn.commit()
conn.close()
print("[ok] feito — o simulador agora insere 1 ponto por sensor a cada 3 segundos")
