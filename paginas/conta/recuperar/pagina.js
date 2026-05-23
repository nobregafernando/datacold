/**
 * Página · Recuperar senha
 *
 * Página pública. Dispara o endpoint /auth/v1/recover do Supabase.
 * Mostra sempre a MESMA mensagem de sucesso (mesmo que o e-mail não
 * exista) — evita "enumeration attack" onde alguém descobre quais
 * e-mails têm conta tentando recuperar.
 */
class PaginaRecuperar {
  constructor() {
    this.form  = document.querySelector("[data-form]");
    this.elErro = document.querySelector("[data-erro]");
    this.elOk   = document.querySelector("[data-ok]");
    this.btn    = document.querySelector("[data-btn-enviar]");
  }

  iniciar() {
    this.form?.addEventListener("submit", (ev) => this._enviar(ev));
  }

  async _enviar(ev) {
    ev.preventDefault();
    this._msg(null, null);

    const emailBruto = new FormData(this.form).get("email") || "";
    const email = Sanitizar.email(String(emailBruto));
    if (!email) return this._msg("Informe um e-mail válido.", null);

    this._carregando(true);
    try {
      await Autenticacao.pedirRecuperacao(email);
      // Sempre o mesmo texto (independente da existência da conta).
      this._msg(null, "Se este e-mail tiver conta, enviaremos um link de redefinição em alguns segundos. Verifique também a pasta de spam.");
      this.form.reset();
    } catch (err) {
      // pedirRecuperacao engole erros do servidor, então esse catch é
      // só pra problemas de rede/validação.
      this._msg("Não foi possível enviar agora. Tente de novo em instantes.", null);
    } finally {
      this._carregando(false);
    }
  }

  _msg(erro, ok) {
    if (this.elErro) { this.elErro.hidden = !erro; this.elErro.textContent = erro || ""; }
    if (this.elOk)   { this.elOk.hidden   = !ok;   this.elOk.textContent   = ok   || ""; }
  }

  _carregando(estado) {
    if (!this.btn) return;
    this.btn.disabled = estado;
    this.btn.textContent = estado ? "Enviando…" : "Enviar link";
  }
}

document.addEventListener("DOMContentLoaded", () => new PaginaRecuperar().iniciar());
