/**
 * Menu superior reutilizável (sticky no topo de cada página interna).
 *
 * Conteúdo:
 *  - Esquerda: título contextual da página.
 *  - Direita: status da API + sino de alertas com dropdown.
 *
 * O sino é alimentado pelo serviço `Notificacoes` (singleton em
 * scripts/nucleo/Notificacoes.js). Para mandar uma notificação a partir de
 * qualquer página, use:
 *
 *    Notificacoes.critica("Sensor offline", "extrusora_1 sem leitura há 12min");
 *    Notificacoes.alta("FP baixo", "extrusora_2: FP=0.45");
 *    Notificacoes.media("Calibração pendente", "...");
 *    Notificacoes.comum("Sincronização concluída", "...");
 *
 * Veja o cabeçalho de Notificacoes.js para a documentação completa.
 *
 * O MenuTopo se inscreve automaticamente — nenhum método dele precisa ser
 * chamado quando uma notificação é enviada.
 */
class MenuTopo {
  /**
   * @param {object} opts
   * @param {string} opts.titulo - título contextual da página.
   * @param {string} opts.raiz   - prefixo relativo até a raiz do projeto.
   */
  constructor({ titulo = "", raiz = "../../" } = {}) {
    this.titulo = titulo;
    this.raiz = raiz;
    this.api = new ApiBEM();
    this.abertoDropdown = false;
    this._cancelarAssinatura = null;
  }

  montar(seletor) {
    this.raizEl = typeof seletor === "string" ? document.querySelector(seletor) : seletor;
    if (!this.raizEl) throw new Error(`MenuTopo: elemento "${seletor}" não encontrado.`);
    this.raizEl.classList.add("menu-topo");

    this._renderizar();
    this._ligarEventosEstaticos();
    this._verificarStatusApi();

    // Inscrição automática no sistema de notificações
    this._cancelarAssinatura = Notificacoes.assinar(() => this._reRenderizarDropdown());
  }

  desmontar() {
    if (this._cancelarAssinatura) this._cancelarAssinatura();
  }

  // ===================================================================
  //  Render
  // ===================================================================

  _renderizar() {
    this.raizEl.innerHTML = `
      <div class="mt-esquerda">
        ${this.titulo ? `<span class="mt-titulo">${this.titulo}</span>` : ""}
      </div>

      <div class="mt-direita">
        <span class="mt-status" data-mt-status>
          <span class="mt-status-ponto"></span>
          <span data-mt-status-texto>verificando…</span>
        </span>

        <div class="mt-sino-wrap" data-mt-sino-wrap>
          ${this._htmlSino()}
        </div>
      </div>
    `;
  }

  /** Re-renderiza só o bloco do sino (mantém status da API). */
  _reRenderizarDropdown() {
    const wrap = this.raizEl?.querySelector("[data-mt-sino-wrap]");
    if (!wrap) return;
    wrap.innerHTML = this._htmlSino();
    this._ligarEventosSino();
  }

  _htmlSino() {
    const lista = Notificacoes.listar();
    const naoLidos = lista.filter(n => !n.lido).length;
    const temCritica = lista.some(n => n.severidade === "critica" && !n.lido);

    return `
      <button class="mt-sino ${temCritica ? 'tem-critica' : ''}"
              data-mt-sino
              aria-label="Alertas"
              aria-expanded="${this.abertoDropdown}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
        ${naoLidos > 0 ? `<span class="mt-badge ${temCritica ? 'pulsar' : ''}">${naoLidos > 9 ? "9+" : naoLidos}</span>` : ""}
      </button>

      <div class="mt-dropdown ${this.abertoDropdown ? 'aberto' : ''}" data-mt-dropdown>
        <header class="mt-dropdown-topo">
          <h4>Notificações ${lista.length ? `<span class="mt-contagem">${lista.length}</span>` : ""}</h4>
          <div class="mt-dropdown-acoes">
            ${naoLidos > 0 ? `<button class="mt-link-acao" data-mt-marcar-lidos>Marcar todas como lidas</button>` : ""}
            ${lista.length > 0 ? `<button class="mt-link-acao" data-mt-limpar>Limpar</button>` : ""}
          </div>
        </header>
        <div class="mt-dropdown-corpo">
          ${this._htmlLista(lista)}
        </div>
        <footer class="mt-dropdown-rodape">
          <span class="mt-info">
            Use <code>Notificacoes.critica/alta/media/comum()</code> em qualquer página.
          </span>
        </footer>
      </div>
    `;
  }

