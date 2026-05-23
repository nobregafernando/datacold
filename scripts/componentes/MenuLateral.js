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
    // Auto-detecta sensor/grupo ativo pela URL (não precisa de chamada manual)
    const auto = this._detectarRotaAtual();
    this.sensorSelecionadoId = auto.sensorId;
    this.grupoAtivoId = auto.grupoId;
    // Sublista de sensores expande sozinha em página de sensor ou de grupo
    this.sensoresExpandido = paginaAtiva === "sensor" || paginaAtiva === "grupo" || !!auto.sensorId || !!auto.grupoId;
  }

  /** Lê window.location pra descobrir se estamos numa página de sensor ou grupo. */
  _detectarRotaAtual() {
    try {
      const path = decodeURIComponent(window.location.pathname);
      const mSensor = path.match(/\/sensores\/([^/]+)\//);
      const mGrupo  = path.match(/\/grupos\/([^/]+)\//);
      return { sensorId: mSensor ? mSensor[1] : null, grupoId: mGrupo ? mGrupo[1] : null };
    } catch { return { sensorId: null, grupoId: null }; }
  }

  async montar(seletor) {
    this.raizEl = typeof seletor === "string" ? document.querySelector(seletor) : seletor;
    if (!this.raizEl) throw new Error(`MenuLateral: elemento "${seletor}" não encontrado.`);

    this._renderizarEsqueleto();
    this._injetarToggle();
    this._aplicarEstadoMenu();
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
          <img src="/assets/logo/01-primary-logo.png" alt="DataCold">
        </a>
      </div>

      <div class="ml-usuario">
        <div class="ml-avatar" aria-hidden="true">${inic}</div>
        <div class="ml-usuario-info">
          <div class="ml-usuario-nome">${nome}</div>
        </div>
      </div>

      <nav class="ml-nav-primaria">
        <a href="${this.raiz}paginas/admin/" class="ml-nav-item ${this.paginaAtiva === "admin" ? "ativo" : ""}" data-nav="admin">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"></rect><rect x="14" y="3" width="7" height="5"></rect><rect x="14" y="12" width="7" height="9"></rect><rect x="3" y="16" width="7" height="5"></rect></svg>
          <span>Dashboard</span>
        </a>
        <a href="${this.raiz}paginas/admin/sala-controle/" class="ml-nav-item ${this.paginaAtiva === "sala-controle" ? "ativo" : ""}" data-nav="sala-controle">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>
          <span>Sala de controle</span>
        </a>

        <button class="ml-nav-item ml-expansor ${(this.paginaAtiva === "sensor" || this.paginaAtiva === "grupo") ? "ativo" : ""} ${this.sensoresExpandido ? "expandido" : ""}" data-acao="toggle-sensores" aria-expanded="${this.sensoresExpandido}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h6l2-3 4 6 2-3h6"></path></svg>
          <span>Sensores</span>
          <svg class="ml-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>

        <div class="ml-sublista" data-sublista ${this.sensoresExpandido ? "" : "hidden"}>
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

        <a href="${this.raiz}paginas/admin/agentes/" class="ml-nav-item ${this.paginaAtiva === "agentes" ? "ativo" : ""}" data-nav="agentes">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          <span>Agentes</span>
        </a>

        <a href="${this.raiz}paginas/admin/prototipo/" class="ml-nav-item ${this.paginaAtiva === "prototipo" ? "ativo" : ""}" data-nav="prototipo">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h7v7H3z"/><path d="M14 3h7v4h-7z"/><path d="M14 11h7v10h-7z"/><path d="M3 14h7v7H3z"/></svg>
          <span>Protótipo</span>
        </a>

        <a href="${this.raiz}paginas/admin/apresentacao/" class="ml-nav-item ${this.paginaAtiva === "apresentacao" ? "ativo" : ""}" data-nav="apresentacao">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
          <span>Apresentação</span>
        </a>
        <a href="${this.raiz}estudos/conectividade/" class="ml-nav-item ${this.paginaAtiva === "conectividade" ? "ativo" : ""}" data-nav="conectividade">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
          <span>Estudo Conectividade</span>
        </a>
      </nav>

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
        window.location.href = `${this.raiz}paginas/login/`;
      }
      if (acao === "toggle-sensores") {
        ev.preventDefault();
        this._alternarSensores();
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
        if (this.aoSelecionarSensor) {
          this.aoSelecionarSensor(id);
        } else {
          window.location.href = `${this.raiz}paginas/admin/sensores/${encodeURIComponent(id)}/index.html`;
        }
      }
    });
  }

  // ============ Expandir/colapsar lista de sensores ============
  _alternarSensores() {
    this.sensoresExpandido = !this.sensoresExpandido;
    const sub = this.raizEl.querySelector("[data-sublista]");
    const exp = this.raizEl.querySelector(".ml-expansor");
    if (sub) {
      if (this.sensoresExpandido) sub.removeAttribute("hidden");
      else sub.setAttribute("hidden", "");
    }
    if (exp) {
      exp.classList.toggle("expandido", this.sensoresExpandido);
      exp.setAttribute("aria-expanded", String(this.sensoresExpandido));
    }
  }

  // ============ Hamburger (abre/fecha menu inteiro) + backdrop ============
  _injetarToggle() {
    if (!document.querySelector(".ml-toggle")) {
      const btn = document.createElement("button");
      btn.className = "ml-toggle";
      btn.setAttribute("aria-label", "Abrir ou fechar menu");
      btn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="6"  x2="21" y2="6"></line>
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      `;
      btn.addEventListener("click", () => this._alternarMenu());
      document.body.appendChild(btn);
      this.toggleBtn = btn;
    }

    // Backdrop pra fechar o menu clicando fora (só ativo em mobile via CSS).
    // Importante: precisa estar DENTRO do .layout-admin pro seletor
    // ".layout-admin:not(.menu-fechado) .ml-backdrop" pegar.
    const host = this.raizEl.closest(".layout-admin") || document.body;
    if (!host.querySelector(":scope > .ml-backdrop")) {
      const bd = document.createElement("div");
      bd.className = "ml-backdrop";
      bd.setAttribute("aria-hidden", "true");
      bd.addEventListener("click", () => {
        const layout = this.raizEl.closest(".layout-admin");
        if (layout) {
          layout.classList.add("menu-fechado");
          localStorage.setItem("datacold_menu_fechado", "1");
        }
      });
      host.appendChild(bd);
    }
  }

  _aplicarEstadoMenu() {
    this.layoutEl = this.raizEl.closest(".layout-admin") || document.body;
    const salvo = localStorage.getItem("datacold_menu_fechado");
    // Em telas pequenas, o padrão é fechado. Em desktop, aberto.
    const fechado = salvo === null
      ? window.matchMedia("(max-width: 720px)").matches
      : salvo === "1";
    this.layoutEl.classList.toggle("menu-fechado", fechado);
  }

  _alternarMenu() {
    if (!this.layoutEl) return;
    const fechado = this.layoutEl.classList.toggle("menu-fechado");
    localStorage.setItem("datacold_menu_fechado", fechado ? "1" : "0");
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
      const ambAtivo = this.grupoAtivoId === gid ? "ativo" : "";
      html += `
        <a class="ml-ambiente ${ambAtivo}" href="${this.raiz}paginas/admin/grupos/${gid}/" data-grupo="${gid}" title="Abrir comparativo de ${grupo.label}">
          <span class="ml-ambiente-ico" data-amb="${gid}">${MenuLateral.ICONES_AMBIENTE[gid] || MenuLateral.ICONES_AMBIENTE._default}</span>
          <span class="ml-ambiente-nome">${grupo.label}</span>
          <span class="ml-ambiente-seta" aria-hidden="true">→</span>
        </a>
      `;
      doGrupo.forEach(s => {
        const ativo = this.sensorSelecionadoId === s.id ? "ativo" : "";
        html += `
          <a href="${this.raiz}paginas/admin/sensores/${encodeURIComponent(s.id)}/" class="ml-item ${ativo}" data-sensor="${s.id}" data-tipo="${s.tipo}">
            <span class="ml-tipo-ico tipo-${s.tipo}" aria-hidden="true">${MenuLateral.ICONES_TIPO[s.tipo] || ""}</span>
            <span class="ml-item-nome">${s.rotulo}</span>
          </a>
        `;
      });
    });

    lista.innerHTML = html || `<div class="ml-vazio">Sem sensores neste filtro.</div>`;
  }
}

MenuLateral.ICONES_TIPO = {
  energia:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
  temperatura: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4 4 0 1 0 5 0z"></path></svg>`,
  porta:       `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"></path><path d="M6 20V4h10v16"></path><circle cx="13" cy="12" r="1" fill="currentColor"></circle></svg>`,
};

MenuLateral.ICONES_AMBIENTE = {
  extrusao:              `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"></path><path d="M5 21V9l5 3V9l5 3V9l4 3v9"></path></svg>`,
  camara_congelados:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="5" y1="5" x2="19" y2="19"></line><line x1="19" y1="5" x2="5" y2="19"></line></svg>`,
  camara_estoque:        `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`,
  graxaria:              `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>`,
  externo_campo_grande:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>`,
  externo_tres_lagoas:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>`,
  _default:              `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle></svg>`,
};

if (typeof window !== "undefined") window.MenuLateral = MenuLateral;
