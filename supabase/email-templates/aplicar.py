"""
Aplica os templates HTML dos emails (recovery, invite) no Supabase Auth
via Management API. Roda quando quiser atualizar o visual sem precisar
do Dashboard.

Uso:
    python supabase/email-templates/aplicar.py

Lê de .env:
    SUPABASE_PROJECT_ID (ex: fcverbceppwdbveustvq)
    SUPABASE_ACCESS_TOKEN (PAT sbp_... — pega em supabase.com/dashboard/account/tokens)
"""
import os, json, urllib.request, urllib.error
from pathlib import Path
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parent.parent.parent
load_dotenv(RAIZ / ".env")

PROJ = os.environ.get("SUPABASE_PROJECT_ID", "fcverbceppwdbveustvq")
PAT  = os.environ.get("SUPABASE_ACCESS_TOKEN")
if not PAT:
    raise SystemExit(
        "Falta SUPABASE_ACCESS_TOKEN no .env. Pega em "
        "https://supabase.com/dashboard/account/tokens"
    )

PASTA = Path(__file__).resolve().parent

# Mapa: chave da config no Supabase → arquivo HTML local
TEMPLATES = {
    "mailer_templates_recovery_content": "recovery.html",
    "mailer_templates_invite_content":   "invite.html",
}

# Subjects em português
SUBJECTS = {
    "mailer_subjects_recovery": "Redefinir sua senha — DataCold",
    "mailer_subjects_invite":   "Você foi convidado para a DataCold",
}


def patch_auth_config(body):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJ}/config/auth",
        method="PATCH",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {PAT}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        txt = e.read().decode(errors="replace") or "{}"
        try:
            return e.code, json.loads(txt)
        except Exception:
            return e.code, {"raw": txt}


def principal():
    body = {}
    for chave, nome in TEMPLATES.items():
        html = (PASTA / nome).read_text(encoding="utf-8")
        body[chave] = html
        print(f"  [ok] carregado {nome} ({len(html)} chars)")
    body.update(SUBJECTS)
    for k, v in SUBJECTS.items():
        print(f"  [ok] subject {k} = {v!r}")
    print()
    print("Aplicando via Management API...")
    status, resp = patch_auth_config(body)
    if status == 200:
        # Confirma
        print(f"[ok] HTTP 200 — templates aplicados no projeto {PROJ}")
        for k in list(TEMPLATES.keys()) + list(SUBJECTS.keys()):
            v = resp.get(k, "")
            marca = "✓" if v else "✗"
            print(f"  {marca} {k:45} ({len(str(v))} chars)")
    else:
        print(f"[erro] HTTP {status}")
        print(json.dumps(resp, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    principal()
