/**
 * Autenticação via Supabase Auth, mas TODO o tráfego passa pela
 * Edge Function `proxy` (server-side). Zero chaves do Supabase ficam
 * no JavaScript do navegador.
 *
 * Ações que o proxy aceita (ver supabase/functions/proxy/index.ts):
 *   auth:signin     POST /auth/v1/token?grant_type=password
 *   auth:signup     POST /auth/v1/signup
 *   auth:signout    POST /auth/v1/logout                 (precisa JWT)
 *   auth:recover    POST /auth/v1/recover
 *   auth:user       GET  /auth/v1/user                   (precisa JWT)
 *   auth:atualizar  PUT  /auth/v1/user                   (precisa JWT)
 *   auth:refresh    POST /auth/v1/token?grant_type=refresh_token
 *   perfil:buscar   GET  /rest/v1/perfis_usuarios?id=eq.X
 *
 * Sessão local (localStorage):
 *   { access_token, refresh_token, expires_at, perfil: { id, nome, email, papel } }
 *
 * Também espelhamos o `access_token` em `datacold_jwt` (chave usada pelo
 * ApiBEM) pra que toda chamada RPC chegue ao proxy com `jwt` do usuário.
 */
class Autenticacao {

  static CHAVE = "datacold_sessao";
  static JWT_STORAGE = "datacold_jwt";   // espelha access_token pro ApiBEM

  /** Sessão MVP — usuário visitante anônimo (sem dados pessoais). */
  static USUARIO_MVP = {
    id:    null,
    nome:  "Visitante",
    email: "",
    papel: "operador",
    _mvp:  true,
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
    if (s?.access_token) {
      localStorage.setItem(Autenticacao.JWT_STORAGE, s.access_token);
    } else {
      localStorage.removeItem(Autenticacao.JWT_STORAGE);
    }
  }
  static _limparSessao() {
    localStorage.removeItem(Autenticacao.CHAVE);
    localStorage.removeItem(Autenticacao.JWT_STORAGE);
  }

  /** Devolve o Usuario logado, ou null. */
  static usuarioAtual() {
    const s = Autenticacao._lerSessao();
    if (!s) return null;
    const perfil = s.perfil || s;
    return Usuario.deserializar(perfil);
  }

  static autenticado() {
    return Autenticacao.usuarioAtual() !== null;
  }

