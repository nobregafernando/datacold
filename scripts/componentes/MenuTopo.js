/**
 * Menu superior reutilizável.
 *
 * Uso:
 *   const topo = new MenuTopo({ titulo: "Dashboard", raiz: "../../" });
 *   topo.montar("#menu-topo");
 *
 * Conteúdo:
 *  - Esquerda: breadcrumb/título contextual.
 *  - Direita: status da API + sino de alertas com dropdown.
 *
 * Alertas: por enquanto o painel é populado por uma lista mock no construtor.
 * Quando houver fonte real, basta chamar `topo.definirAlertas(lista)`.
 */
class MenuTopo {
  /**
   * @param {object} opts
   * @param {string} opts.titulo - título da página atual (ex: "Dashboard", "Sensor").
   * @param {string} opts.raiz   - prefixo relativo até a raiz do projeto.
   * @param {Array}  opts.alertas - lista inicial de alertas (opcional).
   */
  constructor({ titulo = "", raiz = "../../", alertas = null } = {}) {
    this.titulo = titulo;
    this.raiz = raiz;
    this.api = new ApiBEM();
    this.alertas = alertas || [];
    this.abertoDropdown = false;
  }

  montar(seletor) {
    this.raizEl = typeof seletor === "string" ? document.querySelector(seletor) : seletor;
    if (!this.raizEl) throw new Error(`MenuTopo: elemento "${seletor}" não encontrado.`);
    this.raizEl.classList.add("menu-topo");
    this._renderizar();
    this._ligarEventos();
    this._verificarStatusApi();
  }

  /** Substitui a lista de alertas e renderiza de novo. */
  definirAlertas(lista) {
    this.alertas = Array.isArray(lista) ? lista : [];
    this._renderizar();
    this._ligarEventos();
  }

  // ===================================================================
  //  Internos
  // ===================================================================

  _renderizar() {
    const naoLidos = this.alertas.filter(a => !a.lido).length;

    this.raizEl.innerHTML = `
      <div class="mt-esquerda">
        ${this.titulo ? `<span class="mt-titulo">${this.titulo}</span>` : ""}
      </div>

      <div class="mt-direita">
        <span class="mt-status" data-mt-status>
          <span class="mt-status-ponto"></span>
          <span data-mt-status-texto>verificando…</span>
        </span>

        <div class="mt-sino-wrap">
          <button class="mt-sino" data-mt-sino aria-label="Alertas" aria-expanded="${this.abertoDropdown}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
            ${naoLidos > 0 ? `<span class="mt-badge">${naoLidos > 9 ? "9+" : naoLidos}</span>` : ""}
          </button>

          <div class="mt-dropdown ${this.abertoDropdown ? 'aberto' : ''}" data-mt-dropdown>
            <header class="mt-dropdown-topo">
              <h4>Alertas</h4>
              ${this.alertas.length ? `<button class="mt-marcar-lidos" data-mt-marcar-lidos>Marcar todos como lidos</button>` : ""}
            </header>
            <div class="mt-dropdown-corpo">
              ${this._renderizarListaAlertas()}
            </div>
            <footer class="mt-dropdown-rodape">
              <span class="mt-info">Sistema de alertas em desenvolvimento.</span>
            </footer>
          </div>
        </div>
      </div>
    `;
  }

  _renderizarListaAlertas() {
    if (!this.alertas.length) {
      return `
        <div class="mt-vazio">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          <p>Nenhum alerta no momento</p>
          <span>Você está em dia.</span>
        </div>
      `;
    }
    return this.alertas.map(a => `
      <div class="mt-alerta ${a.severidade || 'info'} ${a.lido ? 'lido' : ''}">
        <span class="mt-alerta-marca"></span>
        <div class="mt-alerta-conteudo">
          <div class="mt-alerta-titulo">${a.titulo || "Alerta"}</div>
          ${a.mensagem ? `<div class="mt-alerta-msg">${a.mensagem}</div>` : ""}
          ${a.quando ? `<div class="mt-alerta-quando">${a.quando}</div>` : ""}
        </div>
      </div>
    `).join("");
  }

  _ligarEventos() {
    const sino = this.raizEl.querySelector("[data-mt-sino]");
    if (sino) sino.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._alternarDropdown();
    });

    const marcar = this.raizEl.querySelector("[data-mt-marcar-lidos]");
    if (marcar) marcar.addEventListener("click", () => {
      this.alertas = this.alertas.map(a => ({ ...a, lido: true }));
      this._renderizar();
      this._ligarEventos();
    });

    // fechar dropdown ao clicar fora
    document.addEventListener("click", (ev) => {
      if (!this.abertoDropdown) return;
      if (!this.raizEl.contains(ev.target)) {
        this.abertoDropdown = false;
        this.raizEl.querySelector("[data-mt-dropdown]")?.classList.remove("aberto");
      }
    });
  }

  _alternarDropdown() {
    this.abertoDropdown = !this.abertoDropdown;
    this.raizEl.querySelector("[data-mt-dropdown]").classList.toggle("aberto", this.abertoDropdown);
  }

  async _verificarStatusApi() {
    const pill  = this.raizEl.querySelector("[data-mt-status]");
    const texto = this.raizEl.querySelector("[data-mt-status-texto]");
    if (!texto) return;
    try {
      const saude = await this.api.verificarSaude();
      texto.textContent = saude.demo_mode ? "API · modo demo" : "API · dados reais";
      pill?.classList.add("ok");
    } catch {
      texto.textContent = "API offline";
      pill?.classList.add("erro");
    }
  }
}

if (typeof window !== "undefined") window.MenuTopo = MenuTopo;
