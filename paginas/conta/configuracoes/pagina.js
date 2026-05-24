/**
 * Página · Configurações da conta (admin OU operador)
 *
 * - Mostra identidade (avatar, nome, e-mail read-only, papel)
 * - Permite trocar a senha: confirma senha atual + valida nova (ValidadorSenha)
 *   + pede confirmação. Re-auth + PUT /auth/v1/user via proxy.
 * - Lista histórico de acessos (RPC `listar_meus_acessos`)
 */
class PaginaConfiguracoes {
  constructor() {
    // Identidade
    this.elAvatar = document.querySelector("[data-eu-avatar]");
    this.elNome   = document.querySelector("[data-eu-nome]");
    this.elEmail  = document.querySelector("[data-eu-email]");
    this.elPapel  = document.querySelector("[data-eu-papel]");

    // Senha
    this.form        = document.querySelector("[data-form-senha]");
    this.elErro      = document.querySelector("[data-erro]");
    this.elOk        = document.querySelector("[data-ok]");
    this.btnTrocar   = document.querySelector("[data-btn-trocar]");
    this.elForca     = document.querySelector("[data-forca]");
    this.elForcaFill = document.querySelector("[data-forca-fill]");
    this.elForcaRot  = document.querySelector("[data-forca-rotulo]");
    this.elCriterios = document.querySelector("[data-criterios]");
    this.inpAtual    = this.form?.querySelector('input[name="atual"]');
    this.inpNova     = this.form?.querySelector('input[name="nova"]');
    this.inpConf     = this.form?.querySelector('input[name="confirmar"]');

    // Acessos
    this.elAcessos = document.querySelector("[data-acessos]");

    this.eu = null;
  }

  async iniciar() {
    // Qualquer logado (admin ou operador) — só precisa de sessão
    if (!Autenticacao.protegerPagina("../../login/", "operador")) return;

    this.eu = Autenticacao.usuarioAtual();
    const raiz = "../../../";
    new MenuLateral({ usuario: this.eu, raiz, paginaAtiva: "configuracoes" }).montar("#menu-lateral");
    if (window.MenuTopo) new MenuTopo({ titulo: "Configurações", raiz }).montar("#menu-topo");

    this._renderizarIdentidade();
    this._ligarValidacaoSenha();
    this.form?.addEventListener("submit", (ev) => this._trocarSenha(ev));
    await this._carregarAcessos();
  }

  _renderizarIdentidade() {
    const u = this.eu;
    this.elAvatar.textContent = u.iniciais || "?";
    this.elAvatar.classList.toggle("admin", !!u.ehAdmin);
    this.elNome.textContent   = u.nome || "—";
    this.elEmail.textContent  = u.email || "—";
    this.elPapel.textContent  = u.rotuloPapel;
    this.elPapel.classList.add(u.papel);
  }

  // ===================================================================
  //  Validação ao vivo da nova senha
  // ===================================================================
  _ligarValidacaoSenha() {
    if (!this.inpNova) return;
    this.inpNova.addEventListener("input", () => this._avaliarSenha());
    this.inpConf?.addEventListener("input", () => this._msg(null, null));
  }

  _avaliarSenha() {
    const s = this.inpNova.value || "";
    if (!s) {
      this.elForca.hidden = true;
      this.elCriterios.querySelectorAll("li").forEach(li => li.classList.remove("ok"));
      return;
    }
    this.elForca.hidden = false;

    // Critérios individuais — espelha ValidadorSenha
    const checks = {
      comp:  s.length >= 8,
      maius: /[A-Z]/.test(s),
      minus: /[a-z]/.test(s),
      num:   /[0-9]/.test(s),
      esp:   /[^A-Za-z0-9]/.test(s),
    };
    let n = 0;
    for (const [k, ok] of Object.entries(checks)) {
      const li = this.elCriterios.querySelector(`[data-criterio="${k}"]`);
      li?.classList.toggle("ok", ok);
      if (ok) n++;
    }
    const nivel = n <= 2 ? 1 : n <= 4 ? 2 : 3;
    const pct   = Math.round((n / 5) * 100);
    this.elForca.dataset.nivel = String(nivel);
    this.elForcaFill.style.width = `${pct}%`;
    this.elForcaRot.textContent = nivel === 3 ? "Forte" : nivel === 2 ? "Média" : "Fraca";
  }

