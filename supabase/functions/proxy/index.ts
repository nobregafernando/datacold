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
//    SB_URL              ex: https://fcverbceppwdbveustvq.supabase.co
//    SB_ANON_KEY         anon key pública do Supabase
//    SB_SERVICE_KEY      service_role key (usada SOMENTE em auth:admin_criar,
//                        que cria usuários sem cair no rate-limit do /signup
//                        anônimo). Nunca exposta ao cliente.
//    BEM_API_KEY         chave da BEM Inteligência (não usado hoje, reservado)
//
//  Deploy:
//    supabase functions deploy proxy --no-verify-jwt
// =============================================================================

const SB_URL         = Deno.env.get("SB_URL")          ?? "";
const SB_ANON_KEY    = Deno.env.get("SB_ANON_KEY")     ?? "";
const SB_SERVICE_KEY = Deno.env.get("SB_SERVICE_KEY")  ?? "";

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
]);

// Whitelist de ações de auth.
const AUTH_PERMITIDAS = new Set([
  "signin",      // POST /auth/v1/token?grant_type=password
  "signup",      // POST /auth/v1/signup  (rate-limited pelo Supabase — evite)
  "signout",     // POST /auth/v1/logout              (precisa JWT)
  "recover",     // POST /auth/v1/recover
  "user",        // GET  /auth/v1/user                (precisa JWT)
  "atualizar",   // PUT  /auth/v1/user                (precisa JWT — define senha/nome)
  "refresh",     // POST /auth/v1/token?grant_type=refresh_token
  "admin_criar", // POST /auth/v1/admin/users  (REQUER admin chamando, usa service_key)
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

/**
 * Cria usuário via endpoint admin (sem rate-limit do /signup anônimo) e
 * já dispara o email de definir senha. Quem chama precisa ter JWT de admin
 * — validamos consultando perfis_usuarios via PostgREST com o JWT do
 * usuário. Só então usamos a service_key.
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
  if (!criar.ok) {
    // Já existe? Retorna erro amigável
    if (/already (registered|exists)|duplicate/i.test(txtCriar)) {
      return jsonResposta({ erro: "Este e-mail já tem conta." }, 409);
    }
    return jsonResposta({ erro: "Falha ao criar usuário", detalhe: txtCriar }, criar.status);
  }
  const criado = JSON.parse(txtCriar);

  // 4) Dispara email de "definir senha" (recovery) com redirect pra /conta/definir/
  const redirectTo = String(payload?.redirect_to ?? "https://datacold.web.app/paginas/conta/definir/");
  const rec = await fetch(`${SB_URL}/auth/v1/recover`, {
    method: "POST",
    headers: {
      "apikey": SB_ANON_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, redirect_to: redirectTo }),
  });
  // Mesmo se /recover falhar (rate limit etc.), a conta foi criada — admin
  // pode reenviar o link via "esqueci minha senha".
  const recOk = rec.ok;

  return jsonResposta({
    ok: true,
    email,
    papel: papelNovo,
    id: criado?.id,
    convite_enviado: recOk,
  }, 200);
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
