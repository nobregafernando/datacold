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
//    SB_URL          ex: https://fcverbceppwdbveustvq.supabase.co
//    SB_ANON_KEY     anon key pública do Supabase
//    BEM_API_KEY     chave da BEM Inteligência (não usado hoje, reservado)
//
//  Deploy:
//    supabase functions deploy proxy --no-verify-jwt
// =============================================================================

const SB_URL      = Deno.env.get("SB_URL")      ?? "";
const SB_ANON_KEY = Deno.env.get("SB_ANON_KEY") ?? "";

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
  "signin",    // POST /auth/v1/token?grant_type=password
  "signup",    // POST /auth/v1/signup
  "signout",   // POST /auth/v1/logout              (precisa JWT)
  "recover",   // POST /auth/v1/recover
  "user",      // GET  /auth/v1/user                (precisa JWT)
  "atualizar", // PUT  /auth/v1/user                (precisa JWT — define senha/nome)
  "refresh",   // POST /auth/v1/token?grant_type=refresh_token
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
