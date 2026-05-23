/**
 * Camada de autenticação simples baseada em localStorage.
 * Para o MVP não há backend de auth — a sessão fica no navegador.
 */
class Autenticacao {
  static CHAVE = "datacold_sessao";

  /** Usuário "ferramenta" pra acesso rápido no MVP. */
  static USUARIO_MVP = {
    nome:  "Fernando Nóbrega Alves",
    email: "fernandonobregaalves@gmail.com",
    papel: "admin",
  };

  static login(usuario) {
    const u = usuario instanceof Usuario ? usuario : new Usuario(usuario);
    localStorage.setItem(Autenticacao.CHAVE, JSON.stringify(u.serializar()));
    return u;
  }

  static loginMvp() {
    return Autenticacao.login(Autenticacao.USUARIO_MVP);
  }

  static logout() {
    localStorage.removeItem(Autenticacao.CHAVE);
  }

  static usuarioAtual() {
    try {
      const cru = localStorage.getItem(Autenticacao.CHAVE);
      if (!cru) return null;
      return Usuario.deserializar(JSON.parse(cru));
    } catch {
      return null;
    }
  }

  static autenticado() {
    return Autenticacao.usuarioAtual() !== null;
  }

  /**
   * Bloqueia a página se não houver sessão.
   * @param {string} urlLogin - caminho relativo para a página de login.
   */
  static protegerPagina(urlLogin = "../login/login.html") {
    if (!Autenticacao.autenticado()) {
      window.location.replace(urlLogin);
      return false;
    }
    return true;
  }
}

if (typeof window !== "undefined") window.Autenticacao = Autenticacao;
