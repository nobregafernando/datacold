/**
 * ModalReconstrucao — popup flutuante (não-bloqueante) que mostra
 * detalhes de um ponto reconstruído pelo AgenteReconstrutor.
 *
 * Características:
 *  - Singleton: uma única instância no DOM; reutilizada a cada abertura.
 *  - Arrastável pelo header. Posição preservada em sessão.
 *  - NÃO bloqueia a tela (sem backdrop). Usuário continua interagindo
 *    com o gráfico atrás e pode abrir outro ponto sem fechar este.
 *  - Auto-update: se o usuário clicar em outro ponto, o conteúdo
 *    do modal aberto é trocado em vez de abrir outra janela.
 *  - Fecha com X, ESC ou clique no botão "Fechar".
 *
 * Uso:
 *   ModalReconstrucao.abrir({
 *     meta: ponto._meta,           // do agente
 *     rotuloDataset: "Fase A",     // de qual linha/série veio
 *     valorPonto: 128.5,           // o valor no eixo Y
 *     dataPonto: "2026-05-24T12:30:00Z",  // o time do ponto
 *   });
 */
class ModalReconstrucao {

  static _instancia = null;

  /** Singleton. Cria o DOM uma vez. */
  static _obter() {
    if (!ModalReconstrucao._instancia) {
      ModalReconstrucao._instancia = new ModalReconstrucao();
      ModalReconstrucao._instancia._criar();
    }
    return ModalReconstrucao._instancia;
  }

  static abrir(opts) {
    ModalReconstrucao._obter()._exibir(opts);
  }

  static fechar() {
    ModalReconstrucao._obter()._esconder();
  }

