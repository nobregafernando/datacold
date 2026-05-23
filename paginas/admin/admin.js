/**
 * Página Admin — dashboard inicial após login.
 * Monta o MenuLateral, carrega o catálogo e calcula KPIs.
 */
class PaginaAdmin {
  constructor() {
    this.api = new ApiBEM();
    this.usuario = Autenticacao.usuarioAtual();
    this.sensores = [];
    this.grupos = [];
  }

  async iniciar() {
    // 1. Proteger rota
    if (!Autenticacao.protegerPagina("../login/login.html")) return;

    // 2. Personalizar header
    this._injetarNomeUsuario();
    this._registrarHorarioSessao();

    // 3. Montar menu lateral (componente) — clique em sensor navega pra própria página
    this.menu = new MenuLateral({ paginaAtiva: "admin", raiz: "../../" });
    await this.menu.montar("#menu-lateral");

    // 4. Montar menu superior (componente) — status da API + sino de alertas
    this.topo = new MenuTopo({ titulo: "Dashboard", raiz: "../../" });
    this.topo.montar("#menu-topo");

    // 5. Espelhar a lista carregada pelo menu pro próprio dashboard
    this.sensores = this.menu.sensores;
    this.grupos = this.menu.grupos;

    // 6. KPIs + distribuição
    this._renderizarKpis();
    this._renderizarDistribuicao();

    // 7. Botão atualizar
    document.querySelector("[data-acao='atualizar']").addEventListener("click", () => this._recarregar());
  }

  // ===================================================================
  //  Header
  // ===================================================================

  _injetarNomeUsuario() {
    const alvo = document.querySelector("[data-nome-usuario]");
    if (alvo && this.usuario) {
      const primeiroNome = this.usuario.nome.split(/\s+/)[0];
      alvo.textContent = primeiroNome;
    }
  }

  _registrarHorarioSessao() {
    const el = document.querySelector("[data-sessao-iniciada]");
    if (el) el.textContent = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  async _recarregar() {
    await this.menu._carregarCatalogo();
    this.sensores = this.menu.sensores;
    this.grupos = this.menu.grupos;
    this._renderizarKpis();
    this._renderizarDistribuicao();
  }

  // ===================================================================
  //  KPIs
  // ===================================================================

  _renderizarKpis() {
    const cont = document.querySelector("[data-kpis]");
    if (!cont) return;

    const total      = this.sensores.length;
    const ativos     = this.sensores.filter(s => s.ativo).length;
    const historicos = this.sensores.filter(s => s.historico).length;
    const ambientes  = this.grupos.length;

    cont.innerHTML = `
      <div class="kpi-card azul">
        <div class="kpi-ico">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
        </div>
        <div class="kpi-rotulo">Sensores totais</div>
        <div class="kpi-valor">${total}</div>
        <div class="kpi-sub">conectados ao sistema</div>
      </div>

      <div class="kpi-card ciano">
        <div class="kpi-ico">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
        </div>
        <div class="kpi-rotulo">Ativos agora</div>
        <div class="kpi-valor">${ativos}</div>
        <div class="kpi-sub">enviando telemetria</div>
      </div>

      <div class="kpi-card alerta">
        <div class="kpi-ico">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        </div>
        <div class="kpi-rotulo">Histórico</div>
        <div class="kpi-valor">${historicos}</div>
        <div class="kpi-sub">dados retroativos</div>
      </div>

      <div class="kpi-card claro">
        <div class="kpi-ico">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
        </div>
        <div class="kpi-rotulo">Ambientes</div>
        <div class="kpi-valor">${ambientes}</div>
        <div class="kpi-sub">grupos monitorados</div>
      </div>
    `;
  }

  _renderizarDistribuicao() {
    const cont = document.querySelector("[data-distribuicao]");
    if (!cont) return;
    const contar = (tipo) => this.sensores.filter(s => s.tipo === tipo).length;
    const e = contar("energia"), t = contar("temperatura"), p = contar("porta");

    cont.innerHTML = `
      <div class="dist-item energia">
        <span class="tag">Energia</span>
        <div class="qtd">${e}</div>
        <div class="nota">trifásica · kW, FP, CUB, VUB</div>
      </div>
      <div class="dist-item temperatura">
        <span class="tag">Temperatura</span>
        <div class="qtd">${t}</div>
        <div class="nota">câmaras frias e ambientes</div>
      </div>
      <div class="dist-item porta">
        <span class="tag">Porta</span>
        <div class="qtd">${p}</div>
        <div class="nota">aberturas e transições</div>
      </div>
    `;
  }

}

document.addEventListener("DOMContentLoaded", () => {
  new PaginaAdmin().iniciar();
});
