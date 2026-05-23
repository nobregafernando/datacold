/**
 * Menu lateral reutilizável.
 *
 * Uso:
 *   const menu = new MenuLateral({ paginaAtiva: "admin", raiz: "../../" });
 *   await menu.montar("#menu-lateral");
 *
 * O HTML é renderizado dentro do elemento informado. Não depende de
 * frameworks. Carrega a lista de sensores pela ApiBEM.
 */
class MenuLateral {
  /**
   * @param {object} opcoes
   * @param {string} opcoes.paginaAtiva - identificador da página atual (ex: "admin").
   * @param {string} opcoes.raiz        - prefixo até a raiz do projeto (ex: "../../").
   * @param {function} opcoes.aoSelecionarSensor - callback opcional ao clicar num sensor.
   */
  constructor({ paginaAtiva = "", raiz = "../../", aoSelecionarSensor = null } = {}) {
    this.paginaAtiva = paginaAtiva;
    this.raiz = raiz;
    this.aoSelecionarSensor = aoSelecionarSensor;
    this.api = new ApiBEM();
    this.usuario = Autenticacao.usuarioAtual();
    this.sensores = [];
    this.grupos = [];
    this.filtro = "todos";
    this.sensorSelecionadoId = null;
  }

  async montar(seletor) {
    this.raizEl = typeof seletor === "string" ? document.querySelector(seletor) : seletor;
    if (!this.raizEl) throw new Error(`MenuLateral: elemento "${seletor}" não encontrado.`);

    this._renderizarEsqueleto();
    this._ligarEventosGlobais();
    await this._carregarCatalogo();
  }

  /** Marca externamente qual sensor está aberto (sem rerender completo). */
  destacarSensor(sensorId) {
    this.sensorSelecionadoId = sensorId;
    this.raizEl.querySelectorAll("[data-sensor]").forEach(el => {
      el.classList.toggle("ativo", el.dataset.sensor === sensorId);
    });
  }

  // ===================================================================
  //  Internos
  // ===================================================================

  _renderizarEsqueleto() {
    const u = this.usuario;
    const inic = u ? u.iniciais : "?";
    const nome = u ? u.nome : "Sessão expirada";
    const email = u ? u.email : "—";
    const papel = u ? u.rotuloPapel : "—";

    this.raizEl.innerHTML = `
      <div class="ml-topo">
        <a href="${this.raiz}index.html" class="ml-marca" aria-label="DataCold">
          <img src="${this.raiz}logo/01-primary-logo.png" alt="DataCold">
        </a>
      </div>

      <div class="ml-usuario">
        <div class="ml-avatar" aria-hidden="true">${inic}</div>
        <div class="ml-usuario-info">
          <div class="ml-usuario-nome">${nome}</div>
          <div class="ml-usuario-email">${email}</div>
          <span class="ml-papel">${papel}</span>
        </div>
      </div>

      <nav class="ml-secao-nav" aria-label="navegação">
        <a href="${this.raiz}paginas/admin/admin.html" class="ml-link ${this.paginaAtiva==='admin'?'ativo':''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
          Dashboard
        </a>
        <a href="#" class="ml-link" data-acao="recarregar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          Atualizar dados
        </a>
      </nav>

      <div class="ml-secao">
        <div class="ml-titulo-secao">Sensores</div>
        <div class="ml-filtros" role="tablist">
          <button data-filtro="todos" class="ativo">Todos</button>
          <button data-filtro="energia">Energia</button>
          <button data-filtro="temperatura">Temp</button>
          <button data-filtro="porta">Porta</button>
        </div>
        <div class="ml-lista-sensores" data-lista>
          <div class="ml-loading">Carregando…</div>
        </div>
      </div>

      <div class="ml-rodape">
        <button class="ml-sair" data-acao="sair">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          Sair
        </button>
      </div>
    `;
  }

  _ligarEventosGlobais() {
    this.raizEl.addEventListener("click", (ev) => {
      const acao = ev.target.closest("[data-acao]")?.dataset.acao;
      if (acao === "sair") {
        ev.preventDefault();
        Autenticacao.logout();
        window.location.href = `${this.raiz}paginas/login/login.html`;
      }
      if (acao === "recarregar") {
        ev.preventDefault();
        this._carregarCatalogo();
      }

      const botaoFiltro = ev.target.closest("[data-filtro]");
      if (botaoFiltro) {
        this.raizEl.querySelectorAll("[data-filtro]").forEach(b => b.classList.remove("ativo"));
        botaoFiltro.classList.add("ativo");
        this.filtro = botaoFiltro.dataset.filtro;
        this._renderizarSensores();
      }

      const itemSensor = ev.target.closest("[data-sensor]");
      if (itemSensor) {
        ev.preventDefault();
        const id = itemSensor.dataset.sensor;
        this.destacarSensor(id);
        if (this.aoSelecionarSensor) this.aoSelecionarSensor(id);
      }
    });
  }

  async _carregarCatalogo() {
    const lista = this.raizEl.querySelector("[data-lista]");
    lista.innerHTML = `<div class="ml-loading">Carregando…</div>`;
    try {
      const dados = await this.api.listarCatalogo();
      this.sensores = FabricaSensor.criarLista(dados.sensors || []);
      this.grupos = dados.groups || [];
      this._renderizarSensores();
    } catch (e) {
      lista.innerHTML = `<div class="ml-erro">Erro ao carregar: ${e.message}</div>`;
    }
  }

  _renderizarSensores() {
    const lista = this.raizEl.querySelector("[data-lista]");
    const filtrados = this.sensores.filter(s =>
      this.filtro === "todos" || s.tipo === this.filtro
    );
    if (!filtrados.length) {
      lista.innerHTML = `<div class="ml-vazio">Nenhum sensor.</div>`;
      return;
    }

    const ordem = ["extrusao","camara_congelados","camara_estoque","graxaria","externo_campo_grande","externo_tres_lagoas"];
    let html = "";

    ordem.forEach(gid => {
      const grupo = this.grupos.find(g => g.id === gid);
      if (!grupo) return;
      const doGrupo = filtrados.filter(s => s.grupo === gid);
      if (!doGrupo.length) return;
      html += `<div class="ml-grupo-rotulo">${grupo.label}</div>`;
      doGrupo.forEach(s => {
        const ativo = this.sensorSelecionadoId === s.id ? "ativo" : "";
        html += `
          <a href="#" class="ml-item ${ativo}" data-sensor="${s.id}">
            <span class="ml-bolinha tipo-${s.tipo}"></span>
            <div class="ml-item-info">
              <div class="ml-item-nome">${s.rotulo}</div>
              <div class="ml-item-id">${s.id}</div>
            </div>
            <span class="ml-status-pill ${s.status}">${s.status}</span>
          </a>
        `;
      });
    });

    lista.innerHTML = html || `<div class="ml-vazio">Sem sensores neste filtro.</div>`;
  }
}

if (typeof window !== "undefined") window.MenuLateral = MenuLateral;
