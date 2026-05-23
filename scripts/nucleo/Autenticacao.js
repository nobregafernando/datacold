/**
 * Autenticação real via Supabase Auth (sem dependências externas).
 *
 * Endpoints REST usados:
 *   POST  /auth/v1/signup                    cria usuário (admin only no UX)
 *   POST  /auth/v1/token?grant_type=password login com email+senha
 *   POST  /auth/v1/token?grant_type=refresh_token  renova access_token
 *   POST  /auth/v1/logout                    invalida tokens no servidor
 *   POST  /auth/v1/recover                   envia link de redefinição
 *   PUT   /auth/v1/user                      atualiza dados (incl. senha)
 *
 * Sessão é guardada em localStorage como JSON:
 *   { access_token, refresh_token, expires_at, perfil: { id, nome, email, papel } }
 *
 * Renovação automática: se `access_token` expirou e há `refresh_token`,
 * tenta renovar transparentemente antes de qualquer chamada autenticada.
 *
 * Sessão MVP (botão "Entrar como Fernando" no login) entra em paralelo
 * sem JWT — apenas marca o perfil em localStorage. Útil enquanto o
 * usuário ainda não criou a conta real. Quando trocamos pra sessão
 * real, o MVP é sobrescrito.
 */
class Autenticacao {

  static CHAVE = "datacold_sessao";

  /** URL do Supabase — vem do ApiBEM pra não duplicar. */
  static get _urlBase() { return ApiBEM.URL_SUPABASE; }
  static get _anon()    { return ApiBEM.CHAVE_SUPABASE_ANON; }

  /** Sessão MVP (fallback para demos). */
  static USUARIO_MVP = {
    id:    null,
    nome:  "Fernando Nóbrega Alves",
    email: "fernandonobregaalves@gmail.com",
    papel: "admin",
    _mvp: true,
  };

  // ===================================================================
  //  Sessão local
  // ===================================================================

  static _lerSessao() {
    try {
      const cru = localStorage.getItem(Autenticacao.CHAVE);
      return cru ? JSON.parse(cru) : null;
    } catch { return null; }
  }
  static _gravarSessao(s) {
    localStorage.setItem(Autenticacao.CHAVE, JSON.stringify(s));
  }
  static _limparSessao() {
    localStorage.removeItem(Autenticacao.CHAVE);
  }

  /** Devolve o Usuario logado, ou null. */
  static usuarioAtual() {
    const s = Autenticacao._lerSessao();
    if (!s) return null;
    // MVP ou sessão real: ambos têm `perfil` no formato Usuario
    const perfil = s.perfil || s;     // compat com sessão antiga (sem `perfil`)
    return Usuario.deserializar(perfil);
  }

  static autenticado() {
    return Autenticacao.usuarioAtual() !== null;
  }

  /**
   * Garante que existe sessão válida. Se não existir, redireciona.
   * Se exigir papel acima do que o usuário tem, redireciona pro dashboard.
   *
   * @param {string} urlLogin    caminho relativo pro login
   * @param {string} papelMin    "operador" (default) ou "admin"
   * @param {string} urlSemPapel pra onde mandar se o papel for insuficiente
   */
  static protegerPagina(urlLogin = "../login/", papelMin = "operador", urlSemPapel = null) {
    const u = Autenticacao.usuarioAtual();
    if (!u) {
      window.location.replace(urlLogin);
      return false;
    }
    if (papelMin === "admin" && !u.ehAdmin) {
      window.location.replace(urlSemPapel || "/paginas/admin/");
      return false;
    }
    return true;
  }

  // ===================================================================
  //  MVP (atalho enquanto não tem conta real)
  // ===================================================================

  static loginMvp() {
    Autenticacao._gravarSessao({ perfil: Autenticacao.USUARIO_MVP });
    return Usuario.deserializar(Autenticacao.USUARIO_MVP);
  }

  // ===================================================================
  //  HTTP helpers
  // ===================================================================

