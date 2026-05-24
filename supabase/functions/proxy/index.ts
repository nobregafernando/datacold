// =============================================================================
//  DataCold · Edge Function "proxy"
//  ----------------------------------------------------------------------------
//  Único endpoint público do front. Esconde as chaves do Supabase (anon key,
//  service key, BEM API key) atrás de um router fechado por whitelist.
//
//  Request body:
//    { acao: "rpc:<nome>" | "auth:<acao>" | "perfil:buscar",
//      payload?: any,
//      jwt?: string          // token do usuário autenticado (opcional)
//    }
//
//  Variáveis de ambiente (configurar via `supabase secrets set ...`):
//    SB_URL                ex: https://fcverbceppwdbveustvq.supabase.co
//    SB_ANON_KEY           anon key pública do Supabase
//    SB_SERVICE_KEY        service_role key (usada em auth:admin_criar, que
//                          cria usuários sem cair no rate-limit do /signup
//                          anônimo). Nunca exposta ao cliente.
//    GMAIL_USER            email Gmail que envia (ex: datacold26@gmail.com).
//                          Requer App Password (https://myaccount.google.com/apppasswords)
//                          e 2FA ativado.
//    GMAIL_APP_PASSWORD    App Password de 16 chars (sem espaços).
//    GMAIL_FROM_NAME       nome de exibição do remetente (default "DataCold").
//
//  Fallback (se GMAIL_* não configurado, tenta via Resend):
//    RESEND_API_KEY        chave Resend
//    RESEND_FROM           remetente Resend (default "onboarding@resend.dev")
//
//    BEM_API_KEY           chave da BEM Inteligência (não usado, reservado)
//
//  Deploy:
//    supabase functions deploy proxy --no-verify-jwt
// =============================================================================

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SB_URL             = Deno.env.get("SB_URL")             ?? "";
const SB_ANON_KEY        = Deno.env.get("SB_ANON_KEY")        ?? "";
const SB_SERVICE_KEY     = Deno.env.get("SB_SERVICE_KEY")     ?? "";
const GMAIL_USER         = Deno.env.get("GMAIL_USER")         ?? "";
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD") ?? "";
const GMAIL_FROM_NAME    = Deno.env.get("GMAIL_FROM_NAME")    ?? "DataCold";
const RESEND_API_KEY     = Deno.env.get("RESEND_API_KEY")     ?? "";
const RESEND_FROM        = Deno.env.get("RESEND_FROM")        ?? "DataCold <onboarding@resend.dev>";

// CORS — em produção restringe ao domínio Firebase Hosting.
const ORIGENS_PERMITIDAS = new Set([
  "https://datacold.web.app",
  "https://datacold.firebaseapp.com",
  "http://localhost:5500",
  "http://localhost:5501",
  "http://localhost:8080",
  "http://127.0.0.1:5500",
  "http://127.0.0.1:5501",
  "http://127.0.0.1:8080",
]);

// Whitelist de RPCs Postgres que podem ser chamados via "rpc:<nome>".
const RPCS_PERMITIDAS = new Set([
  "verificar_saude",
  "listar_catalogo",
  "buscar_dados",
  "criar_incidente",
  "cancelar_incidente",
  "atualizar_parametros_sensor",
  "obter_parametros_sensor",
  "incidentes_ativos",
  // Dashboard admin (leituras agregadas)
  "listar_perfis_sensores",
  "listar_incidentes_ativos_resumo",
  "listar_ultimas_leituras",
  // Notificações multi-usuário
  "listar_minhas_notificacoes",
  "contar_nao_lidas",
  "marcar_notificacao_lida",
  "arquivar_notificacao",
  "desarquivar_notificacao",
  "marcar_todas_lidas",
  // Histórico de acessos (login)
  "registrar_acesso",
  "listar_meus_acessos",
  // Admin: lista usuários (perfis_usuarios via RPC com fn_eh_admin)
  "listar_usuarios",
  // Admin: gestão de usuários
  "desativar_usuario",
  "reativar_usuario",
  "obter_email_usuario",
  // Público (sem JWT): usado pelo login pra detectar conta desativada
  "checar_ativo_por_email",
]);