  // ===================================================================
  //  Troca de senha
  // ===================================================================
  async _trocarSenha(ev) {
    ev.preventDefault();
    this._msg(null, null);

    const atual = this.inpAtual.value || "";
    const nova  = this.inpNova.value  || "";
    const conf  = this.inpConf.value  || "";

    if (!atual) return this._msg("Informe sua senha atual.", null);
    if (nova !== conf) return this._msg("A confirmação não bate com a nova senha.", null);

    this._carregando(true);
    try {
      await Autenticacao.alterarSenha(atual, nova);
      this._msg(null, "Senha alterada com sucesso. Use a nova nos próximos logins.");
      this.form.reset();
      this._avaliarSenha();
      // Registra o evento de troca como acesso "manual" pra ver no histórico
      try { await Autenticacao.registrarAcesso("manual"); } catch {}
      this._carregarAcessos();
    } catch (err) {
      this._msg(String(err.message || "Não foi possível trocar a senha."), null);
    } finally {
      this._carregando(false);
    }
  }

  _msg(erro, ok) {
    if (this.elErro) { this.elErro.hidden = !erro; this.elErro.textContent = erro || ""; }
    if (this.elOk)   { this.elOk.hidden   = !ok;   this.elOk.textContent   = ok   || ""; }
  }
  _carregando(estado) {
    if (!this.btnTrocar) return;
    this.btnTrocar.disabled = estado;
    this.btnTrocar.textContent = estado ? "Trocando…" : "Trocar senha";
  }

  // ===================================================================
  //  Histórico de acessos
  // ===================================================================
  async _carregarAcessos() {
    try {
      const linhas = await Autenticacao.listarMeusAcessos(30);
      this._renderizarAcessos(Array.isArray(linhas) ? linhas : []);
    } catch (err) {
      this.elAcessos.innerHTML = `<div class="cfg-vazio">Não consegui carregar o histórico (${this._escape(err.message || err)}).</div>`;
    }
  }

  _renderizarAcessos(linhas) {
    if (!linhas.length) {
      this.elAcessos.innerHTML = `<div class="cfg-vazio">Nenhum acesso registrado ainda. Após o próximo login, ele aparecerá aqui.</div>`;
      return;
    }
    this.elAcessos.innerHTML = `
      <div class="cfg-acessos-lista">
        ${linhas.map(a => this._htmlAcesso(a)).join("")}
      </div>
    `;
  }

  _htmlAcesso(a) {
    const quando = this._formatarQuando(a.criado_em);
    const ua = this._resumirUA(a.user_agent);
    return `
      <div class="cfg-acesso">
        <svg class="cfg-acesso-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        <div class="cfg-acesso-meta">
          <div class="cfg-acesso-qd">${this._escape(ua)}</div>
          <div class="cfg-acesso-ua" title="${this._escape(a.user_agent || "")}">${this._escape(a.user_agent || "")}</div>
        </div>
        <span class="cfg-acesso-origem ${a.origem}">${this._escape(a.origem || "login")}</span>
        <span class="cfg-acesso-quando" title="${this._escape(a.criado_em)}">${quando}</span>
      </div>
    `;
  }

  /** Extrai navegador/SO grosseiramente do user-agent — só pra rótulo legível. */
  _resumirUA(ua) {
    if (!ua) return "Sessão";
    let navegador = "Navegador";
    if (/Edg\//.test(ua))           navegador = "Edge";
    else if (/Chrome\//.test(ua))   navegador = "Chrome";
    else if (/Firefox\//.test(ua))  navegador = "Firefox";
    else if (/Safari\//.test(ua))   navegador = "Safari";
    let so = "";
    if (/Windows/.test(ua))         so = "Windows";
    else if (/Mac OS X/.test(ua))   so = "macOS";
    else if (/Android/.test(ua))    so = "Android";
    else if (/iPhone|iPad/.test(ua))so = "iOS";
    else if (/Linux/.test(ua))      so = "Linux";
    return so ? `${navegador} · ${so}` : navegador;
  }

  _formatarQuando(iso) {
    if (!iso) return "—";
    const t = new Date(iso);
    const diffSeg = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (diffSeg < 60)         return "agora";
    if (diffSeg < 3600)       return `há ${Math.round(diffSeg/60)} min`;
    if (diffSeg < 86400)      return `há ${Math.round(diffSeg/3600)} h`;
    if (diffSeg < 86400 * 30) return `há ${Math.round(diffSeg/86400)} d`;
    return t.toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric" });
  }

  _escape(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }
}

document.addEventListener("DOMContentLoaded", () => new PaginaConfiguracoes().iniciar());