  /** Chama um endpoint do Auth (não usa token). */
  static async _auth(path, body, metodo = "POST") {
    const r = await fetch(`${Autenticacao._urlBase}/auth/v1${path}`, {
      method: metodo,
      headers: {
        "Content-Type": "application/json",
        "apikey": Autenticacao._anon,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await r.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch {}
    if (!r.ok) {
      const msg = data?.msg || data?.error_description || data?.error || `Erro ${r.status}`;
      throw new Error(msg);
    }
    return data;
  }

  /** Chama um endpoint autenticado (envia Bearer). Renova token se preciso. */
  static async _autenticado(path, body, metodo = "GET") {
    let s = Autenticacao._lerSessao();
    if (!s?.access_token) throw new Error("Sessão expirada — entre novamente.");
    if (Autenticacao._tokenExpirado(s)) {
      s = await Autenticacao._renovarToken(s);
    }
    const r = await fetch(`${Autenticacao._urlBase}${path}`, {
      method: metodo,
      headers: {
        "Content-Type": "application/json",
        "apikey": Autenticacao._anon,
        "Authorization": `Bearer ${s.access_token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await r.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch {}
    if (!r.ok) {
      const msg = data?.message || data?.msg || data?.error_description || `Erro ${r.status}`;
      throw new Error(msg);
    }
    return data;
  }

  static _tokenExpirado(s) {
    if (!s?.expires_at) return false;
    // 30s de margem pra evitar uso de token quase-expirado
    return Date.now() / 1000 > (s.expires_at - 30);
  }

  static async _renovarToken(s) {
    if (!s.refresh_token) {
      Autenticacao._limparSessao();
      throw new Error("Sessão expirada — entre novamente.");
    }
    const novo = await Autenticacao._auth(
      "/token?grant_type=refresh_token",
      { refresh_token: s.refresh_token }
    );
    const sNovo = {
      access_token:  novo.access_token,
      refresh_token: novo.refresh_token,
      expires_at:    Math.floor(Date.now() / 1000) + (novo.expires_in || 3600),
      perfil:        s.perfil,
    };
    Autenticacao._gravarSessao(sNovo);
    return sNovo;
  }

  // ===================================================================
  //  Login / Logout
  // ===================================================================

  /**
   * Autentica com email + senha. Em sucesso, grava sessão e devolve
   * o Usuario com papel já consultado de `perfis_usuarios`.
   */
  static async loginEmail(email, senha) {
    const e = Sanitizar.email(email);
    if (!e) throw new Error("E-mail inválido.");
    if (!senha || typeof senha !== "string") throw new Error("Senha obrigatória.");

    const tok = await Autenticacao._auth(
      "/token?grant_type=password",
      { email: e, password: senha }
    );

    const sessao = {
      access_token:  tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at:    Math.floor(Date.now() / 1000) + (tok.expires_in || 3600),
      perfil:        null,
    };
    Autenticacao._gravarSessao(sessao);

    const perfil = await Autenticacao._buscarPerfil(tok.user?.id, tok.access_token);
    perfil.email = tok.user?.email || e;
    sessao.perfil = perfil.serializar();
    Autenticacao._gravarSessao(sessao);
    return perfil;
  }

  /** Cria nova conta. Só admin pode chamar (a UI esconde a página). */
  static async criarUsuario({ nome, email, senha, papel = "operador" }) {
    const eNome  = Sanitizar.nome(nome);
    const eEmail = Sanitizar.email(email);
    const vSenha = ValidadorSenha.validar(senha);
    if (!eNome)        throw new Error("Nome inválido.");
    if (!eEmail)       throw new Error("E-mail inválido.");
    if (!vSenha.ok)    throw new Error("Senha fraca: " + vSenha.motivos.join("; ") + ".");
    if (!["admin","operador"].includes(papel)) throw new Error("Papel inválido.");

    // Quem chama (admin) tem que estar logado pra que o trigger respeite o papel
    const eu = Autenticacao.usuarioAtual();
    if (!eu?.ehAdmin) throw new Error("Apenas administradores podem criar contas.");

    return await Autenticacao._auth(
      "/signup",
      {
        email: eEmail,
        password: senha,
        // O trigger `fn_criar_perfil_padrao` lê esses metadados pra setar
        // nome e papel sem precisar de UPDATE adicional.
        data: { nome: eNome, papel },
      }
    );
  }

  /**
   * Solicita link de redefinição de senha. Sempre devolve sucesso
   * (não vazamos se o email existe ou não).
   */
  static async pedirRecuperacao(email) {
    const e = Sanitizar.email(email);
    if (!e) throw new Error("E-mail inválido.");
    try {
      await Autenticacao._auth("/recover", { email: e });
    } catch {
      // Mesmo em erro, devolvemos sucesso — evita enumeration attack.
    }
    return true;
  }

  /**
   * Redefine a senha. Precisa de um access_token (vindo do hash do
   * link de recovery na URL `#access_token=...&type=recovery`).
   */
  static async redefinirSenha(accessTokenRecovery, novaSenha) {
    const vSenha = ValidadorSenha.validar(novaSenha);
    if (!vSenha.ok) throw new Error("Senha fraca: " + vSenha.motivos.join("; ") + ".");

    const r = await fetch(`${Autenticacao._urlBase}/auth/v1/user`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "apikey": Autenticacao._anon,
        "Authorization": `Bearer ${accessTokenRecovery}`,
      },
      body: JSON.stringify({ password: novaSenha }),
    });
    if (!r.ok) {
      const t = await r.text();
      let m = "Não foi possível redefinir a senha.";
      try { const d = JSON.parse(t); m = d.msg || d.error_description || m; } catch {}
      throw new Error(m);
    }
    return true;
  }

  /** Encerra sessão: chama logout do servidor (best-effort) + limpa local. */
  static async logout() {
    const s = Autenticacao._lerSessao();
    if (s?.access_token) {
      try {
        await fetch(`${Autenticacao._urlBase}/auth/v1/logout`, {
          method: "POST",
          headers: {
            "apikey": Autenticacao._anon,
            "Authorization": `Bearer ${s.access_token}`,
          },
        });
      } catch { /* offline: tudo bem, sessão local já vai cair */ }
    }
    Autenticacao._limparSessao();
  }

  // ===================================================================
  //  Perfil (Supabase PostgREST · tabela perfis_usuarios)
  // ===================================================================

  /**
   * Busca o perfil do usuário em `perfis_usuarios`. Se não existir
   * (trigger falhou por algum motivo), cria um operador padrão.
   */
  static async _buscarPerfil(userId, accessToken) {
    const url = `${Autenticacao._urlBase}/rest/v1/perfis_usuarios?select=id,nome,papel&id=eq.${encodeURIComponent(userId)}&limit=1`;
    const r = await fetch(url, {
      headers: {
        "apikey": Autenticacao._anon,
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    });
    if (!r.ok) throw new Error("Falha ao carregar perfil do usuário.");
    const lista = await r.json();
    const row = lista?.[0];
    if (!row) {
      // Fallback: trigger pode ter falhado. Devolve operador anônimo.
      return new Usuario({ id: userId, nome: "Usuário", email: "", papel: "operador" });
    }
    // E-mail é só pra exibição — pegamos da resposta de login (não está na tabela).
    return new Usuario({ id: row.id, nome: row.nome, email: "", papel: row.papel });
  }
}

if (typeof window !== "undefined") window.Autenticacao = Autenticacao;
