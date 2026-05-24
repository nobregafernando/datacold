/**
 * Página · Usuários (admin only)
 *
 * Lista todos os perfis cadastrados e oferece um modal pra
 * convidar novos. O convite cria o auth.users com senha
 * descartável e dispara o e-mail "definir senha".
 */
class PaginaUsuarios {
  constructor() {
    this.elLista     = document.querySelector("[data-lista]");
    this.elStatTotal = document.querySelector("[data-stat-total]");
    this.elStatAdmin = document.querySelector("[data-stat-admin]");
    this.elStatOp    = document.querySelector("[data-stat-op]");
    this.modal       = document.querySelector("[data-modal]");
    this.form        = document.querySelector("[data-form]");
    this.elErro      = document.querySelector("[data-erro]");
    this.elOk        = document.querySelector("[data-ok]");
    this.btnConvidar = document.querySelector("[data-btn-convidar]");

    this.usuarios = [];
    this.eu       = null;
  }

  async iniciar() {
    if (!Autenticacao.protegerPagina("../../login/", "admin", "../../admin/")) return;

    this.eu = Autenticacao.usuarioAtual();
    const raiz = "../../../";
    new MenuLateral({ usuario: this.eu, raiz, paginaAtiva: "usuarios" }).montar("#menu-lateral");
    if (window.MenuTopo) new MenuTopo({ titulo: "Usuários", raiz }).montar("#menu-topo");

    this._ligarEventos();
    await this._carregar();
  }

  _ligarEventos() {
    // Abrir/fechar modal
    document.querySelector('[data-acao="abrir-convite"]')
      ?.addEventListener("click", () => this._abrirModal());
    document.querySelectorAll("[data-fechar-modal]").forEach(el => {
      el.addEventListener("click", () => this._fecharModal());
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.modal.hidden) this._fecharModal();
    });

    this.form?.addEventListener("submit", (ev) => this._convidar(ev));
  }

  async _carregar() {
    try {
      const linhas = await Autenticacao.listarUsuarios();
      this.usuarios = Array.isArray(linhas) ? linhas : [];
      this._renderizar();
    } catch (err) {
      this.elLista.innerHTML = `<div class="usuarios-vazio">Erro ao carregar usuários: ${err.message || err}</div>`;
    }
  }

  _renderizar() {
    const total = this.usuarios.length;
    const nAdm  = this.usuarios.filter(u => u.papel === "admin").length;
    const nOp   = total - nAdm;

    this.elStatTotal.textContent = total;
    this.elStatAdmin.textContent = nAdm;
    this.elStatOp.textContent    = nOp;

    if (!total) {
      this.elLista.innerHTML = `<div class="usuarios-vazio">Nenhum usuário cadastrado ainda. Convide o primeiro pelo botão acima.</div>`;
      return;
    }

    this.elLista.innerHTML = this.usuarios.map(u => {
      const iniciais = Usuario.gerarIniciais(u.nome);
      const sou = this.eu && u.id === this.eu.id;
      const desde = this._formatarDesde(u.criado_em);
      return `
        <article class="us-card ${sou ? "us-eu" : ""}" data-papel="${u.papel}">
          <div class="us-avatar" aria-hidden="true">${iniciais}</div>
          <div class="us-info">
            <div class="us-nome">${this._escape(u.nome)}${sou ? '<span class="us-eu-tag">você</span>' : ""}</div>
            <div class="us-email">${this._escape(u.id)}</div>
          </div>
          <span class="us-papel ${u.papel}">${u.papel === "admin" ? "Admin" : "Operador"}</span>
          <span class="us-desde" title="${u.criado_em || ""}">desde ${desde}</span>
        </article>
      `;
    }).join("");
  }

  _abrirModal() {
    this._msg(null, null);
    this.form?.reset();
    this.modal.hidden = false;
    setTimeout(() => this.form?.querySelector('input[name="email"]')?.focus(), 50);
  }

  _fecharModal() {
    this.modal.hidden = true;
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

    try { UtilFormulario.bloquearInjection(email); }
    catch (err) { return this._msg(err.message, null); }

    this._carregando(true);
    try {
      const r = await Autenticacao.convidarOperador({ email: eEmail, papel });
      this._msg(null, `Convite enviado para ${r.email}. Ele tem alguns minutos pra clicar no link e definir nome/senha.`);
      this.form.reset();
      // Recarrega lista (a linha entra com nome temporário até o convidado completar)
      this._carregar();
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
    if (!this.btnConvidar) return;
    this.btnConvidar.disabled = estado;
    this.btnConvidar.textContent = estado ? "Enviando…" : "Enviar convite";
  }

  _formatarDesde(iso) {
    if (!iso) return "—";
    const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (dias < 1)   return "hoje";
    if (dias === 1) return "ontem";
    if (dias < 30)  return `${dias} dias`;
    if (dias < 365) return `${Math.round(dias/30)} m`;
    return new Date(iso).toLocaleDateString("pt-BR");
  }

  _escape(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }
}

document.addEventListener("DOMContentLoaded", () => new PaginaUsuarios().iniciar());