  /**
   * Garante que existe sessão válida. Se não existir, redireciona.
   * Se exigir papel acima do que o usuário tem, redireciona pro dashboard.
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
  //  Proxy helper (todo tráfego passa por aqui)
  // ===================================================================

  /**
   * Chama uma ação no proxy. Se a ação exige JWT do usuário, passa o
   * token explicitamente (ou usa o da sessão atual se nada for passado).
   */
  static async _proxy(acao, payload = {}, jwt = null) {
    const proxyUrl = (typeof ApiBEM !== "undefined" && ApiBEM.PROXY_URL_PADRAO)
      ? (localStorage.getItem(ApiBEM.URL_STORAGE) || ApiBEM.PROXY_URL_PADRAO)
      : null;
    if (!proxyUrl) throw new Error("ApiBEM não carregada — proxy URL indefinida.");

    const corpo = { acao, payload };
    if (jwt) corpo.jwt = jwt;
    else {
      const s = Autenticacao._lerSessao();
      if (s?.access_token) corpo.jwt = s.access_token;
    }

    const r = await fetch(proxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const txt = await r.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch {}
    if (!r.ok) {
      const msg = data?.msg || data?.error_description || data?.error || data?.erro || `Erro ${r.status}`;
      throw new Error(msg);
    }
    return data;
  }

  static _tokenExpirado(s) {
    if (!s?.expires_at) return false;
    return Date.now() / 1000 > (s.expires_at - 30);
  }

  static async _renovarTokenSeNecessario() {
    let s = Autenticacao._lerSessao();
    if (!s?.access_token) return null;
    if (!Autenticacao._tokenExpirado(s)) return s;
    if (!s.refresh_token) {
      Autenticacao._limparSessao();
      return null;
    }
    try {
      const novo = await Autenticacao._proxy("auth:refresh", { refresh_token: s.refresh_token });
      const sNovo = {
        access_token:  novo.access_token,
        refresh_token: novo.refresh_token,
        expires_at:    Math.floor(Date.now() / 1000) + (novo.expires_in || 3600),
        perfil:        s.perfil,
      };
      Autenticacao._gravarSessao(sNovo);
      return sNovo;
    } catch {
      Autenticacao._limparSessao();
      return null;
    }
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

    const tok = await Autenticacao._proxy("auth:signin", { email: e, password: senha });

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

  /**
   * Admin convida operador via Edge Function. O proxy chama
   * /auth/v1/admin/users com service_key (sem cair no rate-limit do
   * /signup anônimo) e já dispara o email "definir senha". Admin
   * nunca vê a senha do operador.
   */
  static async convidarOperador({ email, papel = "operador" }) {
    const eEmail = Sanitizar.email(email);
    if (!eEmail) throw new Error("E-mail inválido.");
    if (!["admin","operador"].includes(papel)) throw new Error("Papel inválido.");

    const eu = Autenticacao.usuarioAtual();
    if (!eu?.ehAdmin) throw new Error("Apenas administradores podem convidar.");

    const redirectTo = `${location.origin}/paginas/conta/definir/`;
    const r = await Autenticacao._proxy("auth:admin_criar", {
      email: eEmail,
      papel,
      redirect_to: redirectTo,
    });

    return {
      email: r?.email || eEmail,
      papel: r?.papel || papel,
      convite_enviado: !!r?.convite_enviado,
    };
  }

  /**
   * Lista todos os perfis cadastrados (admin only — RLS bloqueia o
   * resto). Retorna array ordenado por papel (admin primeiro) e nome.
   */
  static async listarUsuarios() {
    return Autenticacao._autenticado(
      "/rest/v1/perfis_usuarios?select=id,nome,papel,criado_em,atualizado_em&order=papel.asc,nome.asc",
      null,
      "GET"
    );
  }

  /**
   * Operador completa o convite: recebe o access_token do hash do email,
   * define nome e senha próprios.
   */
  static async completarPerfil(accessToken, { nome, senha }) {
    const eNome = Sanitizar.nome(nome);
    if (!eNome) throw new Error("Nome inválido (use só letras, espaços, hífen ou apóstrofo).");
    const v = ValidadorSenha.validar(senha);
    if (!v.ok) throw new Error("Senha fraca: " + v.motivos.join("; ") + ".");
    if (!accessToken) throw new Error("Link de convite inválido ou expirado.");

    try {
      const dados = await Autenticacao._proxy(
        "auth:atualizar",
        { password: senha, data: { nome: eNome } },
        accessToken
      );
      return { email: dados?.email || null };
    } catch (e) {
      throw new Error(String(e.message || "Não foi possível salvar."));
    }
  }

  /** CSPRNG-based random password. Nunca exibida; usada só pro signup-stub do convite. */
  static _gerarSenhaAleatoria(n = 48) {
    const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*-_+=";
    const buf = new Uint8Array(n);
    crypto.getRandomValues(buf);
    let s = "";
    for (const b of buf) s += alfabeto[b % alfabeto.length];
    if (!/[A-Z]/.test(s)) s = "A" + s.slice(1);
    if (!/[a-z]/.test(s)) s = s.slice(0, 1) + "a" + s.slice(2);
    if (!/\d/.test(s))    s = s.slice(0, 2) + "9" + s.slice(3);
    if (!/[^A-Za-z0-9]/.test(s)) s = s.slice(0, 3) + "!" + s.slice(4);
    return s;
  }

  static async pedirRecuperacao(email) {
    const e = Sanitizar.email(email);
    if (!e) throw new Error("E-mail inválido.");
    try {
      await Autenticacao._proxy("auth:recover", { email: e });
    } catch {
      // Mesmo em erro, devolve sucesso — evita enumeration attack.
    }
    return true;
  }

  static async redefinirSenha(accessTokenRecovery, novaSenha) {
    const vSenha = ValidadorSenha.validar(novaSenha);
    if (!vSenha.ok) throw new Error("Senha fraca: " + vSenha.motivos.join("; ") + ".");

    try {
      await Autenticacao._proxy(
        "auth:atualizar",
        { password: novaSenha },
        accessTokenRecovery
      );
      return true;
    } catch (e) {
      throw new Error(String(e.message || "Não foi possível redefinir a senha."));
    }
  }

  static async logout() {
    const s = Autenticacao._lerSessao();
    if (s?.access_token) {
      try { await Autenticacao._proxy("auth:signout", {}, s.access_token); }
      catch { /* offline: ok */ }
    }
    Autenticacao._limparSessao();
  }

  // ===================================================================
  //  Perfil
  // ===================================================================

  static async _buscarPerfil(userId, accessToken) {
    try {
      const lista = await Autenticacao._proxy(
        "perfil:buscar",
        { id: userId },
        accessToken
      );
      const row = Array.isArray(lista) ? lista[0] : lista;
      if (!row) {
        return new Usuario({ id: userId, nome: "Usuário", email: "", papel: "operador" });
      }
      return new Usuario({ id: row.id, nome: row.nome, email: "", papel: row.papel });
    } catch {
      return new Usuario({ id: userId, nome: "Usuário", email: "", papel: "operador" });
    }
  }
}

if (typeof window !== "undefined") window.Autenticacao = Autenticacao;