// Whitelist de ações de auth.
const AUTH_PERMITIDAS = new Set([
  "signin",          // POST /auth/v1/token?grant_type=password
  "signup",          // POST /auth/v1/signup  (rate-limited pelo Supabase — evite)
  "signout",         // POST /auth/v1/logout              (precisa JWT)
  "recover",         // POST /auth/v1/recover  (legado — SMTP do Supabase)
  "user",            // GET  /auth/v1/user                (precisa JWT)
  "atualizar",       // PUT  /auth/v1/user                (precisa JWT — define senha/nome)
  "refresh",         // POST /auth/v1/token?grant_type=refresh_token
  "admin_criar",     // POST /auth/v1/admin/users  (REQUER admin chamando, usa service_key)
  "admin_deletar",   // DELETE /auth/v1/admin/users/{id}  (REQUER admin chamando, usa service_key)
  "recuperar_senha", // gera link admin + envia via Gmail SMTP (template DataCold)
]);

function cors(origem: string | null) {
  const ok = origem && ORIGENS_PERMITIDAS.has(origem) ? origem : "null";
  return {
    "access-control-allow-origin":  ok,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-max-age":       "86400",
    "vary":                          "Origin",
  };
}

function jsonResposta(corpo: unknown, status = 200, extras: Record<string, string> = {}) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json", ...extras },
  });
}

async function chamarPostgrest(path: string, init: RequestInit & { jwt?: string }) {
  const { jwt, headers: hExtra, ...resto } = init;
  const headers: Record<string, string> = {
    "apikey":        SB_ANON_KEY,
    "Authorization": `Bearer ${jwt ?? SB_ANON_KEY}`,
    "content-type":  "application/json",
    ...(hExtra as Record<string, string> ?? {}),
  };
  const resp = await fetch(`${SB_URL}${path}`, { ...resto, headers });
  const texto = await resp.text();
  // PostgREST retorna ora JSON ora texto vazio. Tenta parse mas mantém texto.
  let dados: unknown;
  try { dados = texto ? JSON.parse(texto) : null; }
  catch { dados = texto; }
  return { status: resp.status, dados };
}

async function tratarRpc(nome: string, payload: unknown, jwt?: string) {
  if (!RPCS_PERMITIDAS.has(nome)) {
    return jsonResposta({ erro: `RPC '${nome}' não está na whitelist` }, 403);
  }
  const r = await chamarPostgrest(`/rest/v1/rpc/${nome}`, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
    jwt,
  });
  return jsonResposta(r.dados, r.status);
}

async function tratarAuth(acao: string, payload: any, jwt?: string) {
  if (!AUTH_PERMITIDAS.has(acao)) {
    return jsonResposta({ erro: `auth:${acao} não permitido` }, 403);
  }

  // admin_criar é especial: usa service_key e exige que quem chama seja admin.
  if (acao === "admin_criar") {
    return await tratarAdminCriar(payload, jwt);
  }
  // admin_deletar: idem (service_key + valida admin chamador).
  if (acao === "admin_deletar") {
    return await tratarAdminDeletar(payload, jwt);
  }
  // recuperar_senha: gera link admin + envia via Gmail SMTP (template DataCold).
  if (acao === "recuperar_senha") {
    return await tratarRecuperarSenha(payload);
  }

  const mapa: Record<string, { metodo: string; path: string; precisaJwt?: boolean }> = {
    signin:    { metodo: "POST", path: "/auth/v1/token?grant_type=password" },
    signup:    { metodo: "POST", path: "/auth/v1/signup" },
    signout:   { metodo: "POST", path: "/auth/v1/logout",       precisaJwt: true },
    recover:   { metodo: "POST", path: "/auth/v1/recover" },
    user:      { metodo: "GET",  path: "/auth/v1/user",         precisaJwt: true },
    atualizar: { metodo: "PUT",  path: "/auth/v1/user",         precisaJwt: true },
    refresh:   { metodo: "POST", path: "/auth/v1/token?grant_type=refresh_token" },
  };
  const cfg = mapa[acao];
  if (cfg.precisaJwt && !jwt) {
    return jsonResposta({ erro: "JWT obrigatório pra essa ação" }, 401);
  }

  const r = await chamarPostgrest(cfg.path, {
    method: cfg.metodo,
    body: ["POST", "PUT"].includes(cfg.metodo) ? JSON.stringify(payload ?? {}) : undefined,
    jwt,
  });
  return jsonResposta(r.dados, r.status);
}

