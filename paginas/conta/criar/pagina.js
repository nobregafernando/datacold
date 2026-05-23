/**
 * Página · Convidar usuário (admin-only)
 *
 * Admin preenche apenas e-mail + papel. O sistema:
 *   1) cria a conta com senha aleatória (descartável)
 *   2) dispara o email "definir senha"
 *
 * O convidado completa nome + senha em /paginas/conta/definir/.
 */
class PaginaConvite {
  constructor() {
    this.form   = document.querySelector("[data-form]");
    this.elInfo = document.querySelector("[data-admin-info]");
    this.elErro = document.querySelector("[data-erro]");
    this.elOk   = document.querySelector("[data-ok]");
    this.btn    = document.querySelector("[data-btn-convidar]");
  }

  iniciar() {
    if (!Autenticacao.protegerPagina("../../login/", "admin", "../../admin/")) return;

    const eu = Autenticacao.usuarioAtual();
    if (this.elInfo) this.elInfo.textContent = `${eu.nome} · ${eu.rotuloPapel}`;

    this.form?.addEventListener("submit", (ev) => this._convidar(ev));
  }

  async _convidar(ev) {
    ev.preventDefault();
    this._msg(null, null);

    const f = new FormData(this.form);
    const email = (f.get("email") || "").toString();
    const papel = (f.get("papel") || "operador").toString();

    const eEmail = Sanitizar.email(email);
    if (!eEmail) return this._msg("E-mail inválido.", null);
    if (!["admin","operador"].includes(papel)) return this._msg("Papel inválido.", null);

    // Bloqueia padrões clássicos de SQL/XSS antes de enviar
    try { UtilFormulario.bloquearInjection(email); }
    catch (err) { return this._msg(err.message, null); }

    this._carregando(true);
    try {
      const r = await Autenticacao.convidarOperador({ email: eEmail, papel });
      this._msg(null, `Convite enviado para ${r.email}. Ele tem alguns minutos pra clicar no link e definir nome/senha.`);
      this.form.reset();
    } catch (err) {
      this._msg(String(err.message || "Não foi possível enviar o convite."), null);
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
    this.btn.textContent = estado ? "Enviando convite…" : "Enviar convite";
  }
}

document.addEventListener("DOMContentLoaded", () => new PaginaConvite().iniciar());