  _htmlLista(lista) {
    if (!lista.length) {
      return `
        <div class="mt-vazio">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          <p>Sem notificações</p>
          <span>Quando o sistema detectar algo, vai aparecer aqui.</span>
        </div>
      `;
    }

    return lista.map(n => {
      const origem = n.origem
        ? `<div class="mt-alerta-origem">${this._iconeOrigem(n.origem)}<span>${n.origem.label || n.origem.id || n.origem.tipo}</span></div>`
        : "";
      const acao = n.acao
        ? `<a class="mt-alerta-acao" href="${n.acao.url}">${n.acao.texto || "abrir"} →</a>`
        : "";

      return `
        <div class="mt-alerta severidade-${n.severidade} ${n.lido ? 'lido' : ''}"
             data-mt-alerta="${n.id}">
          <span class="mt-alerta-marca"></span>
          <div class="mt-alerta-conteudo">
            <div class="mt-alerta-topo">
              <span class="mt-alerta-titulo">${this._escapar(n.titulo)}</span>
              <span class="mt-alerta-pill">${Notificacoes.rotuloSeveridade(n.severidade)}</span>
            </div>
            ${n.mensagem ? `<div class="mt-alerta-msg">${this._escapar(n.mensagem)}</div>` : ""}
            ${origem}
            <div class="mt-alerta-rodape">
              <span class="mt-alerta-quando">${Notificacoes.formatarQuando(n.criadoEm)}</span>
              ${acao}
              <button class="mt-alerta-remover" data-mt-remover="${n.id}" aria-label="Remover">×</button>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  _iconeOrigem(origem) {
    if (origem.tipo === "sensor") {
      return `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v6m0 10v6M4.22 4.22l4.24 4.24m7.07 7.07l4.24 4.24M1 12h6m10 0h6M4.22 19.78l4.24-4.24m7.07-7.07l4.24-4.24"></path></svg>`;
    }
    return `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle></svg>`;
  }

  _escapar(s = "") {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ===================================================================
  //  Eventos
  // ===================================================================

  _ligarEventosEstaticos() {
    // Fecha dropdown ao clicar fora — registrado uma vez só.
    document.addEventListener("click", (ev) => {
      if (!this.abertoDropdown) return;
      if (!this.raizEl.contains(ev.target)) {
        this.abertoDropdown = false;
        this._reRenderizarDropdown();
      }
    });
    this._ligarEventosSino();
  }

  _ligarEventosSino() {
    const wrap = this.raizEl.querySelector("[data-mt-sino-wrap]");
    if (!wrap) return;

    const sino = wrap.querySelector("[data-mt-sino]");
    if (sino) sino.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.abertoDropdown = !this.abertoDropdown;
      this._reRenderizarDropdown();
    });

    wrap.querySelector("[data-mt-marcar-lidos]")?.addEventListener("click", () => {
      Notificacoes.marcarTodosLidos();
    });

    wrap.querySelector("[data-mt-limpar]")?.addEventListener("click", () => {
      Notificacoes.limpar();
    });

    wrap.querySelectorAll("[data-mt-remover]").forEach(btn => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        Notificacoes.remover(btn.dataset.mtRemover);
      });
    });

    wrap.querySelectorAll("[data-mt-alerta]").forEach(el => {
      el.addEventListener("click", () => {
        const id = el.dataset.mtAlerta;
        Notificacoes.marcarComoLido(id);
      });
    });
  }

  // ===================================================================
  //  Status API
  // ===================================================================

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
      Notificacoes.alta(
        "API indisponível",
        "Não foi possível alcançar a API da BEM. Verifique sua conexão.",
        { origem: { tipo: "sistema", label: "Conexão" } }
      );
    }
  }
}

if (typeof window !== "undefined") window.MenuTopo = MenuTopo;
