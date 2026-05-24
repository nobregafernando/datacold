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
  _exibir(opts) {
    const modo = opts.modo || (opts.meta?.reconstruido ? "estimado" : "real");
    this.el.dataset.modo = modo;

    // Cabeçalho varia por modo
    const eyebrow = this.el.querySelector(".modal-rec-eyebrow");
    const icone   = this.el.querySelector(".modal-rec-icon");
    if (modo === "real") {
      eyebrow.textContent = "Leitura real do sensor";
      icone.textContent = "📊";
    } else {
      eyebrow.textContent = "Ponto estimado pelo agente";
      icone.textContent = "🧩";
    }

    const titulo = opts.rotuloDataset || (modo === "real" ? "Leitura" : "Reconstrução");
    this.el.querySelector("[data-mr-titulo]").textContent = titulo;

    const html = modo === "real"
      ? this._montarHtmlReal(opts.pontoDados || {}, opts.sensorTipo, opts.dataPonto, opts.historico, opts.rotuloDataset, opts.valorPonto)
      : (opts.meta?.reconstruido
          ? this._montarHtml(opts.meta, opts.valorPonto, opts.dataPonto)
          : "");
    if (!html) return;
    this.el.querySelector("[data-mr-body]").innerHTML = html;

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

  // ------------------------------------------------------------------
  //  Modo "real" — mostra todos os campos do ponto + mini-análise
  // ------------------------------------------------------------------
  _montarHtmlReal(p, sensorTipo, dataPonto, historico, rotuloDataset, valorPonto) {
    const hPonto = dataPonto ? new Date(dataPonto).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      timeZone: "America/Sao_Paulo",
    }) : "—";

    // Mini-análise: valor atual vs. média dos pontos recentes do histórico.
    //
    // Otimização crítica: antes a função iterava sobre TODO o histórico
    // estendido (até 15k pontos × 3 campos = 45k iterações) e usava
    // Math.min(...arr) / Math.max(...arr) com spread, o que travava o
    // navegador ao abrir o modal. Agora:
    //  - Limita aos últimos 500 pontos (contexto "recente" não precisa
    //    de mais — 500 pts × 3s = ~25 min de janela, suficiente).
    //  - Single-pass pra média/min/máx (sem spread).
    const compararContexto = (campos) => {
      if (!Array.isArray(historico) || historico.length < 3) return null;
      const fatia = historico.length > 500
        ? historico.slice(historico.length - 500)
        : historico;
      let soma = 0, n = 0, min = Infinity, max = -Infinity;
      for (let i = 0; i < fatia.length; i++) {
        const ponto = fatia[i];
        if (!ponto || ponto._reconstruido) continue;
        for (let j = 0; j < campos.length; j++) {
          const v = ponto[campos[j]];
          if (typeof v === "number" && Number.isFinite(v)) {
            soma += v; n++;
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
      }
      if (n < 3) return null;
      const media = soma / n;
      // Valor atual: média dos campos do ponto clicado.
      let somaAtual = 0, nAtual = 0;
      for (let j = 0; j < campos.length; j++) {
        const v = p[campos[j]];
        if (typeof v === "number" && Number.isFinite(v)) { somaAtual += v; nAtual++; }
      }
      const atual = nAtual ? somaAtual / nAtual : null;
      return { media, min, max, atual };
    };

    let camposHtml = "";
    let analiseHtml = "";

    if (sensorTipo === "energia") {
      // Grid 3×3: fases × (corrente / tensão / FP)
      const linhas = ["a", "b", "c"].map(fase => `
        <tr>
          <td class="mr-real-fase">Fase ${fase.toUpperCase()}</td>
          <td>${this._fmt(p[`corrente_fase_${fase}`])} A</td>
          <td>${this._fmt(p[`tensao_fase_${fase}`])} V</td>
          <td>${this._fmt(p[`fator_potencia_${fase}`], 3)}</td>
        </tr>`).join("");

      camposHtml = `
        <div class="mr-real-tabela-wrap">
          <table class="mr-real-tabela">
            <thead>
              <tr><th></th><th>Corrente</th><th>Tensão</th><th>FP</th></tr>
            </thead>
            <tbody>${linhas}</tbody>
          </table>
        </div>`;

      // Potência ativa total calculada
      const pot = ((p.tensao_fase_a||0)*(p.corrente_fase_a||0)*(p.fator_potencia_a||0) +
                   (p.tensao_fase_b||0)*(p.corrente_fase_b||0)*(p.fator_potencia_b||0) +
                   (p.tensao_fase_c||0)*(p.corrente_fase_c||0)*(p.fator_potencia_c||0)) / 1000;

      // Mini-análise: comparar corrente média com histórico
      const ctx = compararContexto(["corrente_fase_a","corrente_fase_b","corrente_fase_c"]);
      if (ctx) {
        const delta = ctx.atual - ctx.media;
        const pct = Math.abs(delta / ctx.media) * 100;
        const seta = Math.abs(delta) < 0.5 ? "→" : delta > 0 ? "↑" : "↓";
        const corDelta = Math.abs(delta) < 0.5 ? "var(--texto-suave)" : delta > 0 ? "#d97706" : "#0a93c4";
        analiseHtml = `
          <div class="mr-real-analise">
            <div class="mr-real-analise-titulo">Comparação com o contexto recente</div>
            <div class="mr-real-analise-grid">
              <div><span class="mr-real-an-lbl">Corrente atual</span><span class="mr-real-an-val">${this._fmt(ctx.atual)} A</span></div>
              <div><span class="mr-real-an-lbl">Média recente</span><span class="mr-real-an-val">${this._fmt(ctx.media)} A</span></div>
              <div><span class="mr-real-an-lbl">Mín / Máx</span><span class="mr-real-an-val">${this._fmt(ctx.min)} / ${this._fmt(ctx.max)}</span></div>
              <div><span class="mr-real-an-lbl">Variação</span><span class="mr-real-an-val" style="color:${corDelta}">${seta} ${pct.toFixed(1)}%</span></div>
            </div>
          </div>
          <div class="mr-real-pot">Potência ativa total: <strong>${pot.toFixed(2)} kW</strong></div>`;
      } else {
        analiseHtml = `<div class="mr-real-pot">Potência ativa total: <strong>${pot.toFixed(2)} kW</strong></div>`;
      }
    }
    else if (sensorTipo === "temperatura") {
      const t = p.temperatura;
      camposHtml = `
        <div class="mr-real-destaque">
          <div class="mr-real-destaque-num">${this._fmt(t, 2)}<small> °C</small></div>
          <div class="mr-real-destaque-lbl">Temperatura medida</div>
        </div>`;
      const ctx = compararContexto(["temperatura"]);
      if (ctx) {
        const delta = ctx.atual - ctx.media;
        const seta = Math.abs(delta) < 0.05 ? "→" : delta > 0 ? "↑" : "↓";
        const corDelta = Math.abs(delta) < 0.05 ? "var(--texto-suave)" : delta > 0 ? "#d97706" : "#0a93c4";
        analiseHtml = `
          <div class="mr-real-analise">
            <div class="mr-real-analise-titulo">Comparação com o contexto recente</div>
            <div class="mr-real-analise-grid">
              <div><span class="mr-real-an-lbl">Atual</span><span class="mr-real-an-val">${this._fmt(t, 2)} °C</span></div>
              <div><span class="mr-real-an-lbl">Média recente</span><span class="mr-real-an-val">${this._fmt(ctx.media, 2)} °C</span></div>
              <div><span class="mr-real-an-lbl">Mín / Máx</span><span class="mr-real-an-val">${this._fmt(ctx.min, 2)} / ${this._fmt(ctx.max, 2)}</span></div>
              <div><span class="mr-real-an-lbl">Variação</span><span class="mr-real-an-val" style="color:${corDelta}">${seta} ${this._fmt(delta, 2)} °C</span></div>
            </div>
          </div>`;
      }
    }
    else if (sensorTipo === "porta") {
      const v = p.abertura_porta;
      const estado = v == null ? "—" : (v >= 0.5 ? "Aberta" : "Fechada");
      const cor = v == null ? "#5b6b86" : (v >= 0.5 ? "#d97706" : "#16a34a");
      camposHtml = `
        <div class="mr-real-destaque">
          <div class="mr-real-destaque-num" style="color:${cor}">${this._esc(estado)}</div>
          <div class="mr-real-destaque-lbl">Sinal: ${this._fmt(v, 2)}</div>
        </div>`;
    }
    else {
      // Fallback: lista todos os campos numéricos
      const items = Object.entries(p)
        .filter(([k, v]) => k !== "time" && !k.startsWith("_") && typeof v === "number")
        .map(([k, v]) => `<div><span class="mr-real-an-lbl">${this._esc(k)}</span><span class="mr-real-an-val">${this._fmt(v, 3)}</span></div>`)
        .join("");
      camposHtml = `<div class="mr-real-analise-grid">${items}</div>`;
    }

    return `
      <div class="mr-real-cabec">
        <div class="mr-real-quando">
          <span class="mr-real-quando-lbl">Leitura registrada em</span>
          <span class="mr-real-quando-val">${this._esc(hPonto)}</span>
        </div>
        ${rotuloDataset ? `<span class="mr-real-dataset">${this._esc(rotuloDataset)}</span>` : ""}
      </div>

      ${camposHtml}
      ${analiseHtml}

      <div class="mr-rodape-info">
        <span>📡 Leitura real enviada pelo sensor — sem estimativa</span>
      </div>
    `;
  }

  _fmt(v, casas = 1) {
    if (v == null || !Number.isFinite(v)) return "—";
    return Number(v).toFixed(casas);
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