// ===========================================================================
//  Email transacional via Resend
// ===========================================================================

/**
 * Template HTML do convite. CSS 100% inline + table layout pra rodar em
 * Gmail, Outlook (desktop e web), Apple Mail, iOS Mail.
 *
 * Cores sólidas em `bgcolor` como fallback pro Outlook (que ignora
 * background:linear-gradient). Sem <style> tag — Outlook removeria.
 */
function montarHtmlConvite(link: string, email: string, siteUrl: string): string {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Bem-vindo à DataCold</title></head>
<body style="margin:0;padding:0;background:#E6F6FF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0B1D3A;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#E6F6FF" style="background:#E6F6FF;padding:40px 20px;"><tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" bgcolor="#FFFFFF" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:18px;box-shadow:0 12px 36px rgba(11,29,58,0.10);overflow:hidden;">
      <!-- Header (gradient + fallback sólido) -->
      <tr><td bgcolor="#123B7A" style="background:#123B7A;background:linear-gradient(135deg,#0B1D3A 0%,#123B7A 45%,#1E6FD6 100%);padding:36px 40px;text-align:left;">
        <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#8EDBFF;font-weight:700;margin-bottom:8px;">DataCold &middot; plataforma</div>
        <h1 style="margin:0;font-size:26px;line-height:1.2;color:#FFFFFF;font-weight:800;letter-spacing:-0.01em;">Você foi convidado<br>para a DataCold.</h1>
      </td></tr>
      <!-- Corpo -->
      <tr><td style="padding:36px 40px 24px 40px;font-size:15px;line-height:1.65;color:#0B1D3A;">
        <p style="margin:0 0 16px;">Olá,</p>
        <p style="margin:0 0 16px;">Um administrador criou uma conta na <strong style="color:#123B7A;">DataCold</strong> para você (<a href="mailto:${escHtml(email)}" style="color:#1E6FD6;text-decoration:none;">${escHtml(email)}</a>). A DataCold é uma plataforma de telemetria industrial em tempo real — energia, temperatura e portas, monitorados a cada segundo, com inteligência automática que detecta anomalias.</p>
        <p style="margin:0 0 28px;">Para finalizar o cadastro, defina o seu nome e crie uma senha. <strong>Só você terá acesso à sua senha</strong> — nem mesmo o administrador que enviou o convite vai vê-la.</p>
        <!-- Botão CTA (gradient + fallback sólido) -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 28px;"><tr>
          <td bgcolor="#1E6FD6" style="background:#1E6FD6;background:linear-gradient(135deg,#1E6FD6 0%,#00B8F0 100%);border-radius:12px;">
            <a href="${escHtml(link)}" style="display:inline-block;padding:16px 36px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.01em;">Definir meu acesso &rarr;</a>
          </td>
        </tr></table>
        <!-- Requisitos da senha -->
        <div style="background:#F4F8FF;border:1px solid #DDE4EF;border-radius:10px;padding:18px 20px;margin:0 0 24px;">
          <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5b6b86;font-weight:700;margin-bottom:10px;">Requisitos da senha</div>
          <ul style="margin:0;padding:0 0 0 18px;font-size:13px;line-height:1.65;color:#0B1D3A;">
            <li>Mínimo de <strong>8 caracteres</strong></li>
            <li>Pelo menos 1 letra <strong>maiúscula</strong> e 1 <strong>minúscula</strong></li>
            <li>Pelo menos 1 <strong>número</strong></li>
            <li>Pelo menos 1 <strong>caractere especial</strong> (ex: ! @ # $)</li>
            <li>Sem espaços</li>
          </ul>
        </div>
        <p style="margin:0 0 8px;font-size:13px;color:#5b6b86;">Se o botão não funcionar, copie e cole o link no navegador:</p>
        <p style="margin:0 0 24px;font-size:12px;color:#1E6FD6;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#F4F8FF;padding:10px 14px;border-radius:8px;border:1px solid #DDE4EF;">${escHtml(link)}</p>
        <p style="margin:0;font-size:12.5px;color:#5b6b86;line-height:1.55;">Este link expira em algumas horas por segurança. Se ele não funcionar, peça ao administrador para enviar um novo convite. Se você não esperava receber este e-mail, pode ignorá-lo — nenhuma conta será criada sem você definir a senha.</p>
      </td></tr>
      <!-- Rodapé -->
      <tr><td bgcolor="#F4F8FF" style="background:#F4F8FF;padding:20px 40px;border-top:1px solid #DDE4EF;text-align:center;font-size:11.5px;color:#5b6b86;line-height:1.6;">
        <strong style="color:#0B1D3A;">DataCold</strong> &middot; Monitoramento inteligente de sensores industriais<br>
        <a href="${escHtml(siteUrl)}" style="color:#1E6FD6;text-decoration:none;">${escHtml(siteUrl)}</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

/** Versão texto-puro do convite (fallback pra clientes que não renderizam HTML). */
function montarTextoConvite(link: string, email: string, siteUrl: string): string {
  return [
    "Bem-vindo à DataCold",
    "",
    `Um administrador criou uma conta para você (${email}).`,
    "Para finalizar o cadastro, defina o seu nome e crie uma senha forte.",
    "Só você terá acesso à sua senha — nem o administrador vai vê-la.",
    "",
    "Acesse o link abaixo:",
    link,
    "",
    "Requisitos da senha:",
    "  - Mínimo de 8 caracteres",
    "  - Pelo menos 1 letra maiúscula e 1 minúscula",
    "  - Pelo menos 1 número",
    "  - Pelo menos 1 caractere especial (ex: ! @ # $)",
    "  - Sem espaços",
    "",
    "Este link expira em algumas horas. Se não funcionar, peça um novo convite.",
    "",
    `DataCold · ${siteUrl}`,
  ].join("\n");
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Envia email via SMTP do Gmail (preferência) OU Resend (fallback).
 *
 * Gmail SMTP via denomailer:
 *   - Host: smtp.gmail.com:465 (SSL)
 *   - Auth: GMAIL_USER + GMAIL_APP_PASSWORD (App Password, não senha real)
 *   - Limite: 500 emails/dia (free)
 *   - Funciona pra QUALQUER destinatário, sem domínio verificado
 */
async function enviarEmail(opts: { to: string; subject: string; html: string; text: string }): Promise<{ ok: boolean; erro?: string; via?: string }> {
  // 1) Tenta Gmail SMTP
  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    try {
      const client = new SMTPClient({
        connection: {
          hostname: "smtp.gmail.com",
          port: 465,
          tls: true,
          auth: {
            username: GMAIL_USER,
            password: GMAIL_APP_PASSWORD.replace(/\s+/g, ""),
          },
        },
      });
      await client.send({
        from: `${GMAIL_FROM_NAME} <${GMAIL_USER}>`,
        to: opts.to,
        subject: opts.subject,
        content: opts.text,
        html: opts.html,
      });
      await client.close();
      return { ok: true, via: "gmail" };
    } catch (e) {
      // Cai pro fallback Resend se também estiver configurado
      const erroGmail = String((e as Error).message ?? e);
      if (!RESEND_API_KEY) {
        return { ok: false, erro: `Gmail SMTP falhou: ${erroGmail}`, via: "gmail" };
      }
      console.error("Gmail SMTP falhou, tentando Resend:", erroGmail);
    }
  }

  // 2) Fallback Resend
  if (!RESEND_API_KEY) {
    return { ok: false, erro: "Nem GMAIL_* nem RESEND_API_KEY configurados" };
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return { ok: false, erro: `Resend HTTP ${r.status}: ${t.slice(0, 200)}`, via: "resend" };
    }
    return { ok: true, via: "resend" };
  } catch (e) {
    return { ok: false, erro: String((e as Error).message), via: "resend" };
  }
}

/**
 * Template HTML do email de redefinição de senha (botão "Esqueci a senha").
 * Estilo idêntico ao convite — só muda título e copy.
 */
function montarHtmlRecuperacao(link: string, email: string, siteUrl: string): string {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Redefinir sua senha — DataCold</title></head>
<body style="margin:0;padding:0;background:#E6F6FF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0B1D3A;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#E6F6FF" style="background:#E6F6FF;padding:40px 20px;"><tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" bgcolor="#FFFFFF" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:18px;box-shadow:0 12px 36px rgba(11,29,58,0.10);overflow:hidden;">
      <tr><td bgcolor="#123B7A" style="background:#123B7A;background:linear-gradient(135deg,#0B1D3A 0%,#123B7A 45%,#1E6FD6 100%);padding:36px 40px;text-align:left;">
        <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#8EDBFF;font-weight:700;margin-bottom:8px;">DataCold &middot; recuperação</div>
        <h1 style="margin:0;font-size:26px;line-height:1.2;color:#FFFFFF;font-weight:800;letter-spacing:-0.01em;">Redefinir sua senha</h1>
      </td></tr>
      <tr><td style="padding:36px 40px 24px 40px;font-size:15px;line-height:1.65;color:#0B1D3A;">
        <p style="margin:0 0 16px;">Olá,</p>
        <p style="margin:0 0 16px;">Recebemos uma solicitação para redefinir a senha da conta <strong>${escHtml(email)}</strong>. Clique no botão abaixo pra criar uma nova senha.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 28px;"><tr>
          <td bgcolor="#1E6FD6" style="background:#1E6FD6;background:linear-gradient(135deg,#1E6FD6 0%,#00B8F0 100%);border-radius:12px;">
            <a href="${escHtml(link)}" style="display:inline-block;padding:16px 36px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.01em;">Redefinir senha &rarr;</a>
          </td>
        </tr></table>
        <div style="background:#F4F8FF;border:1px solid #DDE4EF;border-radius:10px;padding:18px 20px;margin:0 0 24px;">
          <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5b6b86;font-weight:700;margin-bottom:10px;">Requisitos da nova senha</div>
          <ul style="margin:0;padding:0 0 0 18px;font-size:13px;line-height:1.65;color:#0B1D3A;">
            <li>Mínimo de <strong>8 caracteres</strong></li>
            <li>Pelo menos 1 letra <strong>maiúscula</strong> e 1 <strong>minúscula</strong></li>
            <li>Pelo menos 1 <strong>número</strong></li>
            <li>Pelo menos 1 <strong>caractere especial</strong> (ex: ! @ # $)</li>
            <li>Sem espaços</li>
          </ul>
        </div>
        <p style="margin:0 0 8px;font-size:13px;color:#5b6b86;">Se o botão não funcionar, copie e cole o link no navegador:</p>
        <p style="margin:0 0 24px;font-size:12px;color:#1E6FD6;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#F4F8FF;padding:10px 14px;border-radius:8px;border:1px solid #DDE4EF;">${escHtml(link)}</p>
        <p style="margin:0;font-size:12.5px;color:#5b6b86;line-height:1.55;">Este link expira em algumas horas. Se você <strong>não solicitou</strong> a redefinição, pode ignorar este e-mail com segurança — sua senha atual continua válida.</p>
      </td></tr>
      <tr><td bgcolor="#F4F8FF" style="background:#F4F8FF;padding:20px 40px;border-top:1px solid #DDE4EF;text-align:center;font-size:11.5px;color:#5b6b86;line-height:1.6;">
        <strong style="color:#0B1D3A;">DataCold</strong> &middot; Monitoramento inteligente de sensores industriais<br>
        <a href="${escHtml(siteUrl)}" style="color:#1E6FD6;text-decoration:none;">${escHtml(siteUrl)}</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function montarTextoRecuperacao(link: string, email: string, siteUrl: string): string {
  return [
    "Redefinir sua senha — DataCold",
    "",
    `Recebemos uma solicitação para redefinir a senha de ${email}.`,
    "Clique no link pra criar uma nova senha:",
    link,
    "",
    "Requisitos: mín 8 chars, 1 maiúscula, 1 minúscula, 1 número, 1 especial, sem espaços.",
    "",
    "Se você não solicitou, ignore este e-mail — sua senha atual continua válida.",
    "",
    `DataCold · ${siteUrl}`,
  ].join("\n");
}

/**
 * Recuperação de senha — chama admin/generate_link com type=recovery.
 *
 * Com Custom SMTP configurado no Supabase (smtp.gmail.com via Gmail),
 * o próprio Supabase ENVIA o email automaticamente usando o template
 * `mailer_templates_recovery_content` configurado via
 * supabase/email-templates/aplicar.py.
 *
 * Sempre devolve sucesso (não vaza se o email existe ou não).
 */
async function tratarRecuperarSenha(payload: any) {
  if (!SB_SERVICE_KEY) return jsonResposta({ erro: "Servidor sem SB_SERVICE_KEY" }, 500);

  const email = String(payload?.email ?? "").trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return jsonResposta({ erro: "email inválido" }, 400);
  }

  const redirectTo = String(payload?.redirect_to ?? "https://datacold.web.app/paginas/conta/redefinir/");

  // generate_link dispara o email automaticamente via Custom SMTP do Supabase.
  // Não precisamos chamar enviarEmail aqui — duplicaria o envio.
  await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      "apikey": SB_SERVICE_KEY,
      "Authorization": `Bearer ${SB_SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: "recovery",
      email,
      options: { redirect_to: redirectTo },
    }),
  }).catch(() => null);

  return jsonResposta({ ok: true }, 200);
}

/**
 * Cria usuário via endpoint admin (sem rate-limit do /signup anônimo) e
 * já dispara o email de definir senha via Resend (sem rate-limit SMTP).
 * Quem chama precisa ter JWT de admin — validamos consultando
 * perfis_usuarios via PostgREST com o JWT do usuário.
 */
async function tratarAdminCriar(payload: any, jwt?: string) {
  if (!jwt) return jsonResposta({ erro: "JWT obrigatório" }, 401);
  if (!SB_SERVICE_KEY) return jsonResposta({ erro: "Servidor sem SB_SERVICE_KEY configurada" }, 500);

  // 1) Quem chama tem que ser admin (consulta perfis_usuarios com JWT do
  //    chamador — RLS garante que só admin veria a coluna `papel` de outros,
  //    mas o próprio user sempre vê o próprio).
  const eu = await chamarPostgrest("/auth/v1/user", { method: "GET", jwt });
  const uid = (eu.dados as any)?.id;
  if (!uid) return jsonResposta({ erro: "Sessão inválida" }, 401);

  const meuPerfil = await chamarPostgrest(
    `/rest/v1/perfis_usuarios?id=eq.${encodeURIComponent(uid)}&select=papel`,
    { method: "GET", jwt },
  );
  const papel = (meuPerfil.dados as any[])?.[0]?.papel;
  if (papel !== "admin") {
    return jsonResposta({ erro: "Somente admin pode criar contas" }, 403);
  }

  // 2) Valida payload mínimo
  const email = String(payload?.email ?? "").trim().toLowerCase();
  const papelNovo = String(payload?.papel ?? "operador");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return jsonResposta({ erro: "email inválido" }, 400);
  }
  if (!["admin", "operador"].includes(papelNovo)) {
    return jsonResposta({ erro: "papel inválido" }, 400);
  }

  // 3) Gera senha aleatória descartável + cria via admin
  const buf = new Uint8Array(48);
  crypto.getRandomValues(buf);
  const senhaTemp = Array.from(buf, (b) =>
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$"[b % 68]
  ).join("");

  const criar = await fetch(`${SB_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "apikey": SB_SERVICE_KEY,
      "Authorization": `Bearer ${SB_SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email,
      password: senhaTemp,
      email_confirm: true,
      user_metadata: { papel: papelNovo, nome: email.split("@")[0] },
    }),
  });
  const txtCriar = await criar.text();
  let criado: any = null;
  let usuarioJaExistia = false;

  if (!criar.ok) {
    if (/already (registered|exists)|email_exists|duplicate/i.test(txtCriar)) {
      // Email já cadastrado — vamos REENVIAR o convite (gera novo link).
      // Útil quando o admin clica "convidar" 2x ou o link anterior expirou.
      usuarioJaExistia = true;
      // Busca o usuário pra pegar o id
      const buscar = await fetch(
        `${SB_URL}/auth/v1/admin/users?per_page=200`,
        { headers: { "apikey": SB_SERVICE_KEY, "Authorization": `Bearer ${SB_SERVICE_KEY}` } },
      );
      if (buscar.ok) {
        const lista = await buscar.json();
        criado = (lista?.users || []).find((u: any) => u.email?.toLowerCase() === email);
      }
      if (!criado) {
        return jsonResposta({ erro: "Email já cadastrado mas não foi possível recuperar o registro." }, 500);
      }
    } else {
      return jsonResposta({ erro: "Falha ao criar usuário", detalhe: txtCriar }, criar.status);
    }
  } else {
    criado = JSON.parse(txtCriar);
  }

  // 4) Dispara o email via generate_link. Com Custom SMTP ativo, o
  //    Supabase envia automaticamente usando o template
  //    `mailer_templates_invite_content` (pra usuário NOVO) ou
  //    `mailer_templates_recovery_content` (pra reenvio).
  //    Não chamamos enviarEmail() — duplicaria o envio.
  const redirectTo = String(payload?.redirect_to ?? "https://datacold.web.app/paginas/conta/definir/");
  // Reenvio usa "recovery" porque o user já está confirmado; novo usa "invite".
  const linkType = usuarioJaExistia ? "recovery" : "invite";

  const linkResp = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      "apikey": SB_SERVICE_KEY,
      "Authorization": `Bearer ${SB_SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: linkType,
      email,
      options: { redirect_to: redirectTo },
    }),
  });

  const convite_enviado = linkResp.ok;
  let erro_envio: string | undefined;
  if (!linkResp.ok) {
    const t = await linkResp.text().catch(() => "");
    erro_envio = `generate_link HTTP ${linkResp.status}: ${t.slice(0, 200)}`;
  }

  return jsonResposta({
    ok: true,
    email,
    papel: papelNovo,
    id: criado?.id,
    convite_enviado,
    tipo_link: linkType,
    erro_envio,
    reenvio: usuarioJaExistia,
  }, 200);
}