  // ------------------------------------------------------------------
  //  DOM
  // ------------------------------------------------------------------
  _criar() {
    const el = document.createElement("div");
    el.className = "modal-rec";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Detalhes da reconstrução");
    el.hidden = true;
    el.innerHTML = `
      <header class="modal-rec-head" data-arrastar>
        <div class="modal-rec-icon">🧩</div>
        <div class="modal-rec-titulo">
          <div class="modal-rec-eyebrow">Ponto estimado pelo agente</div>
          <div class="modal-rec-h" data-mr-titulo>Detalhes</div>
        </div>
        <button type="button" class="modal-rec-fechar" data-mr-fechar aria-label="Fechar">×</button>
      </header>
      <div class="modal-rec-body" data-mr-body></div>
      <footer class="modal-rec-foot">
        <span class="modal-rec-dica">📌 Arraste pelo cabeçalho · ESC fecha</span>
        <button type="button" class="modal-rec-btn" data-mr-fechar>Fechar</button>
      </footer>
    `;
    document.body.appendChild(el);
    this.el = el;

    // Fechar (X, ESC, botão)
    el.querySelectorAll("[data-mr-fechar]").forEach(b =>
      b.addEventListener("click", () => this._esconder())
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !el.hidden) this._esconder();
    });

    // Arrastar pelo header
    this._ligarArrastar(el.querySelector("[data-arrastar]"));
  }

  _ligarArrastar(handle) {
    let arrastando = false, dx = 0, dy = 0;
    const onDown = (e) => {
      // Ignora clique no botão de fechar
      if (e.target.closest("[data-mr-fechar]")) return;
      arrastando = true;
      const r = this.el.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      dx = p.clientX - r.left;
      dy = p.clientY - r.top;
      // Trava de transição enquanto arrasta
      this.el.style.transition = "none";
      document.body.style.userSelect = "none";
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!arrastando) return;
      const p = e.touches ? e.touches[0] : e;
      const x = p.clientX - dx;
      const y = p.clientY - dy;
      // Limites: não deixa sair da tela
      const w = this.el.offsetWidth, h = this.el.offsetHeight;
      const maxX = window.innerWidth  - w - 8;
      const maxY = window.innerHeight - h - 8;
      this.el.style.left   = `${Math.max(8, Math.min(maxX, x))}px`;
      this.el.style.top    = `${Math.max(8, Math.min(maxY, y))}px`;
      this.el.style.right  = "auto";
      this.el.style.bottom = "auto";
    };
    const onUp = () => {
      if (!arrastando) return;
      arrastando = false;
      this.el.style.transition = "";
      document.body.style.userSelect = "";
      // Persiste posição no sessionStorage
      try {
        sessionStorage.setItem("modal-rec-pos", JSON.stringify({
          left: this.el.style.left, top: this.el.style.top,
        }));
      } catch {}
    };

    handle.addEventListener("mousedown", onDown);
    handle.addEventListener("touchstart", onDown, { passive: false });
    document.addEventListener("mousemove", onMove);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchend", onUp);
  }

  // ------------------------------------------------------------------
  //  Conteúdo
  // ------------------------------------------------------------------
  _exibir({ meta, rotuloDataset, valorPonto, dataPonto }) {
    if (!meta || !meta.reconstruido) return;
    const titulo = rotuloDataset || "Reconstrução";
    this.el.querySelector("[data-mr-titulo]").textContent = titulo;
    this.el.querySelector("[data-mr-body]").innerHTML = this._montarHtml(meta, valorPonto, dataPonto);

    // Restaura posição salva, senão usa default (canto inferior-direito)
    const salva = (() => {
      try { return JSON.parse(sessionStorage.getItem("modal-rec-pos") || "null"); }
      catch { return null; }
    })();
    if (salva?.left && salva?.top) {
      this.el.style.left = salva.left;
      this.el.style.top  = salva.top;
      this.el.style.right = "auto";
      this.el.style.bottom = "auto";
    }
    this.el.hidden = false;
  }

  _esconder() {
    if (!this.el) return;
    this.el.hidden = true;
  }

  _montarHtml(meta, valorPonto, dataPonto) {
    const conf = Math.round((meta.confianca || 0) * 100);
    const confCor = conf >= 85 ? "#16a34a" : conf >= 70 ? "#65a30d" : conf >= 55 ? "#d97706" : "#dc2626";
    const dur = this._formatarDuracao(meta.duracao_s);

    const NOMES_ESTR = {
      splc_semanal:  { nome: "Janela semanal",          icone: "📅", descr: "Mesmo dia da semana + mesmo horário em semanas anteriores" },
      splc_diario:   { nome: "Mesmo horário (24h atrás)", icone: "🕐", descr: "Média do mesmo horário no dia anterior" },
      splc_mensal:   { nome: "Média móvel de 30 dias",   icone: "📈", descr: "Tendência mensal no horário-alvo" },
      media:         { nome: "Média estável",            icone: "≈",  descr: "Média do contexto adjacente ao gap" },
      step:          { nome: "Último estado conhecido",  icone: "↺",  descr: "Mantém o valor anterior ao gap" },
      interpolacao:  { nome: "Interpolação linear",      icone: "／", descr: "Linha reta entre as âncoras (fallback)" },
    };
    const e = NOMES_ESTR[meta.estrategia_principal] || NOMES_ESTR.interpolacao;

    // Detalhes por campo (corrente_fase_a, tensao_fase_b, etc.)
    const camposHtml = (() => {
      if (!meta.metasPorCampo) return "";
      const linhas = Object.entries(meta.metasPorCampo).map(([k, info]) => {
        const c = Math.round((info.confianca || 0) * 100);
        const ne = NOMES_ESTR[info.estrategia] || { nome: info.estrategia, icone: "·" };
        return `
          <li class="mr-campo">
            <span class="mr-campo-nome">${ne.icone} ${this._esc(k)}</span>
            <span class="mr-campo-estr">${this._esc(ne.nome)}</span>
            <span class="mr-campo-conf">${c}%</span>
          </li>`;
      });
      return `
        <details class="mr-secao">
          <summary>Detalhamento por campo (${linhas.length})</summary>
          <ul class="mr-campos-lista">${linhas.join("")}</ul>
        </details>`;
    })();

    const hPonto = dataPonto ? new Date(dataPonto).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    }) : "—";

    return `
      <!-- Confiabilidade destacada -->
      <div class="mr-conf">
        <div class="mr-conf-num" style="color:${confCor}">${conf}<small>%</small></div>
        <div class="mr-conf-lbl">Confiabilidade</div>
      </div>

      <!-- Identificação do ponto -->
      <div class="mr-grade">
        <div class="mr-bloco">
          <div class="mr-bloco-lbl">Momento estimado</div>
          <div class="mr-bloco-val">${this._esc(hPonto)}</div>
        </div>
        <div class="mr-bloco">
          <div class="mr-bloco-lbl">Valor reconstruído</div>
          <div class="mr-bloco-val mr-bloco-num">${valorPonto != null ? this._esc(String(valorPonto)) : "—"}</div>
        </div>
        <div class="mr-bloco">
          <div class="mr-bloco-lbl">Dia da semana</div>
          <div class="mr-bloco-val">${this._esc(meta.dia_semana || "—")}</div>
        </div>
        <div class="mr-bloco">
          <div class="mr-bloco-lbl">Janela horária do gap</div>
          <div class="mr-bloco-val">${this._esc(meta.janela_horaria || "—")}</div>
        </div>
        <div class="mr-bloco">
          <div class="mr-bloco-lbl">Duração do gap</div>
          <div class="mr-bloco-val">${this._esc(dur)}</div>
        </div>
        <div class="mr-bloco">
          <div class="mr-bloco-lbl">Âncoras (antes / depois)</div>
          <div class="mr-bloco-val">${meta.nAntes || 0} / ${meta.nDepois || 0} pontos</div>
        </div>
      </div>

      <!-- Estratégia principal -->
      <div class="mr-estr">
        <div class="mr-estr-head">
          <span class="mr-estr-icone">${e.icone}</span>
          <div>
            <div class="mr-estr-lbl">Método de reconstrução</div>
            <div class="mr-estr-nome">${this._esc(e.nome)}</div>
          </div>
        </div>
        <div class="mr-estr-descr">${this._esc(e.descr)}</div>
        ${meta.periodo_base_descricao ? `
          <div class="mr-estr-base">
            <strong>Base de cálculo:</strong> ${this._esc(meta.periodo_base_descricao)}
          </div>` : ""}
        ${meta.n_semanas_usadas ? `
          <div class="mr-estr-amostras">
            <strong>${meta.n_semanas_usadas}</strong> semana${meta.n_semanas_usadas > 1 ? "s" : ""} de histórico utilizada${meta.n_semanas_usadas > 1 ? "s" : ""}
          </div>` : ""}
      </div>

      ${camposHtml}

      <div class="mr-rodape-info">
        <span>🧠 Reconstruído pelo <strong>AgenteReconstrutor</strong></span>
      </div>
    `;
  }

  _formatarDuracao(s) {
    if (s == null) return "—";
    if (s < 60)    return `${Math.round(s)} seg`;
    if (s < 3600)  return `${Math.round(s / 60)} min`;
    if (s < 86400) return `${(s / 3600).toFixed(1)} h`;
    return `${(s / 86400).toFixed(1)} dias`;
  }

  _esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;",
    }[c]));
  }
}

if (typeof window !== "undefined") window.ModalReconstrucao = ModalReconstrucao;
