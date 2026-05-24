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
  /**
   * Limpa TUDO relacionado à sessão. Síncrono e agressivo:
   *  - sessão e JWT espelhado (chaves datacold_sessao + datacold_jwt);
   *  - flags voláteis (notificações antigas, demos, chaves legadas);
   *  - sessionStorage com prefixos `cache:` ou `datacold_`;
   *  - cookies de auth do Supabase (sb-*) caso o navegador tenha setado.
   * Mantém preferências de UI inofensivas (menu fechado/aberto, build_id).
   */
  static _limparSessao() {
    try {
      localStorage.removeItem(Autenticacao.CHAVE);
      localStorage.removeItem(Autenticacao.JWT_STORAGE);

      // Flags voláteis e legados (não derrubam UI nem cache de build).
      [
        "datacold_notif_migracao_v2",
        "datacold_demo_notificacoes",
        "datacold_api_key",
        "datacold_api_url",
      ].forEach(k => localStorage.removeItem(k));

      // sessionStorage volátil
      try {
        Object.keys(sessionStorage).forEach(k => {
          if (k.startsWith("cache:") || k.startsWith("datacold_")) {
            sessionStorage.removeItem(k);
          }
        });
      } catch {}

      // Cookies do Supabase Auth (sb-*) — caso o navegador tenha guardado
      // além do localStorage. Expira no path raiz pra qualquer subdomínio.
      try {
        const dominios = ["", window.location.hostname];
        document.cookie.split(";").forEach(c => {
          const nome = c.split("=")[0].trim();
          if (nome.startsWith("sb-") || nome.startsWith("supabase")) {
            dominios.forEach(d => {
              const dom = d ? `;domain=${d}` : "";
              document.cookie = `${nome}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/${dom}`;
            });
          }
        });
      } catch {}
    } catch (e) {
      console.warn("limparSessao falhou parcialmente:", e);
    }
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
      cache: "no-store",
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

    // Pré-checagem ANTES de gastar signin no Supabase: a conta está ativa?
    // Função SECURITY DEFINER e idempotente (devolve true pra emails que
    // ainda não existem, deixando o erro real do signin tomar conta).
    try {
      const ativo = await Autenticacao._proxy(
        "rpc:checar_ativo_por_email", { p_email: e }
      );
      if (ativo === false) {
        throw new Error("Esta conta foi DESATIVADA por um administrador. Entre em contato com o admin pra reativar o acesso.");
      }
    } catch (errAtivo) {
      // Se já é a mensagem de inativo, propaga.
      if (/desativada/i.test(errAtivo.message)) throw errAtivo;
      // Outros erros (ex: RPC fora do ar) — segue o fluxo normal.
    }

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

    // Defense in depth: checa também pela coluna direta após signin,
    // caso o token de pré-checagem tenha sido tolerado.
    const perfilCompleto = await Autenticacao._proxy(
      "perfil:buscar", { id: tok.user?.id }, tok.access_token
    ).catch(() => null);
    const linha = Array.isArray(perfilCompleto) ? perfilCompleto[0] : perfilCompleto;
    if (linha && linha.ativo === false) {
      Autenticacao._limparSessao();
      try { await Autenticacao._proxy("auth:signout", {}, tok.access_token); } catch {}
      throw new Error("Esta conta foi DESATIVADA por um administrador. Entre em contato com o admin pra reativar o acesso.");
    }

    // Best-effort: registra o evento de acesso (não bloqueia o login)
    Autenticacao.registrarAcesso("login");

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
   * Lista todos os perfis cadastrados (admin only — RPC valida via
   * fn_eh_admin no Postgres). Retorna array ordenado por papel + nome.
   * Cada item: { id, nome, email, papel, ativo, criado_em, atualizado_em, ultimo_acesso }
   */
  static async listarUsuarios() {
    return Autenticacao._proxy("rpc:listar_usuarios", {});
  }

  /** Admin: desativa usuário (login será bloqueado). */
  static async desativarUsuario(id) {
    return Autenticacao._proxy("rpc:desativar_usuario", { p_id: id });
  }

  /** Admin: reativa usuário previamente desativado. */
  static async reativarUsuario(id) {
    return Autenticacao._proxy("rpc:reativar_usuario", { p_id: id });
  }

  /**
   * Admin: deleta a conta completa (auth.users + perfil + acessos via
   * CASCADE). Operação irreversível — UI deve confirmar.
   */
  static async deletarUsuario(id) {
    return Autenticacao._proxy("auth:admin_deletar", { id });
  }

  /**
   * Admin: dispara link de recuperação de senha pra qualquer usuário.
   * Busca o email pela RPC (admin only), depois chama auth:recover.
   */
  static async enviarRecuperacaoPara(id) {
    const email = await Autenticacao._proxy("rpc:obter_email_usuario", { p_id: id });
    if (!email) throw new Error("Email não encontrado.");
    const redirectTo = `${location.origin}/paginas/conta/redefinir/`;
    await Autenticacao._proxy("auth:recover", { email, redirect_to: redirectTo });
    return email;
  }

  /**
   * Registra um evento de acesso pro usuário atual (idempotente — sem
   * JWT vira no-op no banco). Chamado após cada login bem-sucedido.
   */
  static async registrarAcesso(origem = "login") {
    try {
      const ua = typeof navigator !== "undefined" ? (navigator.userAgent || "").slice(0, 500) : "";
      await Autenticacao._proxy("rpc:registrar_acesso", { p_ua: ua, p_origem: origem });
    } catch { /* falha em registrar não derruba o login */ }
  }

  /**
   * Histórico de acessos do próprio usuário (máx 100).
   * Retorna [{ id, criado_em, ip, user_agent, origem }].
   */
  static async listarMeusAcessos(limite = 20) {
    return Autenticacao._proxy("rpc:listar_meus_acessos", { p_limite: limite });
  }

  /**
   * Troca a senha do usuário logado. Verifica a senha atual fazendo
   * um signin (sem efeitos colaterais visíveis) e em seguida chama
   * auth:atualizar com a nova senha. Sessão é atualizada com o token
   * fresquinho emitido pelo signin.
   */
  static async alterarSenha(senhaAtual, novaSenha) {
    if (!senhaAtual) throw new Error("Informe a senha atual.");
    const eu = Autenticacao.usuarioAtual();
    if (!eu) throw new Error("Sessão expirada — entre novamente.");
    if (!eu.email) throw new Error("E-mail do usuário não encontrado na sessão.");

    const v = ValidadorSenha.validar(novaSenha);
    if (!v.ok) throw new Error("Senha fraca: " + v.motivos.join("; ") + ".");
    if (senhaAtual === novaSenha) throw new Error("A nova senha precisa ser diferente da atual.");

    // 1) Confirma a senha atual com um signin. Se errada, o proxy lança.
    let tok;
    try {
      tok = await Autenticacao._proxy("auth:signin", { email: eu.email, password: senhaAtual });
    } catch (err) {
      throw new Error("Senha atual incorreta.");
    }

    // Aproveita o token novo na sessão antes do PUT
    const sessaoNova = {
      access_token:  tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at:    Math.floor(Date.now() / 1000) + (tok.expires_in || 3600),
      perfil:        Autenticacao._lerSessao()?.perfil || null,
    };
    Autenticacao._gravarSessao(sessaoNova);

    // 2) Atualiza a senha
    await Autenticacao._proxy("auth:atualizar", { password: novaSenha }, tok.access_token);
    return { ok: true };
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

  /**
   * "Esqueci minha senha" — usa a Edge Function (admin generate_link +
   * Gmail SMTP + template DataCold) em vez de /auth/v1/recover, que
   * usaria o SMTP padrão do Supabase com o template antigo em inglês.
   * Resposta sempre sucesso (não vaza se o email existe ou não).
   */
  static async pedirRecuperacao(email) {
    const e = Sanitizar.email(email);
    if (!e) throw new Error("E-mail inválido.");
    try {
      await Autenticacao._proxy("auth:recuperar_senha", {
        email: e,
        redirect_to: `${location.origin}/paginas/conta/redefinir/`,
      });
    } catch {
      // Mesmo em erro, devolve sucesso pra não vazar quais e-mails têm conta.
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

  /**
   * Logout robusto:
   *  1) Limpa sessão local SÍNCRONO PRIMEIRO — garante que qualquer guard
   *     de auth nas próximas páginas (login.js linha 15) já veja deslogado.
   *  2) Best-effort: avisa o servidor pra revogar o refresh_token. Se a
   *     rede cair, paciência — o access_token expira em 1h e o refresh
   *     já foi descartado localmente.
   */
  static async logout() {
    const s = Autenticacao._lerSessao();
    // 1) síncrono e imediato — invalida qualquer detecção de sessão.
    Autenticacao._limparSessao();
    // 2) signout no servidor (best-effort).
    if (s?.access_token) {
      try { await Autenticacao._proxy("auth:signout", {}, s.access_token); }
      catch { /* offline: ok */ }
    }
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

  // ===================================================================
  //  Página de configurações: troca de senha + histórico
  // ===================================================================

  /**
   * Troca a senha do usuário atual. Confirma a senha atual com /auth/v1/token
   * (re-auth) antes de chamar PUT /auth/v1/user. Não passa pelo proxy porque
   * é uma chamada padrão do Supabase Auth com a anon + bearer JWT do usuário.
   */
  static async alterarSenha(senhaAtual, novaSenha) {
    if (!senhaAtual) throw new Error("Informe a senha atual.");
    if (!novaSenha || novaSenha.length < 8) throw new Error("Nova senha precisa ter pelo menos 8 caracteres.");

    let s = await Autenticacao._renovarTokenSeNecessario();
    if (!s?.access_token) throw new Error("Sessão expirada — faça login novamente.");

    const u = Autenticacao.usuarioAtual();
    const email = u?.email || s?.perfil?.email;
    if (!email) throw new Error("Usuário sem e-mail definido.");

    // 1) Re-auth: confirma que a senha atual está certa
    const r1 = await fetch(`${ApiBEM.URL_SUPABASE}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "content-type": "application/json", "apikey": ApiBEM.CHAVE_SUPABASE_ANON },
      body: JSON.stringify({ email, password: senhaAtual }),
    });
    if (!r1.ok) {
      const d = await r1.json().catch(() => ({}));
      if (r1.status === 400) throw new Error("Senha atual incorreta.");
      throw new Error(d?.msg || d?.error_description || d?.error || `Erro ${r1.status} na re-autenticação`);
    }

    // 2) PUT /auth/v1/user — troca a senha
    const r2 = await fetch(`${ApiBEM.URL_SUPABASE}/auth/v1/user`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "apikey": ApiBEM.CHAVE_SUPABASE_ANON,
        "Authorization": `Bearer ${s.access_token}`,
      },
      body: JSON.stringify({ password: novaSenha }),
    });
    if (!r2.ok) {
      const d = await r2.json().catch(() => ({}));
      throw new Error(d?.msg || d?.error_description || d?.error || `Erro ${r2.status} ao trocar senha`);
    }
    return true;
  }

  /** Histórico dos últimos N acessos do usuário atual. */
  static async listarMeusAcessos(limite = 30) {
    const s = await Autenticacao._renovarTokenSeNecessario();
    if (!s?.access_token) return [];
    try {
      const r = await Autenticacao._proxy("rpc:listar_meus_acessos", { p_limit: limite });
      return Array.isArray(r) ? r : [];
    } catch { return []; }
  }

  /** Registra um evento de acesso (login, manual, refresh, etc). Best-effort. */
  static async registrarAcesso(origem = "login") {
    const s = await Autenticacao._renovarTokenSeNecessario();
    if (!s?.access_token) return null;
    try {
      const ua = (typeof navigator !== "undefined") ? navigator.userAgent : null;
      return await Autenticacao._proxy("rpc:registrar_acesso", { p_origem: origem, p_user_agent: ua });
    } catch { return null; }
  }
}

if (typeof window !== "undefined") window.Autenticacao = Autenticacao;
