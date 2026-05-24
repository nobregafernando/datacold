/**
 * Página · Usuários (admin only)
 *
 * Recursos:
 *  - Lista usuários com nome, email, papel, status (ativo/inativo)
 *  - Convidar novo usuário (envia email "definir senha")
 *  - Desativar / Reativar conta (bloqueia login)
 *  - Disparar recuperação de senha
 *  - Zona de perigo: deletar conta + dependências (cascade)
 *  - Confirmações tipográficas pra ações destrutivas
 */
class PaginaUsuarios {
  constructor() {
    this.elLista     = document.querySelector("[data-lista]");
    this.elStatTotal = document.querySelector("[data-stat-total]");
    this.elStatAdmin = document.querySelector("[data-stat-admin]");
    this.elStatOp    = document.querySelector("[data-stat-op]");
    this.elStatIna   = document.querySelector("[data-stat-inativos]");

    this.modalConv   = document.querySelector("[data-modal]");
    this.form        = document.querySelector("[data-form]");
    this.elErro      = document.querySelector("[data-erro]");
    this.elOk        = document.querySelector("[data-ok]");
    this.btnConvidar = document.querySelector("[data-btn-convidar]");

    this.modalAcao   = document.querySelector("[data-modal-acao]");
    this.toast       = document.querySelector("[data-toast]");

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
    document.querySelector('[data-acao="abrir-convite"]')
      ?.addEventListener("click", () => this._abrirModalConvite());
    document.querySelectorAll("[data-fechar-modal]").forEach(el => {
      el.addEventListener("click", (ev) => {
        const m = ev.target.closest(".modal-conv");
        if (m) m.hidden = true;
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (this.modalConv && !this.modalConv.hidden) this.modalConv.hidden = true;
        if (this.modalAcao && !this.modalAcao.hidden) this.modalAcao.hidden = true;
      }
    });
    this.form?.addEventListener("submit", (ev) => this._convidar(ev));

    // Delegação na lista — usa data-acao + data-id
    this.elLista?.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-acao-user]");
      if (!btn) return;
      const acao = btn.dataset.acaoUser;
      const id   = btn.dataset.id;
      const u    = this.usuarios.find(x => x.id === id);
      if (!u) return;
      if (acao === "desativar") this._confirmarDesativar(u);
      if (acao === "reativar")  this._reativar(u);
      if (acao === "recuperar") this._confirmarRecuperar(u);
      if (acao === "deletar")   this._confirmarDeletar(u);
    });
  }

  async _carregar() {
    this.elLista.innerHTML = `<div class="usuarios-loading">Carregando usuários…</div>`;
    try {
      const linhas = await Autenticacao.listarUsuarios();
      this.usuarios = Array.isArray(linhas) ? linhas : [];
      this._renderizar();
    } catch (err) {
      this.elLista.innerHTML = `<div class="usuarios-vazio us-vazio-erro">
        <strong>Erro ao carregar usuários.</strong>
        <span>${this._escape(err.message || err)}</span>
      </div>`;
    }
  }

  _renderizar() {
    const total = this.usuarios.length;
    const nAdm  = this.usuarios.filter(u => u.papel === "admin").length;
    const nOp   = total - nAdm;
    const nIna  = this.usuarios.filter(u => u.ativo === false).length;

    this.elStatTotal.textContent = total;
    this.elStatAdmin.textContent = nAdm;
    this.elStatOp.textContent    = nOp;
    if (this.elStatIna) this.elStatIna.textContent = nIna;

    if (!total) {
      this.elLista.innerHTML = `<div class="usuarios-vazio">Nenhum usuário cadastrado. Convide o primeiro pelo botão acima.</div>`;
      return;
    }

    this.elLista.innerHTML = this.usuarios.map(u => this._htmlCard(u)).join("");
  }

  _htmlCard(u) {
    const iniciais = Usuario.gerarIniciais(u.nome);
    const sou      = this.eu && u.id === this.eu.id;
    const inativo  = u.ativo === false;
    const desde    = this._formatarDesde(u.criado_em);
    const acessoFmt = u.ultimo_acesso
      ? `acesso ${this._formatarDesde(u.ultimo_acesso)}`
      : `nunca acessou`;

    // Botões de ação (escondidos pra si mesmo + pra usuários sem id válido)
    let acoes = "";
    if (!sou && u.id) {
      const tg = inativo
        ? `<button class="us-btn us-btn-reativar" data-acao-user="reativar" data-id="${u.id}" title="Reativar conta">
             ${this._svg("check")} <span>Reativar</span>
           </button>`
        : `<button class="us-btn us-btn-desativar" data-acao-user="desativar" data-id="${u.id}" title="Desativar conta (bloqueia login)">
             ${this._svg("lock")} <span>Desativar</span>
           </button>`;
      acoes = `
        <div class="us-acoes">
          ${tg}
          ${u.email ? `<button class="us-btn us-btn-recovery" data-acao-user="recuperar" data-id="${u.id}" title="Enviar email de recuperação de senha">
            ${this._svg("mail")} <span>Recuperação</span>
          </button>` : ""}
          <button class="us-btn us-btn-perigo" data-acao-user="deletar" data-id="${u.id}" title="Excluir conta e dependências (irreversível)">
            ${this._svg("trash")} <span>Excluir</span>
          </button>
        </div>
      `;
    }

    return `
      <article class="us-card ${sou ? "us-eu" : ""} ${inativo ? "us-inativo" : ""}" data-papel="${u.papel}">
        <div class="us-avatar" aria-hidden="true">${iniciais}</div>
        <div class="us-info">
          <div class="us-nome">
            ${this._escape(u.nome || "(sem nome)")}
            ${sou ? '<span class="us-eu-tag">você</span>' : ""}
            ${inativo ? '<span class="us-inativo-tag">desativado</span>' : ""}
          </div>
          <div class="us-email">${this._escape(u.email || u.id)}</div>
          <div class="us-meta">
            <span class="us-papel ${u.papel}">${u.papel === "admin" ? "Admin" : "Operador"}</span>
            <span class="us-desde">desde ${desde}</span>
            <span class="us-acesso">${acessoFmt}</span>
          </div>
        </div>
        ${acoes}
      </article>
    `;
  }

  // ===================================================================
  //  Convite (cria novo usuário)
  // ===================================================================

  _abrirModalConvite() {
    this._msg(null, null);
    this.form?.reset();
    this.modalConv.hidden = false;
    setTimeout(() => this.form?.querySelector('input[name="email"]')?.focus(), 50);
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
      this._msg(null, `Convite enviado para ${r.email}.`);
      this.form.reset();
      await this._carregar();
      setTimeout(() => { this.modalConv.hidden = true; }, 1500);
    } catch (err) {
      this._msg(String(err.message || "Não foi possível enviar o convite."), null);
    } finally {
      this._carregando(false);
    }
  }

  // ===================================================================
  //  Desativar
  // ===================================================================

  _confirmarDesativar(u) {
    this._modalAcao({
      titulo: "Desativar usuário?",
      classe: "alerta",
      mensagem: `<strong>${this._escape(u.nome)}</strong> (${this._escape(u.email || "—")}) <strong>não vai mais conseguir entrar</strong>. A conta e o histórico ficam guardados — você pode reativar a qualquer momento.`,
      acaoLabel: "Desativar",
      acaoClasse: "btn-acao-alerta",
      onConfirmar: async () => {
        await Autenticacao.desativarUsuario(u.id);
        this._toast(`${u.nome} desativado.`, "ok");
        await this._carregar();
      },
    });
  }

  async _reativar(u) {
    try {
      await Autenticacao.reativarUsuario(u.id);
      this._toast(`${u.nome} reativado.`, "ok");
      await this._carregar();
    } catch (err) {
      this._toast(`Falha ao reativar: ${err.message || err}`, "erro");
    }
  }

  // ===================================================================
  //  Recovery
  // ===================================================================

  _confirmarRecuperar(u) {
    this._modalAcao({
      titulo: "Enviar recuperação de senha?",
      classe: "info",
      mensagem: `Um email será enviado pra <strong>${this._escape(u.email)}</strong> com um link pra definir uma nova senha. O link expira em 1 hora.`,
      acaoLabel: "Enviar email",
      acaoClasse: "btn-acao-info",
      onConfirmar: async () => {
        const email = await Autenticacao.enviarRecuperacaoPara(u.id);
        this._toast(`Email enviado para ${email}.`, "ok");
      },
    });
  }

  // ===================================================================
  //  Deletar (zona de perigo)
  // ===================================================================

  _confirmarDeletar(u) {
    const palavraConfirma = (u.email || u.nome || "").split("@")[0].trim();
    this._modalAcao({
      titulo: "🚨 Excluir conta permanentemente?",
      classe: "perigo",
      mensagem: `
        <p>Isso vai apagar <strong>${this._escape(u.nome)}</strong> (${this._escape(u.email || u.id)}) <strong>de forma irreversível</strong>:</p>
        <ul class="us-perigo-lista">
          <li>Conta em <code>auth.users</code></li>
          <li>Perfil em <code>perfis_usuarios</code></li>
          <li>Histórico de acessos</li>
          <li>Notificações lidas / arquivadas</li>
          <li>Auditoria de papéis e mudanças</li>
        </ul>
        <p class="us-perigo-aviso">Pra confirmar, digite o nome de usuário abaixo:</p>
        <p class="us-perigo-codigo"><code>${this._escape(palavraConfirma)}</code></p>
      `,
      inputConfirmacao: palavraConfirma,
      acaoLabel: "Excluir permanentemente",
      acaoClasse: "btn-acao-perigo",
      onConfirmar: async () => {
        await Autenticacao.deletarUsuario(u.id);
        this._toast(`${u.nome} excluído.`, "ok");
        await this._carregar();
      },
    });
  }

  // ===================================================================
  //  Helpers de modal/toast
  // ===================================================================

  _modalAcao({ titulo, mensagem, classe, acaoLabel, acaoClasse, inputConfirmacao, onConfirmar }) {
    if (!this.modalAcao) return;
    this.modalAcao.hidden = false;
    this.modalAcao.className = `modal-conv modal-acao ${classe}`;
    this.modalAcao.innerHTML = `
      <div class="modal-conv-overlay" data-fechar-modal></div>
      <div class="modal-conv-card" role="dialog" aria-modal="true">
        <header class="modal-conv-head">
          <h2>${titulo}</h2>
          <button class="modal-fechar" data-fechar-modal aria-label="Fechar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="6" y1="18" x2="18" y2="6"></line></svg>
          </button>
        </header>
        <div class="modal-conv-corpo">
          ${mensagem}
          ${inputConfirmacao ? `
            <input type="text" class="us-confirma-input" placeholder="digite ${inputConfirmacao}" autocomplete="off">
            <div class="us-confirma-erro" hidden></div>
          ` : ""}
          <div class="modal-conv-acoes">
            <button class="btn btn-secundario-claro btn-grande" data-fechar-modal>Cancelar</button>
            <button class="btn ${acaoClasse} btn-grande" data-confirmar disabled>${acaoLabel}</button>
          </div>
        </div>
      </div>
    `;
    const btnOk    = this.modalAcao.querySelector("[data-confirmar]");
    const fechar   = () => { this.modalAcao.hidden = true; };
    this.modalAcao.querySelectorAll("[data-fechar-modal]").forEach(b =>
      b.addEventListener("click", fechar)
    );

    if (inputConfirmacao) {
      const input = this.modalAcao.querySelector(".us-confirma-input");
      btnOk.disabled = true;
      input.addEventListener("input", () => {
        btnOk.disabled = input.value.trim() !== inputConfirmacao;
      });
      setTimeout(() => input.focus(), 50);
    } else {
      btnOk.disabled = false;
    }

    btnOk.addEventListener("click", async () => {
      btnOk.disabled = true;
      btnOk.textContent = "…";
      try { await onConfirmar(); fechar(); }
      catch (err) {
        const erroEl = this.modalAcao.querySelector(".us-confirma-erro");
        if (erroEl) {
          erroEl.hidden = false;
          erroEl.textContent = err.message || String(err);
        } else {
          this._toast(`Erro: ${err.message || err}`, "erro");
        }
        btnOk.disabled = false;
        btnOk.textContent = acaoLabel;
      }
    });
  }

  _toast(msg, classe = "ok") {
    if (!this.toast) {
      console.log("[toast]", classe, msg);
      return;
    }
    this.toast.className = `us-toast us-toast-${classe}`;
    this.toast.textContent = msg;
    this.toast.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this.toast.hidden = true; }, 3500);
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

  _svg(nome) {
    const svgs = {
      check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
      lock:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
      mail:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>`,
      trash: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>`,
    };
    return svgs[nome] || "";
  }
}

document.addEventListener("DOMContentLoaded", () => new PaginaUsuarios().iniciar());