/**
 * Deleta usuário do auth.users (cascade leva perfil + acessos + notificações).
 * Quem chama precisa ser admin (valida com JWT) e o alvo não pode ser ele mesmo.
 */
async function tratarAdminDeletar(payload: any, jwt?: string) {
  if (!jwt) return jsonResposta({ erro: "JWT obrigatório" }, 401);
  if (!SB_SERVICE_KEY) return jsonResposta({ erro: "Servidor sem SB_SERVICE_KEY configurada" }, 500);

  // 1) Quem chama é admin?
  const eu = await chamarPostgrest("/auth/v1/user", { method: "GET", jwt });
  const uid = (eu.dados as any)?.id;
  if (!uid) return jsonResposta({ erro: "Sessão inválida" }, 401);

  const meuPerfil = await chamarPostgrest(
    `/rest/v1/perfis_usuarios?id=eq.${encodeURIComponent(uid)}&select=papel`,
    { method: "GET", jwt },
  );
  const papel = (meuPerfil.dados as any[])?.[0]?.papel;
  if (papel !== "admin") {
    return jsonResposta({ erro: "Somente admin pode deletar contas" }, 403);
  }

  // 2) Valida alvo
  const id = String(payload?.id ?? "").trim();
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return jsonResposta({ erro: "id (uuid) obrigatório" }, 400);
  }
  if (id === uid) {
    return jsonResposta({ erro: "Você não pode deletar a si mesmo" }, 403);
  }

  // 3) Deleta via admin API (cascade leva perfis_usuarios, acessos,
  //    notificacoes_usuario etc. via FK ON DELETE CASCADE).
  const r = await fetch(`${SB_URL}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      "apikey": SB_SERVICE_KEY,
      "Authorization": `Bearer ${SB_SERVICE_KEY}`,
    },
  });
  if (!r.ok) {
    const t = await r.text();
    return jsonResposta({ erro: `Falha ao deletar: ${t.slice(0, 200)}` }, r.status);
  }
  return jsonResposta({ ok: true, id }, 200);
}

async function tratarPerfilBuscar(payload: any, jwt?: string) {
  if (!jwt) return jsonResposta({ erro: "JWT obrigatório" }, 401);
  const id = String(payload?.id ?? "").trim();
  if (!id) return jsonResposta({ erro: "id obrigatório" }, 400);
  const r = await chamarPostgrest(
    `/rest/v1/perfis_usuarios?id=eq.${encodeURIComponent(id)}&select=*`,
    { method: "GET", jwt }
  );
  return jsonResposta(r.dados, r.status);
}

Deno.serve(async (req) => {
  const origem = req.headers.get("origin");
  const headersCors = cors(origem);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: headersCors });
  }
  if (req.method !== "POST") {
    return jsonResposta({ erro: "Use POST" }, 405, headersCors);
  }

  let corpo: any;
  try { corpo = await req.json(); }
  catch { return jsonResposta({ erro: "Body deve ser JSON" }, 400, headersCors); }

  const { acao, payload, jwt } = corpo ?? {};
  if (typeof acao !== "string") {
    return jsonResposta({ erro: "Falta 'acao'" }, 400, headersCors);
  }

  try {
    let resp: Response;
    if (acao.startsWith("rpc:")) {
      resp = await tratarRpc(acao.slice(4), payload, jwt);
    } else if (acao.startsWith("auth:")) {
      resp = await tratarAuth(acao.slice(5), payload, jwt);
    } else if (acao === "perfil:buscar") {
      resp = await tratarPerfilBuscar(payload, jwt);
    } else {
      return jsonResposta({ erro: `acao desconhecida: ${acao}` }, 404, headersCors);
    }

    // Junta os headers CORS no response final.
    const final = new Headers(resp.headers);
    for (const [k, v] of Object.entries(headersCors)) final.set(k, v);
    return new Response(resp.body, { status: resp.status, headers: final });
  } catch (e) {
    return jsonResposta(
      { erro: "Erro interno no proxy", detalhe: String((e as Error).message) },
      500,
      headersCors
    );
  }
});
