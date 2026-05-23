/**
 * Página de login.
 * MVP: qualquer credencial vira o usuário padrão. O botão "Entrar como Fernando"
 * faz o login sem precisar preencher nada.
 */
class PaginaLogin {
  constructor() {
    this.form = document.querySelector("[data-form]");
    this.botaoMvp = document.querySelector("[data-acao='mvp']");
  }

  iniciar() {
    // Se já está logado, vai direto pro admin.
    if (Autenticacao.autenticado()) {
      window.location.replace("../admin//");
      return;
    }

    this.botaoMvp.addEventListener("click", () => this._entrarMvp());
    this.form.addEventListener("submit", (ev) => this._entrarFormulario(ev));
  }

  _entrarMvp() {
    Autenticacao.loginMvp();
    window.location.href = "../admin//";
  }

  _entrarFormulario(ev) {
    ev.preventDefault();
    const dados = new FormData(this.form);
    const email = (dados.get("email") || "").trim();
    const nome = email.split("@")[0]
      .replace(/[._]+/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase());
    Autenticacao.login({ nome: nome || "Operador", email, papel: "operador" });
    window.location.href = "../admin//";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new PaginaLogin().iniciar();
});
