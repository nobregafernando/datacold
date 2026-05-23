/**
 * Página de login real (Supabase Auth) + atalho MVP.
 *
 * - O botão MVP cria uma sessão fake (Autenticacao.loginMvp) e vai pro
 *   dashboard. Fica até o admin real estar criado e a gente derrubar.
 * - O formulário usa Autenticacao.loginEmail(email, senha) que valida
 *   entrada via Sanitizar/ValidadorSenha antes de bater no Supabase.
 */
class PaginaLogin {
  constructor() {
    this.form      = document.querySelector("[data-form]");
    this.botaoMvp  = document.querySelector("[data-acao='mvp']");
    this.btnEntrar = document.querySelector("[data-btn-entrar]");
    this.elErro    = document.querySelector("[data-erro]");
  }

  iniciar() {
    if (Autenticacao.autenticado()) {
      window.location.replace("../admin/");
      return;
    }
    this.botaoMvp?.addEventListener("click", () => this._entrarMvp());
    this.form?.addEventListener("submit", (ev) => this._entrarFormulario(ev));
  }

  _entrarMvp() {
    Autenticacao.loginMvp();
    window.location.href = "../admin/";
  }

  async _entrarFormulario(ev) {
    ev.preventDefault();
    this._mostrarErro(null);

    const dados = new FormData(this.form);
    const emailBruto = (dados.get("email") || "").toString();
    const senha = (dados.get("senha") || "").toString();

    const email = Sanitizar.email(emailBruto);
    if (!email)  return this._mostrarErro("Informe um e-mail válido.");
    if (!senha)  return this._mostrarErro("Informe a senha.");

    this._carregando(true);
    try {
      await Autenticacao.loginEmail(email, senha);
      window.location.href = "../admin/";
    } catch (err) {
      // Mensagens mais legíveis para os erros mais comuns do Supabase
      const m = String(err.message || "");
      let amigavel = m;
      if (/invalid login credentials/i.test(m)) amigavel = "E-mail ou senha incorretos.";
      else if (/email not confirmed/i.test(m)) amigavel = "Confirme o e-mail antes de entrar.";
      else if (/network/i.test(m))             amigavel = "Sem conexão com o servidor.";
      this._mostrarErro(amigavel);
    } finally {
      this._carregando(false);
    }
  }

  _mostrarErro(msg) {
    if (!this.elErro) return;
    if (!msg) { this.elErro.hidden = true; this.elErro.textContent = ""; return; }
    this.elErro.hidden = false;
    this.elErro.textContent = msg;
  }

  _carregando(estado) {
    if (!this.btnEntrar) return;
    this.btnEntrar.disabled = estado;
    this.btnEntrar.textContent = estado ? "Entrando…" : "Entrar";
  }
}

document.addEventListener("DOMContentLoaded", () => new PaginaLogin().iniciar());
