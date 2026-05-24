/**
 * Página de um sensor específico.
 *
 * Responsabilidades:
 *  - Resolver o id do sensor a partir do nome da pasta na URL.
 *  - Montar menu lateral, menu topo e cabeçalho.
 *  - Carregar dados da API BEM e renderizar conectividade, KPIs, gráficos,
 *    tabela, latência e parâmetros.
 *  - Disparar notificações automaticamente quando o detector local
 *    identificar anomalias.
 *  - Atualizar a cada 30s (pausa quando a aba está escondida).
 *
 * Catálogo descritivo (parâmetros, tipos de alerta, faixas térmicas)
 * fica neste mesmo arquivo, em constantes no topo da classe.
 */
class PaginaSensor {

  // =================================================================
  //  Constantes descritivas
  // =================================================================

  /** O que cada campo bruto da API significa. */
  static PARAMETROS = {
    corrente_fase_a: { desc: "Corrente RMS da fase A",          unidade: "A" },
    corrente_fase_b: { desc: "Corrente RMS da fase B",          unidade: "A" },
    corrente_fase_c: { desc: "Corrente RMS da fase C",          unidade: "A" },
    tensao_fase_a:   { desc: "Tensão fase-neutro A",            unidade: "V" },
    tensao_fase_b:   { desc: "Tensão fase-neutro B",            unidade: "V" },
    tensao_fase_c:   { desc: "Tensão fase-neutro C",            unidade: "V" },
    fator_potencia_a:{ desc: "Fator de potência da fase A",     unidade: "—" },
    fator_potencia_b:{ desc: "Fator de potência da fase B",     unidade: "—" },
    fator_potencia_c:{ desc: "Fator de potência da fase C",     unidade: "—" },
    temperatura:     { desc: "Temperatura interna do ambiente", unidade: "°C" },
    abertura_porta:  { desc: "Sinal bruto do sensor de porta",  unidade: "—" },
  };

  /** Faixas térmicas por grupo (usadas em alertas de temperatura). */
  static FAIXAS_TERMICAS = {
    camara_congelados:  { min: -28, max: -18, label: "câmara de congelados (-28 a -18°C)" },
    camara_estoque:     { min:  -4, max:   4, label: "câmara fria de estoque (-4 a 4°C)" },
    graxaria:           { min: -10, max:   4, label: "câmara da graxaria (-10 a 4°C)" },
  };

  /** Tipos de alerta que cada tipo de sensor pode disparar. */
  static TIPOS_ALERTA = {
    energia: [
      { sev: "alta",    t: "FP baixo (<0,92)",        d: "Fator de potência abaixo do mínimo ANEEL — concessionária multa." },
      { sev: "critica", t: "FP muito baixo (<0,85)",  d: "Banco de capacitores queimado, motor sem correção, multa pesada." },
      { sev: "critica", t: "Fluxo reverso (FP negativo)", d: "Fiação do medidor invertida ou geração não autorizada." },
      { sev: "alta",    t: "%CUB > 10% (desequilíbrio de corrente)", d: "NEMA MG-1 zona crítica. Motor sob risco." },
      { sev: "alta",    t: "%VUB > 2% (desequilíbrio de tensão)",    d: "Reduz a vida do motor (regra de Arrhenius)." },
      { sev: "media",   t: "Pico de corrente",        d: "Pode indicar rolamento, contator degradando, ou partida em falha." },
      { sev: "media",   t: "Consumo noturno alto",    d: "Suspeita de phantom load — equipamento ligado fora do expediente." },
    ],
    temperatura: [
      { sev: "critica", t: "Superaquecimento",            d: "Temperatura acima da faixa segura por tempo prolongado." },
      { sev: "critica", t: "Leitura impossível",          d: "Valor fora do envelope físico (ex: +85°C em câmara fria). Sensor com defeito." },
      { sev: "alta",    t: "Fora da faixa controlada",    d: "Média do período fora dos limites do tipo de câmara." },
      { sev: "media",   t: "Oscilação alta (σ > limiar)", d: "Setpoint mal ajustado, short-cycling ou interferência no sensor." },
      { sev: "media",   t: "Lacunas longas na telemetria",d: "Link instável, gateway cheio ou bateria fraca." },
    ],
    porta: [
      { sev: "alta",    t: "Porta esquecida aberta",     d: "Mais de 10 minutos aberta — toda a câmara perde frio." },
      { sev: "media",   t: "Aberturas anormalmente longas", d: "Mediana acima do esperado. Vedação ou procedimento ruim." },
      { sev: "media",   t: "Mudança brusca de frequência", d: "Padrão de aberturas mudou — turno novo ou problema mecânico." },
      { sev: "comum",   t: "Sensor não-binário",         d: "Sinal intermediário pode ser analógico — confirmar configuração." },
    ],
  };

  // =================================================================
  //  Construtor / extrator de id
  // =================================================================

  constructor() {
    this.api = new ApiBEM();
    this.sensorId = PaginaSensor._extrairIdDaUrl();
    this.sensor = null;
    this.grupo = null;
    this.dados = null;
    this.incidentesAtivos = [];
    this.janela = "-1h";
    this.graficos = {};          // chave -> Chart (re-usados entre refreshes)
    this._tipoGraficoAtual = null;
    this.autoTimer = null;
    this.autoIntervalo = 2000;   // tick "leve" (incidentes + último valor) a cada 2s
    this.intervaloPesado = 6000; // tick "pesado" (gráficos/tabela) a cada 6s
    this._ultimoCarregamentoPesado = 0;
    this.carregando = false;
  }

  static _extrairIdDaUrl() {
    const partes = window.location.pathname.split("/").filter(Boolean);
    const idx = partes.indexOf("sensores");
    return idx >= 0 ? partes[idx + 1] : null;
  }

  // =================================================================
  //  Boot
  // =================================================================

  async iniciar() {
    if (!Autenticacao.protegerPagina("../../../login//")) return;

    this.menu = new MenuLateral({ paginaAtiva: "sensor", raiz: "../../../../" });
    await this.menu.montar("#menu-lateral");
    if (this.sensorId) this.menu.destacarSensor(this.sensorId);

    this.sensor = this.menu.sensores.find(s => s.id === this.sensorId) || null;
    this.grupo  = this.menu.grupos.find(g => g.id === this.sensor?.grupo) || null;

    // Carrega parâmetros configurados no Supabase (sobrepõem defaults do agente).
    // Mescla no próprio objeto sensor pra que AnalisadorSensor / agentes vejam tudo
    // via `sensor.parametros`. Falha silenciosa: se Supabase fora, segue com {}.
    if (this.sensor) {
      try {
        const params = await new ApiBEM().obterParametrosSensor(this.sensor.id);
        this.sensor.parametros = { ...(this.sensor.parametros || {}), ...(params || {}) };
      } catch (e) {
        console.warn("[sensor] não foi possível carregar parametros:", e);
        this.sensor.parametros = this.sensor.parametros || {};
      }
    }

    this.topo = new MenuTopo({
      titulo: this.sensor ? `Sensor · ${this.sensor.rotulo}` : "Sensor",
      raiz: "../../../../",
    });
    this.topo.montar("#menu-topo");

    // Histórico abre numa janela mais larga por padrão
    if (this.sensor?.historico) this.janela = "-167h";

    this._renderizarCabecalho();
    this._renderizarParametros();
    this._renderizarTiposDeAlerta();
    this._renderizarAlertasDoSensor();
    this._renderizarAnaliseVazia();
    this._ligarEventos();

    // Atualiza painel "alertas deste sensor" quando o store muda em qualquer página.
    this._cancelarAssinatura = Notificacoes.assinar(() => this._renderizarAlertasDoSensor());

    // Marca janela inicial no seletor
    this._marcarJanelaAtiva();

    await this._carregarDados();
    this._armarAutoRefresh();
  }

  // =================================================================
  //  Cabeçalho
  // =================================================================

  _renderizarCabecalho() {
    const elTipo  = document.querySelector("[data-tipo-sensor]");
    const elNome  = document.querySelector("[data-nome-sensor]");
    const elGrupo = document.querySelector("[data-grupo-sensor]");
    const elMeta  = document.querySelector("[data-meta-topo]");

    if (!this.sensor) {
      elNome.textContent = "Sensor não encontrado";
      elTipo.textContent = "—";
      elGrupo.textContent = `id "${this.sensorId || "(vazio)"}" não está no catálogo`;
      elMeta.innerHTML = "";
      return;
    }

    const s = this.sensor;
    elTipo.textContent  = s.tipo;
    elNome.textContent  = s.rotulo;
    elGrupo.textContent = this.grupo ? this.grupo.label : s.grupo;
    elMeta.innerHTML = `
      <span class="tag-id">${s.id}</span>
      <span class="tag-tipo-grande ${s.tipo}">${s.tipo}</span>
      <span class="tag-status ${s.status}">${s.status}</span>
    `;
    document.title = `DataCold · ${s.rotulo}`;
  }

  // =================================================================
  //  Eventos
  // =================================================================

  _ligarEventos() {
    // seletor de janela
    document.querySelectorAll("[data-janela]").forEach(b => {
      b.addEventListener("click", () => {
        this.janela = b.dataset.janela;
        this._marcarJanelaAtiva();
        this._carregarDados(true);  // força pesado — mudou o intervalo
      });
    });

    // botão atualizar
    document.querySelector("[data-acao='atualizar']")?.addEventListener("click", () => this._carregarDados(true));

    // banner chave
    document.querySelector("[data-acao='salvar-chave']")?.addEventListener("click", () => this._salvarChave());
    document.querySelector("[data-chave-input]")?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") this._salvarChave();
    });

    // pausa auto-refresh quando aba não visível
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this._pararAutoRefresh();
      else                 this._armarAutoRefresh();
    });

    // Cross-tab: se a Sala de Controle injetar/cancelar incidente, atualiza JÁ.
    if ("BroadcastChannel" in window) {
      try {
        this._canalSala = new BroadcastChannel("datacold-sala-controle");
        this._canalSala.onmessage = (ev) => {
          if (ev?.data?.tipo === "mudanca-incidente") this._carregarDados(true);
        };
      } catch {}
    }
  }

  _marcarJanelaAtiva() {
    document.querySelectorAll("[data-janela]").forEach(b => {
      b.classList.toggle("ativo", b.dataset.janela === this.janela);
    });
  }

  _salvarChave() {
    const input = document.querySelector("[data-chave-input]");
    const val = input?.value.trim();
    if (!val) return;
    this.api.chave = val;
    document.querySelector("[data-aviso-chave]").hidden = true;
    this._carregarDados();
  }

  // =================================================================
  //  Auto-refresh
  // =================================================================

  _armarAutoRefresh() {
    this._pararAutoRefresh();
    // Refresh imediato (se o último foi >2s atrás) pra não esperar 3s a toa
    // quando a aba volta a ficar visível.
    const desdeUltimo = Date.now() - (this._ultimoCarregamentoEm || 0);
    if (desdeUltimo > 2000) this._carregarDados();
    this.autoTimer = setInterval(() => this._carregarDados(), this.autoIntervalo);
    document.querySelector("[data-aovivo]")?.classList.remove("pausado");
  }

  _pararAutoRefresh() {
    if (this.autoTimer) clearInterval(this.autoTimer);
    this.autoTimer = null;
    document.querySelector("[data-aovivo]")?.classList.add("pausado");
  }

  // =================================================================
  //  Carregamento de dados
  // =================================================================

  /**
   * Calcula um limite de pontos suficiente pra cobrir a janela escolhida,
   * assumindo cadência conservadora de 30s (pior caso, sensor de energia).
   * Evita o bug antigo de truncar 24h/3d/7d em 1000 pontos.
   */
  _limitePorJanela(janela) {
    const m = /^-(\d+(?:\.\d+)?)([smhd])$/.exec(janela);
    if (!m) return 1000;
    const n = parseFloat(m[1]);
    const seg = m[2] === "s" ? n
              : m[2] === "m" ? n * 60
              : m[2] === "h" ? n * 3600
              : n * 86400;
    // Cadência mais densa = energia (30s). Margem 10%.
    const estimado = Math.ceil(seg / 30 * 1.1);
    // Mínimo 500, máximo 25 000 (Chart.js fica lento acima disso)
    return Math.min(25000, Math.max(500, estimado));
  }

  /**
   * Busca histórico estendido (30 dias) em background, cacheado por 5 min.
   * Esse histórico alimenta o AgenteReconstrutor pra fazer SPLC com
   * ciclos de 24h, 7d e 30d. Sem 30d carregado, o ciclo 30d sempre falha.
   *
   * Tamanho típico: ~40k pontos por sensor (cadência 60s × 30 dias).
   * Cache de 5 min é suficiente — histórico não muda na escala de segundos.
   */
  async _garantirHistoricoEstendido() {
    const agora = Date.now();
    const idadeCache = agora - (this._historicoEstendidoEm || 0);
    if (idadeCache < 5 * 60_000 && this._historicoEstendido) return;
    if (this._historicoEstendidoCarregando) return;
    this._historicoEstendidoCarregando = true;
    try {
      const r = await this.api.buscarDados(this.sensorId, {
        inicio: "-720h",          // 30 dias
        fim: "now",
        limite: 100000,
      });
      this._historicoEstendido = r?.points || [];
      this._historicoEstendidoEm = agora;
    } catch (e) {
      // silencioso — reconstrutor cai pra fallback de interpolação
    } finally {
      this._historicoEstendidoCarregando = false;
    }
  }

  /**
   * Refresh em duas pistas:
   *  - LEVE (default): só incidentes + último ponto. Roda a cada `autoIntervalo`
   *    (2s). Pinta banner/badge/KPIs/incidentes — tudo que precisa ser instantâneo.
   *  - PESADO: leve + janela completa de pontos + gráficos/tabela/análise.
   *    Roda a cada `intervaloPesado` (6s) ou quando forçado (ex.: trocou
   *    janela, broadcast de incidente, clique em "atualizar").
   *
   * O `forcado=true` força um PESADO mesmo dentro da janela leve.
   */
  async _carregarDados(forcado = false) {
    if (this.carregando) return;
    if (!this.sensor) return;    // (banner de chave removido — chave padrão hardcoded em ApiBEM)

    const agora = Date.now();
    const desdePesado = agora - (this._ultimoCarregamentoPesado || 0);
    const fazerPesado = forcado || desdePesado >= this.intervaloPesado || !this.dados;

    this.carregando = true;
    try {
      let inicio = this.janela;
      let fim    = "now";
      if (this.sensor.historico && !["-72h","-167h","-24h"].includes(inicio)) {
        inicio = "-90d";
        fim    = "-30d";
      }

      // ----- TICK LEVE: só último ponto + incidentes -----
      if (!fazerPesado) {
        const [leve, incidentes] = await Promise.all([
          this.api.buscarDados(this.sensorId, { inicio: "-5m", fim: "now", limite: 30 }),
          this.api.incidentesAtivos(this.sensorId),
        ]);
        this.incidentesAtivos = incidentes || [];
        this._renderizarIncidentesAtivos();
        // Mescla o último ponto novo no this.dados (pra banner/badge enxergar
        // o mais recente). Não substitui this.dados inteiro — gráficos seguem
        // com a série completa do último tick pesado.
        const leveUlt = leve?.points?.[leve.points.length - 1];
        if (leveUlt && this.dados?.points?.length) {
          const ultExistente = this.dados.points[this.dados.points.length - 1];
          if (new Date(leveUlt.time) > new Date(ultExistente.time)) {
            this.dados.points.push(leveUlt);
          }
        }
        // Re-renderiza só os componentes "live"
        this._detectarOffline(this.dados);
        if (this.dados?.points?.length) {
          this._renderizarLudico(this.dados);
          this._renderizarKpis(this.dados);
        }
        // Atualiza connectivity baseado em incidente ativo
        const incOff = this.incidentesAtivos.find(i => i.tipo === "gap" || i.tipo === "offline");
        if (incOff) {
          const r = incOff.segundos_restantes;
          this._renderizarConectividade(this.dados, "offline",
            `Simulação "${incOff.tipo}" disparada pela Sala de Controle · ${r != null ? r + "s restantes" : "ativo"}`);
        } else if (this.dados) {
          this._renderizarConectividade(this.dados);
        }
        return;
      }

      // ----- TICK PESADO: tudo -----
      // Limite dinâmico baseado na janela escolhida.
      const limiteDinamico = this._limitePorJanela(inicio);
      const [dados, incidentes] = await Promise.all([
        this.api.buscarDados(this.sensorId, { inicio, fim, limite: limiteDinamico }),
        this.api.incidentesAtivos(this.sensorId),
      ]);
      this.dados = dados;
      this.incidentesAtivos = incidentes || [];
      this._ultimoCarregamentoPesado = Date.now();
      this._renderizarIncidentesAtivos();

      // Hora REAL da última leitura recebida (não a hora atual do navegador).
      const ultimo = this.dados?.points?.[this.dados.points.length - 1];
      const el = document.querySelector("[data-atualizado-em]");
      if (el) {
        if (ultimo) {
          const d = new Date(ultimo.time);
          el.textContent = d.toLocaleTimeString("pt-BR", {
            hour: "2-digit", minute: "2-digit", second: "2-digit"
          }) + " · " + d.toLocaleDateString("pt-BR", {
            day: "2-digit", month: "2-digit"
          });
        } else {
          el.textContent = "—";
        }
      }

      // Sem pontos no intervalo
      if (!this.dados?.points?.length) {
        this._renderizarConectividade(this.dados);
        this._estadoSemDados({
          titulo: "Sem leituras na janela",
          msg: "A API respondeu, mas não retornou pontos nesse intervalo. Tente uma janela maior (ex: 7d).",
        });
        return;
      }

      // Se a Sala de Controle disparou gap/offline, força conectividade pra
      // offline imediatamente — não esperar a heurística de "10× intervalo".
      const incOffline = this.incidentesAtivos.find(i => i.tipo === "gap" || i.tipo === "offline");
      if (incOffline) {
        const restante = incOffline.segundos_restantes;
        const tempoLeg = restante != null ? `${restante}s restantes` : "ativo";
        this._renderizarConectividade(this.dados, "offline",
          `Simulação "${incOffline.tipo}" disparada pela Sala de Controle · ${tempoLeg}`);
      } else {
        this._renderizarConectividade(this.dados);
      }
      // 1) DETECTA OFFLINE primeiro — todos os renderizadores seguintes
      //    consultam this._estaOffline pra zerar valores quando o sensor
      //    parou de mandar dados (intervalo médio observado x última leitura).
      this._detectarOffline(this.dados);
      this._renderizarLudico(this.dados);
      this._renderizarKpis(this.dados);
      this._renderizarGraficos(this.dados);
      this._renderizarTabela(this.dados);
      this._renderizarLatencia(this.dados);
      this._renderizarAnalise(this.dados);
      // _detectarAlertasLocais foi desligado: o baseline dos sensores é
      // saudável agora; anomalias chegam pela Sala de Controle (incidentes
      // manuais), não por detecção automática a cada refresh.
      // this._detectarAlertasLocais(this.dados);
    } catch (e) {
      this._renderizarConectividade(null, "erro", e.message);
      const ehAuth = /401|403|chave|key/i.test(e.message);
      this._estadoSemDados({
        titulo: ehAuth ? "Chave de API inválida ou recusada" : "Erro ao falar com a API",
        msg: ehAuth
          ? "A API rejeitou a chave (HTTP 401/403). Cole uma chave válida no banner amarelo acima."
          : `A requisição falhou: ${e.message}. Verifique sua conexão, o servidor da API, ou tente atualizar.`,
      });
      console.error("carregar dados falhou:", e);
    } finally {
      this.carregando = false;
      this._ultimoCarregamentoEm = Date.now();
    }
  }

  /**
   * Limpa "Carregando dados…" de TODOS os painéis dependentes da API e mostra
   * uma mensagem unificada (sem-chave, erro, sem leituras).
   */
  _estadoSemDados({ titulo, msg }) {
    const blocoVazio = `<div class="vazio-bloco"><strong>${this._escapar(titulo)}</strong><span>${this._escapar(msg)}</span></div>`;

    // Gráficos
    const charts = document.querySelector("[data-charts]");
    if (charts) { this._destruirGraficos(); charts.innerHTML = blocoVazio; }

    // KPIs (4 placeholders neutros)
    const kpis = document.querySelector("[data-kpis]");
    if (kpis) {
      kpis.innerHTML = Array.from({ length: 4 }, () => `
        <div class="kpi-card">
          <div class="kpi-ico" style="background:#e5e9f2;color:var(--texto-suave);box-shadow:none">—</div>
          <div class="kpi-rotulo">Sem dados</div>
          <div class="kpi-valor" style="color:var(--texto-suave)">—</div>
          <div class="kpi-sub">aguardando API</div>
        </div>
      `).join("");
    }

    // Tabela
    const tab = document.querySelector("[data-tabela]");
    if (tab) tab.innerHTML = blocoVazio;

    // Latência
    const lat = document.querySelector("[data-latencia]");
    if (lat) lat.innerHTML = blocoVazio;

    // Análise (volta pro estado neutro com chips em info)
    this._renderizarAnaliseVazia();

    // Timestamp
    const tsEl = document.querySelector("[data-atualizado-em]");
    if (tsEl) tsEl.textContent = "—";
  }

  // =================================================================
  //  Incidentes ativos (disparados pela Sala de Controle)
  // =================================================================

  _renderizarIncidentesAtivos() {
    const el = document.querySelector("[data-incidentes-ativos]");
    if (!el) return;
    const lista = this.incidentesAtivos || [];
    if (!lista.length) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;

    // Marca como "cancelando…" os incidentes cujo cancel está em voo.
    this._cancelandoIncidentes = this._cancelandoIncidentes || new Set();
    el.innerHTML = `
      <div class="ia-cabecalho">
        <span class="ia-icone">🎛️</span>
        <div class="ia-textos">
          <strong>${lista.length} simulação${lista.length > 1 ? "ões" : ""} ativa${lista.length > 1 ? "s" : ""}</strong>
          <span>Disparado pela Sala de Controle — o sinal do sensor está sendo distorcido em tempo real.</span>
        </div>
      </div>
      <div class="ia-lista">
        ${lista.map(i => this._htmlIncidente(i, this._cancelandoIncidentes.has(String(i.id)))).join("")}
      </div>
    `;

    // Event delegation: handler fica no container e sobrevive a innerHTML
    // replacement do auto-refresh (que rolava a cada 3s).
    if (!el._delegacaoCancelar) {
      el.addEventListener("click", async (ev) => {
        const btn = ev.target.closest("[data-cancelar-incidente]");
        if (!btn || btn.disabled) return;
        ev.preventDefault();
        const id = String(btn.dataset.cancelarIncidente);
        this._cancelandoIncidentes.add(id);
        btn.disabled = true; btn.textContent = "Cancelando…";
        try {
          await this.api.cancelarIncidente(id);
          // Remove imediatamente do estado local pra UI não esperar 2s.
          this.incidentesAtivos = (this.incidentesAtivos || []).filter(
            i => String(i.id) !== id
          );
          this._renderizarIncidentesAtivos();
          await this._carregarDados(true);
          // Avisa outras abas (Sala de Controle / outros sensores)
          try { this._canalSala?.postMessage({ tipo: "mudanca-incidente", t: Date.now() }); } catch {}
        } catch (e) {
          console.error("cancelar incidente falhou:", e);
          btn.disabled = false;
          btn.textContent = "Tentar de novo";
        } finally {
          this._cancelandoIncidentes.delete(id);
        }
      });
      el._delegacaoCancelar = true;
    }
  }

  _htmlIncidente(i, cancelando = false) {
    const sev = ({ offline: "crit", gap: "crit", spike: "warn", drift: "warn", valor_impossivel: "crit" })[i.tipo] || "info";
    const ico = ({ offline: "📴", gap: "📡", spike: "⚡", drift: "📈", valor_impossivel: "🛑" })[i.tipo] || "ℹ️";
    const rotulo = ({
      offline: "Equipamento offline",
      gap: "Sem conectividade",
      spike: `Pico ${i.magnitude != null ? Number(i.magnitude).toFixed(2) + "×" : ""}`,
      drift: `Drift ${i.magnitude != null ? (Number(i.magnitude) >= 0 ? "+" : "") + Number(i.magnitude).toFixed(2) : ""}`,
      valor_impossivel: `Valor forçado = ${i.valor}`,
    })[i.tipo] || i.tipo;
    const restanteStr = i.segundos_restantes != null
      ? (i.segundos_restantes >= 60
          ? `${Math.floor(i.segundos_restantes / 60)} min ${i.segundos_restantes % 60}s`
          : `${i.segundos_restantes}s`)
      : "sem prazo";
    return `
      <div class="ia-item sev-${sev}">
        <span class="ia-ico">${ico}</span>
        <div class="ia-corpo">
          <div class="ia-titulo">${rotulo}</div>
          <div class="ia-meta">resta <strong>${restanteStr}</strong>${i.descricao ? ` · ${i.descricao}` : ""}</div>
        </div>
        <button class="ia-cancelar" data-cancelar-incidente="${i.id}" ${cancelando ? "disabled" : ""}>
          ${cancelando ? "Cancelando…" : "Cancelar"}
        </button>
      </div>
    `;
  }

  // =================================================================
  //  Conectividade
  // =================================================================

  _renderizarConectividade(dados, estadoForcado = null, mensagem = null) {
    const el = document.querySelector("[data-conectividade]");
    if (!el) return;

    let status = "online";
    let titulo = "Online";
    let info   = "";
    let pontosBadge = "";

    if (estadoForcado === "sem-chave") {
      status = "sem-chave"; titulo = "Sem chave"; info = "Configure a chave da API BEM acima.";
    } else if (estadoForcado === "erro") {
      status = "erro"; titulo = "Erro"; info = mensagem || "Falha ao consultar a API.";
    } else if (!dados || !dados.points?.length) {
      status = "offline"; titulo = "Sem leituras"; info = "Sem dados retornados na janela.";
    } else {
      const ultimo = new Date(dados.points[dados.points.length - 1].time);
      const diff = (Date.now() - ultimo.getTime()) / 1000;
      const intervalos = [];
      for (let i = 1; i < dados.points.length; i++) {
        intervalos.push((new Date(dados.points[i].time) - new Date(dados.points[i-1].time)) / 1000);
      }
      const intMedio = intervalos.length ? intervalos.reduce((s,x)=>s+x,0) / intervalos.length : 0;

      if (intMedio > 0 && diff > intMedio * 10)      { status = "offline";  titulo = "Offline";  }
      else if (intMedio > 0 && diff > intMedio * 3)  { status = "instavel"; titulo = "Instável"; }

      info = `Última leitura ${this._formatarTempoAbs(diff)} · ~${this._formatarIntervalo(intMedio)} entre leituras`;
      const ds = this._downsampleInfo;
      const sufixoDS = ds ? ` · gráfico condensado em ${ds.depois} pts (LTTB)` : "";
      pontosBadge = `<span class="conectividade-pontos">${dados.points.length} pontos · ${this.janela}${sufixoDS}</span>`;
    }

    el.className = `conectividade conectividade-${status}`;
    el.innerHTML = `
      <span class="conectividade-pill">
        <span class="conectividade-ponto"></span>
        <strong>${titulo}</strong>
      </span>
      <span class="conectividade-info">${info}</span>
      ${pontosBadge}
    `;
  }

  _formatarTempoAbs(segundos) {
    if (!isFinite(segundos) || segundos < 0) return "—";
    if (segundos < 90)   return `há ${Math.round(segundos)}s`;
    const min = segundos / 60;
    if (min < 90)        return `há ${Math.round(min)} min`;
    const h = min / 60;
    if (h < 36)          return `há ${h.toFixed(1)} h`;
    return `há ${(h / 24).toFixed(1)} dias`;
  }

  _formatarIntervalo(segundos) {
    if (!isFinite(segundos) || segundos <= 0) return "—";
    if (segundos < 1)    return `${Math.round(segundos*1000)} ms`;
    if (segundos < 90)   return `${segundos.toFixed(1)} s`;
    return `${(segundos/60).toFixed(1)} min`;
  }

  // =================================================================
  //  KPIs
  // =================================================================

  _renderizarKpis(dados) {
    const cont = document.querySelector("[data-kpis]");
    if (!cont) return;

    // OFFLINE: zera os 4 KPIs com aviso de sem sinal
    if (this._estaOffline) {
      const tempo = this._segDesde < 60
        ? `${Math.round(this._segDesde)}s`
        : this._segDesde < 3600
          ? `${Math.floor(this._segDesde / 60)} min`
          : `${(this._segDesde / 3600).toFixed(1)}h`;
      cont.innerHTML = Array.from({ length: 4 }, () => `
        <div class="kpi-card sev-critico kpi-offline">
          <div class="kpi-ico" style="background:rgba(220,38,38,.12);color:#dc2626">📡</div>
          <div class="kpi-rotulo">Sem leitura</div>
          <div class="kpi-valor" style="color:#dc2626">—</div>
          <div class="kpi-sub">offline há ${tempo}</div>
        </div>`).join("");
      return;
    }

    const itens = this.sensor.calcularIndicadores(dados.points);
    if (!itens.length) {
      cont.innerHTML = `<div class="vazio-bloco" style="grid-column:1/-1"><strong>Sem KPIs</strong><span>Sem dados pra calcular.</span></div>`;
      return;
    }

    const tipo = this.sensor.tipo;
    // pega só os 4 primeiros pra manter o layout
    const top = itens.slice(0, 4);
    cont.innerHTML = top.map(it => {
      const sev = it.severidade ? `sev-${it.severidade}` : "";
      return `
        <div class="kpi-card ${tipo} ${sev}">
          <div class="kpi-ico">${this._iconeTipo(tipo)}</div>
          <div class="kpi-rotulo">${it.rotulo}</div>
          <div class="kpi-valor">${it.valor}</div>
          ${it.sub ? `<div class="kpi-sub">${it.sub}</div>` : ""}
        </div>
      `;
    }).join("");
  }

  _iconeTipo(tipo) {
    if (tipo === "energia") return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;
    if (tipo === "temperatura") return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4 4 0 1 0 5 0z"></path></svg>`;
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="15" y1="12" x2="15.01" y2="12"></line></svg>`;
  }

  // =================================================================
  //  Painel lúdico (semáforo + velocímetros / termômetro / porta)
  // =================================================================

  /**
   * Decide se o sensor está OFFLINE baseado no intervalo médio REAL
   * observado nos pontos recebidos — não em constante. Robusto a mudanças
   * de cadência (pg_cron a cada 60s, 30s, etc).
   *
   * Critério: offline = última leitura > 2,5× o intervalo médio (com piso
   * de 90s pra evitar falso positivo em janelas com poucos pontos).
   *
   * Resultado: this._estaOffline, this._segDesde, this._cadenciaObservada.
   */
  _detectarOffline(dados) {
    this._estaOffline = false;
    this._segDesde = 0;
    this._cadenciaObservada = 60;

    // Incidente ativo de gap/offline = sensor está offline AGORA mesmo que
    // o cron ainda não tenha parado de inserir. Evita a "espera de 2 min"
    // entre clicar em "Desconectar" e a UI refletir.
    const incOffline = (this.incidentesAtivos || []).find(
      i => i.tipo === "gap" || i.tipo === "offline"
    );
    if (incOffline) {
      this._estaOffline = true;
      this._incidenteOffline = incOffline;
      if (dados?.points?.length) {
        const ultimo = dados.points[dados.points.length - 1];
        this._segDesde = (Date.now() - new Date(ultimo.time).getTime()) / 1000;
      }
      return;
    }
    this._incidenteOffline = null;

    if (!dados?.points?.length) {
      this._estaOffline = true;
      return;
    }
    const pts = dados.points;
    const ultimo = pts[pts.length - 1];
    this._segDesde = (Date.now() - new Date(ultimo.time).getTime()) / 1000;

    // Intervalo médio observado (últimos 30 pontos)
    if (pts.length >= 2) {
      const recortes = pts.slice(-30);
      const diffs = [];
      for (let i = 1; i < recortes.length; i++) {
        const d = (new Date(recortes[i].time).getTime() -
                   new Date(recortes[i - 1].time).getTime()) / 1000;
        if (isFinite(d) && d > 0) diffs.push(d);
      }
      if (diffs.length) {
        this._cadenciaObservada = diffs.reduce((s, x) => s + x, 0) / diffs.length;
      }
    }
    const threshold = Math.max(90, this._cadenciaObservada * 2.5);
    this._estaOffline = this._segDesde > threshold;
  }

  _renderizarLudico(dados) {
    const secao = document.querySelector("[data-ludico]");
    if (!secao || !dados?.points?.length) return;
    secao.hidden = false;

    const ultimo = dados.points[dados.points.length - 1];
    secao.classList.toggle("offline", this._estaOffline);

    this._renderizarBannerStatus(dados, ultimo);

    const visual = document.querySelector("[data-ludico-visual]");
    if (!visual) return;

    // Quando offline, passamos um ponto NULO em vez do último valor antigo —
    // assim os velocímetros/termômetro/porta zeram visualmente (e o CSS
    // .offline aplica grayscale + badge "sem sinal" por cima).
    const pontoExibir = this._estaOffline ? null : ultimo;

    if (this.sensor.tipo === "energia") {
      this._renderizarVelocimetrosEnergia(visual, pontoExibir);
    } else if (this.sensor.tipo === "temperatura") {
      this._renderizarTermometro(visual, dados, pontoExibir);
    } else if (this.sensor.tipo === "porta") {
      this._renderizarPorta(visual, dados, pontoExibir);
    }
  }

  /** Banner grande com semáforo + frase humana + valor destacado. */
  _renderizarBannerStatus(dados, ultimo) {
    const el = document.querySelector("[data-ludico-status]");
    if (!el) return;

    // Se o sensor está offline, o banner inteiro vira o aviso de offline.
    let bannerData;
    if (this._estaOffline) {
      const inc = this._incidenteOffline;
      // Quando o offline vem de um incidente injetado pela Sala de Controle,
      // mostra exatamente isso — usuário sabe que é simulação.
      if (inc) {
        const restante = inc.segundos_restantes;
        const restanteTxt = restante == null
          ? "sem prazo"
          : restante >= 60
            ? `~${Math.floor(restante / 60)} min ${restante % 60}s restantes`
            : `${restante}s restantes`;
        const rotuloTipo = inc.tipo === "gap" ? "Sem conectividade" : "Equipamento offline";
        bannerData = {
          sev: "crit",
          emoji: "📡",
          titulo: rotuloTipo.toUpperCase(),
          sub: `Simulação disparada pela Sala de Controle · ${restanteTxt}.`,
          valor: "OFFLINE",
        };
      } else {
        const tempo = this._segDesde < 60
          ? `${Math.round(this._segDesde)}s`
          : this._segDesde < 3600
            ? `${Math.floor(this._segDesde / 60)} min`
            : `${(this._segDesde / 3600).toFixed(1)}h`;
        bannerData = {
          sev: "crit",
          emoji: "📡",
          titulo: "SENSOR OFFLINE",
          sub: `Sem leitura há ${tempo}. Velocímetros/termômetro abaixo refletem o último valor lido — não está mais ativo.`,
          valor: "OFFLINE",
        };
      }
    } else {
      bannerData = this._avaliarStatus(dados, ultimo);
    }
    const { sev, emoji, titulo, sub, valor } = bannerData;

    // Upsert (não recria DOM se já existe — evita flash)
    if (!el.querySelector(".banner-status")) {
      el.innerHTML = `
        <div class="banner-status">
          <div class="bs-emoji"></div>
          <div class="bs-texto">
            <p class="bs-titulo"></p>
            <p class="bs-sub"></p>
          </div>
          <div class="bs-valor"></div>
        </div>`;
    }
    const banner = el.querySelector(".banner-status");
    banner.className = `banner-status ${sev}`;
    banner.querySelector(".bs-emoji").textContent  = emoji;
    banner.querySelector(".bs-titulo").textContent = titulo;
    banner.querySelector(".bs-sub").textContent    = sub;
    banner.querySelector(".bs-valor").textContent  = valor;
  }

  /**
   * Resolve um threshold lendo (1) `sensor.parametros[chave]` se existir;
   * (2) `NORMAS[grupo][chave].valor` se NORMAS estiver carregado;
   * (3) o fallback hardcoded.
   */
  _threshold(chave, fallback, grupoNorma = null) {
    const p = this.sensor?.parametros || {};
    if (p[chave] != null) return Number(p[chave]);
    if (grupoNorma && typeof NORMAS !== "undefined") {
      const n = NORMAS[grupoNorma]?.[chave];
      if (n?.valor != null) return Number(n.valor);
    }
    return fallback;
  }

  _avaliarStatus(dados, ultimo) {
    if (this.sensor.tipo === "energia") {
      const fpComp = (
        (Math.abs(ultimo.fator_potencia_a || 0) +
         Math.abs(ultimo.fator_potencia_b || 0) +
         Math.abs(ultimo.fator_potencia_c || 0)) / 3
      );
      const pot = (
        (ultimo.tensao_fase_a || 0)*(ultimo.corrente_fase_a || 0)*(ultimo.fator_potencia_a || 0) +
        (ultimo.tensao_fase_b || 0)*(ultimo.corrente_fase_b || 0)*(ultimo.fator_potencia_b || 0) +
        (ultimo.tensao_fase_c || 0)*(ultimo.corrente_fase_c || 0)*(ultimo.fator_potencia_c || 0)
      ) / 1000;
      const fpNeg = (ultimo.fator_potencia_a < 0 || ultimo.fator_potencia_b < 0 || ultimo.fator_potencia_c < 0);

      // Thresholds vêm do agente (sensor.parametros) ou caem nos defaults ANEEL.
      const fpAten = this._threshold("limite_atencao", 0.92, "ANEEL");
      const fpCrit = this._threshold("limite_critico", 0.85, "ANEEL");

      if (fpNeg)              return { sev: "crit", emoji: "⚠️", titulo: "Fluxo reverso detectado",  sub: "FP negativo — fiação do medidor pode estar invertida.", valor: `${pot.toFixed(1)} kW` };
      if (fpComp < fpCrit)    return { sev: "crit", emoji: "🔴", titulo: "FP crítico",                sub: `FP composto = ${fpComp.toFixed(2)} (mínimo ANEEL ${fpCrit.toFixed(2)}). Multa garantida.`, valor: `${pot.toFixed(1)} kW` };
      if (fpComp < fpAten)    return { sev: "warn", emoji: "🟡", titulo: "FP em zona de atenção",     sub: `FP composto = ${fpComp.toFixed(2)} (ideal ≥ ${fpAten.toFixed(2)}).`, valor: `${pot.toFixed(1)} kW` };
      return                         { sev: "ok",   emoji: "✅", titulo: "Energia saudável",          sub: `FP ${fpComp.toFixed(2)} · operando normalmente.`, valor: `${pot.toFixed(1)} kW` };
    }
    if (this.sensor.tipo === "temperatura") {
      const t = ultimo.temperatura;
      // Faixa: parametros do sensor sobrescrevem o default por ambiente
      const faixaPadrao = PaginaSensor.FAIXAS_TERMICAS[this.sensor.grupo];
      const faixa = (this.sensor.parametros?.faixa_min != null || this.sensor.parametros?.faixa_max != null)
        ? { min: Number(this.sensor.parametros.faixa_min ?? faixaPadrao?.min ?? -50),
            max: Number(this.sensor.parametros.faixa_max ?? faixaPadrao?.max ?? 50) }
        : faixaPadrao;
      const envMin = this._threshold("envelope_min", -50);
      const envMax = this._threshold("envelope_max", 100);

      if (t < envMin || t > envMax) return { sev: "crit", emoji: "🛑", titulo: "Leitura impossível", sub: "Fora do envelope físico — sensor com defeito.", valor: `${t.toFixed(1)}°C` };
      if (faixa) {
        if (t < faixa.min) return { sev: "warn", emoji: "🥶", titulo: "Abaixo da faixa ideal",  sub: `Ideal ${faixa.min}°C a ${faixa.max}°C.`, valor: `${t.toFixed(1)}°C` };
        if (t > faixa.max) return { sev: "crit", emoji: "🔥", titulo: "Acima da faixa ideal",   sub: `Câmara em ${t.toFixed(1)}°C, alvo até ${faixa.max}°C — risco ao produto.`, valor: `${t.toFixed(1)}°C` };
        return                    { sev: "ok",   emoji: "✅", titulo: "Temperatura na faixa ideal", sub: `Ideal ${faixa.min}°C a ${faixa.max}°C.`, valor: `${t.toFixed(1)}°C` };
      }
      return { sev: "ok", emoji: "🌡️", titulo: "Temperatura ambiente", sub: "Sensor externo — sem faixa controlada.", valor: `${t.toFixed(1)}°C` };
    }
    if (this.sensor.tipo === "porta") {
      const aberta = (ultimo.abertura_porta || 0) > 0;
      return aberta
        ? { sev: "warn", emoji: "🚪", titulo: "Porta aberta agora", sub: "Quanto mais tempo aberta, mais frio escapa.", valor: "ABERTA" }
        : { sev: "ok", emoji: "✅", titulo: "Porta fechada", sub: "Câmara vedada — frio sendo mantido.", valor: "FECHADA" };
    }
    return { sev: "ok", emoji: "✅", titulo: "Sensor online", sub: "", valor: "OK" };
  }

  /** 3 velocímetros lado a lado (uma fase cada). */
  _renderizarVelocimetrosEnergia(visual, ultimo) {
    if (!visual.querySelector(".gauge-card")) {
      visual.innerHTML = ["a","b","c"].map(f => `
        <div class="gauge-card" data-gauge="${f}">
          <h4>Corrente fase ${f.toUpperCase()}</h4>
          ${this._svgGauge()}
          <div class="gauge-valor" data-valor>—</div>
          <div class="gauge-unidade">amperes (A)</div>
        </div>`).join("");
    }
    // OFFLINE: zera tudo e mostra "—"
    if (ultimo == null) {
      ["a","b","c"].forEach(f => {
        const card = visual.querySelector(`[data-gauge="${f}"]`);
        const arco   = card.querySelector(".gauge-arco");
        const agulha = card.querySelector(".gauge-agulha");
        arco.setAttribute("stroke-dashoffset", "251.3");
        arco.setAttribute("class", "gauge-arco");
        agulha.style.transform = "rotate(-90deg)";
        card.querySelector("[data-valor]").textContent = "—";
      });
      return;
    }
    // Escala honesta: usa a corrente nominal do equipamento (do parametros)
    // quando disponível; senão cai num default genérico de 250A. Como cada
    // motor tem sua nominal, a cor passa a refletir carga relativa real.
    const nominal = Number(this.sensor?.parametros?.corrente_nominal_a) || 250;
    // Acima de 100% do nominal é zona vermelha; >60% é amarelo.
    const limWarn = 0.60;
    const limCrit = 0.85;
    ["a","b","c"].forEach(f => {
      const card = visual.querySelector(`[data-gauge="${f}"]`);
      const v = ultimo[`corrente_fase_${f}`] || 0;
      const pct = Math.max(0, Math.min(1, Math.abs(v) / nominal));
      const sev = pct < limWarn ? "ok" : pct < limCrit ? "warn" : "crit";
      const arco  = card.querySelector(".gauge-arco");
      const agulha = card.querySelector(".gauge-agulha");
      const dash = 251.3;   // perímetro do arco SVG (calculado abaixo)
      arco.setAttribute("stroke-dashoffset", String(dash - dash * pct));
      arco.setAttribute("class", `gauge-arco ${sev}`);
      const angulo = -90 + pct * 180;
      agulha.style.transform = `rotate(${angulo}deg)`;
      card.querySelector("[data-valor]").textContent = `${v.toFixed(1)} A`;
    });
  }

  _svgGauge() {
    // Semicírculo de raio 80, centrado em (90,90). perímetro = π·80 ≈ 251.3
    return `
      <svg class="gauge-svg" viewBox="0 0 180 110" aria-hidden="true">
        <path class="gauge-fundo" d="M 10 90 A 80 80 0 0 1 170 90"/>
        <path class="gauge-arco ok" d="M 10 90 A 80 80 0 0 1 170 90"
              stroke-dasharray="251.3" stroke-dashoffset="251.3"/>
        <line class="gauge-agulha" x1="90" y1="90" x2="90" y2="20"/>
        <circle cx="90" cy="90" r="5" fill="#0f172a"/>
      </svg>`;
  }

  /** Termômetro vertical animado. */
  _renderizarTermometro(visual, dados, ultimo) {
    const faixa = PaginaSensor.FAIXAS_TERMICAS[this.sensor.grupo];
    if (!visual.querySelector(".termometro-card")) {
      visual.innerHTML = `
        <div class="termometro-card">
          <h4 class="term-titulo">Temperatura agora</h4>
          <div class="term-vidro">
            <div class="term-faixa-ideal" data-faixa-ideal></div>
            <div class="term-mercurio" data-mercurio style="height:0"></div>
            <div class="term-bulbo" data-bulbo></div>
          </div>
          <div class="term-info">
            <div class="term-leitura" data-leitura>—</div>
            <p data-info-faixa></p>
            <p data-info-tend></p>
          </div>
        </div>`;
    }
    const card     = visual.querySelector(".termometro-card");
    const mercurio = card.querySelector("[data-mercurio]");
    const bulbo    = card.querySelector("[data-bulbo]");
    const leitura  = card.querySelector("[data-leitura]");
    const faixaEl  = card.querySelector("[data-faixa-ideal]");
    const infoFaixa= card.querySelector("[data-info-faixa]");
    const infoTend = card.querySelector("[data-info-tend]");

    // OFFLINE: zera tudo
    if (ultimo == null) {
      mercurio.style.height = "0";
      mercurio.className = "term-mercurio";
      leitura.innerHTML = `—<span class="unid">°C</span>`;
      leitura.className = "term-leitura";
      infoFaixa.innerHTML = "Sem leitura no momento";
      infoTend.textContent = "";
      return;
    }

    // Escala visual: -30°C a +40°C (cobre câmara congelados e ambiente externo)
    const escMin = -30, escMax = 40, escRange = escMax - escMin;
    const t = ultimo.temperatura;
    const tClamp = Math.max(escMin, Math.min(escMax, t));
    const pct = (tClamp - escMin) / escRange * 100;
    mercurio.style.height = `${pct}%`;

    // Classifica cor
    let classe = "ideal";
    if (Math.abs(t) > 100)                   classe = "crit";
    else if (faixa) {
      if (t < faixa.min || t > faixa.max)    classe = (t > faixa.max ? "crit" : "warn");
      else                                    classe = "ideal";
    } else {
      classe = t < 10 ? "frio" : "ideal";
    }
    mercurio.className = `term-mercurio ${classe}`;
    bulbo.style.background = (classe === "frio" || classe === "ideal")
      ? "linear-gradient(135deg,#1E6FD6,#00B8F0)"
      : "linear-gradient(135deg,#ef4444,#f87171)";

    leitura.innerHTML = `${t.toFixed(1)}<span class="unid">°C</span>`;
    leitura.className = `term-leitura ${classe === "crit" ? "crit" : classe === "warn" ? "warn" : "ok"}`;

    // Faixa ideal sobreposta no vidro
    if (faixa) {
      const min = Math.max(escMin, Math.min(escMax, faixa.min));
      const max = Math.max(escMin, Math.min(escMax, faixa.max));
      const bottom = (min - escMin) / escRange * 100;
      const top    = (max - escMin) / escRange * 100;
      faixaEl.style.bottom = `${bottom}%`;
      faixaEl.style.height = `${top - bottom}%`;
      faixaEl.style.display = "block";
      infoFaixa.innerHTML = `Faixa ideal: <strong>${faixa.min}°C a ${faixa.max}°C</strong>`;
    } else {
      faixaEl.style.display = "none";
      infoFaixa.innerHTML = "Sensor de ambiente — sem faixa controlada";
    }

    // Tendência simples (últimos 10 vs anteriores)
    const pts = dados.points;
    if (pts.length >= 20) {
      const n = pts.length;
      const recente = pts.slice(n - 10).reduce((s,p) => s + p.temperatura, 0) / 10;
      const antes   = pts.slice(n - 20, n - 10).reduce((s,p) => s + p.temperatura, 0) / 10;
      const delta = recente - antes;
      const seta = delta > 0.1 ? "↗ subindo" : delta < -0.1 ? "↘ caindo" : "→ estável";
      infoTend.innerHTML = `Tendência recente: <strong>${seta}</strong> (${delta >= 0 ? "+" : ""}${delta.toFixed(2)}°C)`;
    } else {
      infoTend.textContent = "";
    }
  }

  /** Porta aberta/fechada com timer de quanto tempo está nesse estado. */
  _renderizarPorta(visual, dados, ultimo) {
    if (!visual.querySelector(".porta-card")) {
      visual.innerHTML = `
        <div class="porta-card" data-porta>
          <div class="porta-icone" data-icone>🚪</div>
          <div class="porta-texto">
            <p class="porta-estado" data-estado>—</p>
            <p class="porta-timer"  data-timer>—</p>
          </div>
        </div>`;
    }
    const card = visual.querySelector(".porta-card");

    // OFFLINE: estado desconhecido
    if (ultimo == null) {
      card.className = "porta-card";
      card.querySelector("[data-icone]").textContent = "❓";
      card.querySelector("[data-estado]").textContent = "ESTADO DESCONHECIDO";
      card.querySelector("[data-timer]").innerHTML = "Sensor não está respondendo.";
      return;
    }
    const aberta = (ultimo.abertura_porta || 0) > 0;

    // Procura quanto tempo está no estado atual (último ponto que mudou)
    const pts = dados.points;
    let inicio = new Date(pts[0].time);
    for (let i = pts.length - 1; i >= 1; i--) {
      const atualAberta = (pts[i].abertura_porta || 0) > 0;
      const antAberta   = (pts[i - 1].abertura_porta || 0) > 0;
      if (atualAberta !== antAberta) {
        inicio = new Date(pts[i].time);
        break;
      }
    }
    const agora = new Date(pts[pts.length - 1].time);
    const segs = Math.floor((agora - inicio) / 1000);
    const tempo = segs < 60 ? `${segs}s`
                : segs < 3600 ? `${Math.floor(segs/60)} min`
                : `${Math.floor(segs/3600)}h ${Math.floor((segs%3600)/60)}min`;

    card.className = `porta-card ${aberta ? "aberta" : "fechada"}`;
    card.querySelector("[data-icone]").textContent  = aberta ? "🚪" : "🔒";
    card.querySelector("[data-estado]").textContent = aberta ? "PORTA ABERTA" : "PORTA FECHADA";
    card.querySelector("[data-timer]").innerHTML    =
      `Está nesse estado há <strong>${tempo}</strong>`;
  }

  // =================================================================
  //  Gráficos
  // =================================================================

  _renderizarGraficos(dados) {
    const box = document.querySelector("[data-charts]");
    if (!box) return;

    // Se mudou de tipo de sensor, recria tudo do zero.
    if (this._tipoGraficoAtual !== this.sensor.tipo) {
      this._destruirGraficos();
      box.innerHTML = "";
      this._tipoGraficoAtual = this.sensor.tipo;
    }

    if (!dados.points.length) {
      this._destruirGraficos();
      box.innerHTML = `<div class="vazio-bloco"><strong>Sem dados</strong><span>Sem pontos no intervalo.</span></div>`;
      this._tipoGraficoAtual = null;
      return;
    }

    // Passa pelo AgenteReconstrutor: detecta gaps e gera pontos sintéticos
    // pra preencher (marcados com _reconstruido=true).
    // Dispara busca do histórico estendido em background (cacheado por 60s).
    // O reconstrutor usa esse histórico pra fazer SPLC em ciclos de 24h e 7d.
    this._garantirHistoricoEstendido();
    const recon = (typeof AgenteReconstrutor !== "undefined")
      ? new AgenteReconstrutor(this.sensor).reconstruir(dados.points, this._historicoEstendido)
      : { pontos: dados.points, gaps: [] };
    let pontos = recon.pontos;
    this._ultimoRecon = recon;

    // Downsample LTTB: reduz oscilações visuais em janelas longas
    // preservando picos/vales/tendência. Janelas curtas passam intactas.
    // A tabela e a análise continuam vendo os pontos ORIGINAIS — só o
    // gráfico recebe o subconjunto visualmente representativo.
    const _totalAntes = pontos.length;
    if (typeof Downsample !== "undefined") {
      pontos = Downsample.aplicarPorJanela(pontos, this.sensor.tipo, this.janela);
    }
    this._downsampleInfo = pontos.length < _totalAntes
      ? { antes: _totalAntes, depois: pontos.length }
      : null;

    const labels = pontos.map(p => new Date(p.time).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }));

    // Helper: pra cada métrica, devolve 2 séries paralelas — "real" e
    // "reconstruída" — com os null nas posições opostas. O ponto real
    // imediatamente antes/depois de um trecho reconstruído entra também
    // na série reconstruída pra ligar visualmente.
    // Também devolve `metaRec`: array paralelo com o objeto _meta de cada
    // ponto reconstruído, pra o tooltip do gráfico mostrar a base.
    const split = (get) => {
      const real = [], rec = [], vazio = [], metaRec = [];
      for (let i = 0; i < pontos.length; i++) {
        const p = pontos[i];
        const v = get(p);
        if (p._reconstruido) {
          real.push(null);
          rec.push(v);
          vazio.push(null);
          metaRec.push(p._meta || null);
        } else if (p._vazio) {
          // Gap ativo: linha morta no zero, série separada
          real.push(null);
          rec.push(null);
          vazio.push(v ?? 0);
          metaRec.push(null);
        } else {
          real.push(v);
          // Bridge: vizinho de trecho reconstruído entra também na série rec
          const vizRec = pontos[i+1]?._reconstruido || pontos[i-1]?._reconstruido;
          rec.push(vizRec ? v : null);
          // Bridge: último ponto real antes do gap ativo entra na vazio
          // (no valor REAL dele) pra dar a impressão da linha "caindo" pro zero
          const vizVazio = pontos[i+1]?._vazio || pontos[i-1]?._vazio;
          vazio.push(vizVazio ? v : null);
          metaRec.push(null);
        }
      }
      return { real, rec, vazio, metaRec };
    };

    // Helper: dataset principal (linha sólida) + overlay reconstruído.
    // Roxo (#7c3aed) = identidade do Agente Reconstrutor.
    // `recInfo` é prop customizada do dataset — o tooltip lê dela.
    // A OPACIDADE da linha roxa varia conforme a confiança média da janela:
    // alta confiança = mais opaca (vívida); baixa confiança = quase apagada.
    const confMediaRec = (() => {
      const confs = recon.gaps?.map(g => g.confianca).filter(Number.isFinite) || [];
      return confs.length ? confs.reduce((s, x) => s + x, 0) / confs.length : 0.6;
    })();
    // Mapeia confiança 0..1 pra alpha 0.30..1.0 (sempre visível, mas escala)
    const alphaRec = (0.30 + 0.70 * confMediaRec).toFixed(2);
    const corRecBorda = `rgba(124, 58, 237, ${alphaRec})`;
    const corRecFundo = `rgba(124, 58, 237, ${(alphaRec * 0.12).toFixed(2)})`;

    const par = (label, get, color) => {
      const { real, rec, vazio, metaRec } = split(get);
      const temVazio = vazio.some(v => v !== null && v !== undefined);
      const ds = [
        { label, data: real, borderColor: color },
        {
          label: `${label} (reconstruído · ${Math.round(confMediaRec * 100)}%)`,
          data: rec,
          borderColor: corRecBorda,
          backgroundColor: corRecFundo,
          borderDash: [6, 4],
          borderWidth: 2.4,
          pointRadius: ctx => ctx.raw == null ? 0 : 2,
          pointBackgroundColor: corRecBorda,
          pointBorderColor: "#fff",
          pointHoverRadius: 6,
          fill: false,
          tension: 0.25,
          recInfo: metaRec,
        },
      ];
      // Linha "morta" (gap em curso): vermelho pontilhado avançando no zero.
      // Só aparece quando há gap ativo (offlineAgora=true no agente).
      if (temVazio) {
        ds.push({
          label: `${label} (sem sinal · ao vivo)`,
          data: vazio,
          borderColor: "rgba(220,38,38,.85)",
          backgroundColor: "transparent",
          borderDash: [3, 4],
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: false,
          tension: 0,
        });
      }
      return ds;
    };

    if (this.sensor.tipo === "energia") {
      this._upsertChart("corrente", box, "Corrente por fase (A)", labels, [
        ...par("Fase A", p => p.corrente_fase_a, "#123B7A"),
        ...par("Fase B", p => p.corrente_fase_b, "#1E6FD6"),
        ...par("Fase C", p => p.corrente_fase_c, "#00B8F0"),
      ]);
      this._upsertChart("tensao", box, "Tensão por fase (V)", labels, [
        ...par("Fase A", p => p.tensao_fase_a, "#123B7A"),
        ...par("Fase B", p => p.tensao_fase_b, "#1E6FD6"),
        ...par("Fase C", p => p.tensao_fase_c, "#00B8F0"),
      ]);
      this._upsertChart("fp", box, "Fator de potência", labels, [
        ...par("Fase A", p => p.fator_potencia_a, "#123B7A"),
        ...par("Fase B", p => p.fator_potencia_b, "#1E6FD6"),
        ...par("Fase C", p => p.fator_potencia_c, "#00B8F0"),
        { label: "Limite ANEEL (0,92)", data: pontos.map(() => 0.92), borderColor: "#dc2626", borderDash: [6,4], pointRadius: 0 },
      ]);
      const pot = (p) =>
        ((p.tensao_fase_a||0)*(p.corrente_fase_a||0)*(p.fator_potencia_a||0) +
         (p.tensao_fase_b||0)*(p.corrente_fase_b||0)*(p.fator_potencia_b||0) +
         (p.tensao_fase_c||0)*(p.corrente_fase_c||0)*(p.fator_potencia_c||0)) / 1000;
      this._upsertChart("potencia", box, "Potência ativa total (kW)", labels, [
        ...par("P", pot, "#1E6FD6"),
      ]);
    }
    else if (this.sensor.tipo === "temperatura") {
      const faixa = PaginaSensor.FAIXAS_TERMICAS[this.sensor.grupo];
      const ds = [...par("Temperatura", p => p.temperatura, "#00B8F0")];
      if (faixa) {
        ds.push({ label: `Mínima ideal (${faixa.min}°C)`, data: pontos.map(() => faixa.min), borderColor: "#16a34a", borderDash: [6,4], pointRadius: 0 });
        ds.push({ label: `Máxima ideal (${faixa.max}°C)`, data: pontos.map(() => faixa.max), borderColor: "#dc2626", borderDash: [6,4], pointRadius: 0 });
      }
      this._upsertChart("temperatura", box, "Temperatura (°C)", labels, ds);
    }
    else if (this.sensor.tipo === "porta") {
      this._upsertChart("porta", box, "Sinal de abertura", labels, [
        ...par("abertura_porta", p => p.abertura_porta, "#1E6FD6"),
      ]);
    }
  }

  /**
   * Cria o gráfico se não existe; se já existe, só atualiza os dados.
   * `chart.update('none')` evita o flash de animação a cada refresh —
   * as linhas crescem suavemente como uma serpente em vez de piscar.
   */
  _upsertChart(chave, parent, titulo, labels, datasets) {
    const existente = this.graficos[chave];
    if (existente) {
      existente.data.labels = labels;
      datasets.forEach((novo, i) => {
        const ds = existente.data.datasets[i];
        if (!ds) {
          existente.data.datasets[i] = this._estilizarDataset(novo, existente.canvas);
        } else {
          ds.data = novo.data;
          // Propaga props visuais que mudam entre renders — label (carrega
          // a % de confiança do reconstrutor) e estilo de linha. Sem isso,
          // o slot do dataset herda o label/estilo do render anterior.
          if (novo.label !== undefined)       ds.label = novo.label;
          if (novo.borderColor)               ds.borderColor = novo.borderColor;
          if (novo.borderDash !== undefined)  ds.borderDash = novo.borderDash;
          if (novo.borderWidth !== undefined) ds.borderWidth = novo.borderWidth;
          if (novo.recInfo !== undefined)     ds.recInfo = novo.recInfo;
          if (novo.tension !== undefined)     ds.tension = novo.tension;
          if (novo.fill && novo.backgroundColor) {
            ds.backgroundColor = this._gradiente(existente.canvas, novo.borderColor || novo.backgroundColor);
          }
        }
      });
      // Remove datasets sobrando — caso clássico: a "linha morta" do gap
      // ativo some quando o reconstrutor preenche o vazio. Sem este corte,
      // o dataset velho fica de fantasma no gráfico com os dados antigos.
      if (existente.data.datasets.length > datasets.length) {
        existente.data.datasets.length = datasets.length;
      }
      existente.update("none");
      return;
    }

    if (typeof Chart === "undefined") {
      const wrap = document.createElement("div");
      wrap.className = "chart-bloco";
      wrap.innerHTML = `<h4>${titulo}</h4><div class="vazio-bloco">Chart.js não carregou.</div>`;
      parent.appendChild(wrap);
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "chart-bloco";
    wrap.innerHTML = `<h4>${titulo}</h4><div class="chart-wrap"><canvas></canvas></div>`;
    parent.appendChild(wrap);

    const canvas = wrap.querySelector("canvas");
    const ds = datasets.map(d => this._estilizarDataset(d, canvas));

    const ch = new Chart(canvas, {
      type: "line",
      data: { labels, datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        animation: { duration: 700, easing: "easeOutCubic" },
        animations: { y: { duration: 0 } },
        plugins: {
          legend: {
            position: "bottom",
            align: "start",
            labels: {
              boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: "circle",
              font: { size: 11, family: "Inter, sans-serif", weight: "500" },
              color: "#5b6b86",
              padding: 14,
            },
          },
          tooltip: {
            backgroundColor: "rgba(11,29,58,.96)",
            titleColor: "#ffffff",
            titleFont: { size: 11, family: "Inter, sans-serif", weight: "600" },
            bodyColor: "#cfd8e8",
            bodyFont: { size: 12, family: "Inter, sans-serif" },
            borderColor: "rgba(30,111,214,.4)",
            borderWidth: 1,
            padding: 12,
            cornerRadius: 8,
            displayColors: true,
            boxPadding: 6,
            usePointStyle: true,
            callbacks: {
              // Mostra info de reconstrução quando o ponto é estimado pelo agente
              afterBody: (items) => {
                if (!items?.length) return "";
                for (const it of items) {
                  const meta = it.dataset?.recInfo?.[it.dataIndex];
                  if (meta && meta.reconstruido) {
                    const conf = Math.round((meta.confianca || 0) * 100);
                    const dur = meta.duracao_s < 60
                      ? `${Math.round(meta.duracao_s)}s`
                      : meta.duracao_s < 3600
                        ? `${Math.round(meta.duracao_s/60)} min`
                        : `${(meta.duracao_s/3600).toFixed(1)}h`;
                    const linhas = [];
                    linhas.push("");
                    linhas.push(`🧩 PONTO RECONSTRUÍDO PELO AGENTE`);
                    linhas.push(`Confiança agregada: ${conf}%`);
                    linhas.push(`Gap: ${dur}`);
                    if (meta.ciclosUsados?.length) {
                      linhas.push(`Ciclos históricos usados: ${meta.ciclosUsados.join(" + ")}`);
                    } else {
                      linhas.push(`Sem ciclo histórico — fallback de interpolação`);
                    }
                    // Mostra estratégia por campo (até 6 campos pra não poluir)
                    if (meta.camposEstrategia) {
                      const entradas = Object.entries(meta.camposEstrategia).slice(0, 6);
                      linhas.push(`Estratégia por campo:`);
                      for (const [k, e] of entradas) {
                        const c = Math.round((meta.camposConfianca?.[k] || 0) * 100);
                        const nome = e === "splc" ? "SPLC (ciclo histórico)"
                                   : e === "media" ? "média estável"
                                   : e === "step" ? "step (último estado)"
                                   : e;
                        linhas.push(`  • ${k}: ${nome} (${c}%)`);
                      }
                    }
                    linhas.push(`Âncora antes: ${meta.nAntes} pontos · depois: ${meta.nDepois} pontos`);
                    return linhas;
                  }
                }
                return "";
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              maxTicksLimit: 7,
              font: { size: 10, family: "Inter, sans-serif" },
              color: "#8b95a8",
              padding: 8,
            },
            grid: { display: false },
            border: { color: "#e6ebf3" },
          },
          y: {
            ticks: {
              font: { size: 10, family: "Inter, sans-serif" },
              color: "#8b95a8",
              padding: 8,
            },
            grid: { color: "#f1f4f9", drawTicks: false },
            border: { display: false },
          },
        },
      },
    });
    this.graficos[chave] = ch;
  }

  _estilizarDataset(d, canvas) {
    const cor = d.borderColor || "#1E6FD6";
    const tem_fill = !!d.fill;
    const bg = tem_fill ? this._gradiente(canvas, cor) : (d.backgroundColor || "transparent");
    // Linha sólida = série real (mais grossa, suave).
    // Linha tracejada = série reconstruída (também grossa pra ser visível, em roxo).
    return {
      ...d,
      borderColor: cor,
      backgroundColor: bg,
      borderWidth: d.borderWidth ?? (d.borderDash ? 2.4 : 2.4),
      pointRadius: d.pointRadius ?? 0,
      pointHoverRadius: 6,
      pointHoverBackgroundColor: cor,
      pointHoverBorderColor: "#ffffff",
      pointHoverBorderWidth: 2,
      tension: d.stepped ? 0 : (d.tension ?? 0.5),
      fill: tem_fill,
    };
  }

  _gradiente(canvas, corHex) {
    const ctx = canvas.getContext("2d");
    const h = canvas.height || 280;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    const rgb = this._hexParaRgb(corHex);
    g.addColorStop(0,    `rgba(${rgb}, .35)`);
    g.addColorStop(0.55, `rgba(${rgb}, .10)`);
    g.addColorStop(1,    `rgba(${rgb}, 0)`);
    return g;
  }

  _hexParaRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
    return m ? `${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)}` : "30,111,214";
  }

  _destruirGraficos() {
    Object.values(this.graficos).forEach(c => { try { c.destroy(); } catch {} });
    this.graficos = {};
  }

  // =================================================================
  //  Tabela
  // =================================================================

  _renderizarTabela(dados) {
    const box = document.querySelector("[data-tabela]");
    if (!box) return;
    if (!dados.points.length) {
      box.innerHTML = `<div class="vazio-bloco">Sem pontos.</div>`;
      return;
    }
    const colunas = ["time", ...dados.fields];
    const linhas = dados.points.slice(-50).reverse();
    box.innerHTML = `
      <table class="tabela-pontos">
        <thead><tr>${colunas.map(c => `<th>${c}</th>`).join("")}</tr></thead>
        <tbody>
          ${linhas.map(p => `
            <tr>
              ${colunas.map(c => {
                if (c === "time") return `<td class="ts">${new Date(p[c]).toLocaleString("pt-BR")}</td>`;
                const v = p[c];
                return `<td class="num">${typeof v === "number" ? v.toFixed(3) : (v ?? "—")}</td>`;
              }).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  // =================================================================
  //  Latência
  // =================================================================

  _renderizarLatencia(dados) {
    const box = document.querySelector("[data-latencia]");
    if (!box) return;
    if (dados.points.length < 2) {
      box.innerHTML = `<div class="vazio-bloco">Poucos pontos pra calcular.</div>`;
      return;
    }
    const intervalos = [];
    for (let i = 1; i < dados.points.length; i++) {
      intervalos.push((new Date(dados.points[i].time) - new Date(dados.points[i-1].time)) / 1000);
    }
    intervalos.sort((a,b)=>a-b);
    const medio = intervalos.reduce((s,x)=>s+x,0) / intervalos.length;
    const mediana = intervalos[Math.floor(intervalos.length / 2)];
    const maior = intervalos[intervalos.length - 1];
    const gaps = intervalos.filter(x => x > medio * 2).length;
    const razaoGaps = gaps / intervalos.length;

    // Saúde da latência: ok / atenção / problema
    let saude = "ok", saudeLabel = "Saudável", saudeMsg = "Sensor está enviando leituras com regularidade.";
    if (razaoGaps > 0.10 || maior > medio * 20) {
      saude = "crit"; saudeLabel = "Problemas";
      saudeMsg = "Lacunas frequentes ou muito longas — link instável, gateway com fila ou bateria fraca.";
    } else if (razaoGaps > 0.03 || maior > medio * 10) {
      saude = "warn"; saudeLabel = "Atenção";
      saudeMsg = "Algumas lacunas detectadas. Pode mascarar eventos reais durante o silêncio.";
    }

    // Indicador visual de "saúde do intervalo"
    // diferença entre mediana e médio indica skew
    const skew = medio > 0 ? Math.abs(medio - mediana) / medio * 100 : 0;

    box.innerHTML = `
      <div class="latencia-saude saude-${saude}">
        <span class="latencia-saude-ponto"></span>
        <div>
          <div class="latencia-saude-titulo">${saudeLabel}</div>
          <div class="latencia-saude-msg">${saudeMsg}</div>
        </div>
      </div>

      <div class="latencia-grid">
        <div class="latencia-item"><div class="l">Intervalo médio</div><div class="v">${this._formatarIntervalo(medio)}</div></div>
        <div class="latencia-item"><div class="l">Mediana</div><div class="v">${this._formatarIntervalo(mediana)}</div></div>
        <div class="latencia-item"><div class="l">Maior gap</div><div class="v">${this._formatarIntervalo(maior)}</div></div>
        <div class="latencia-item ${gaps > 0 ? 'tem' : ''}"><div class="l">Gaps detectados</div><div class="v">${gaps}</div></div>
      </div>

      <div class="latencia-extra">
        <strong>${dados.points.length}</strong> leituras analisadas · skew médio↔mediana <strong>${skew.toFixed(0)}%</strong>
      </div>
    `;
  }

  // =================================================================
  //  Parâmetros recebidos
  // =================================================================

  _renderizarParametros() {
    const box = document.querySelector("[data-parametros]");
    if (!box) return;
    const campos = this.sensor?.campos || [];
    if (!campos.length) {
      box.innerHTML = `<div class="vazio-bloco">Catálogo não traz campos.</div>`;
      return;
    }
    box.innerHTML = campos.map(c => {
      const meta = PaginaSensor.PARAMETROS[c] || { desc: "Campo bruto da API.", unidade: "—" };
      return `
        <div class="parametro-item">
          <div class="nome">${c}</div>
          <div class="desc">${meta.desc}</div>
          <span class="unidade">${meta.unidade}</span>
        </div>
      `;
    }).join("");
  }

  // =================================================================
  //  Tipos de alerta possíveis
  // =================================================================

  _renderizarTiposDeAlerta() {
    const box = document.querySelector("[data-tipos-alerta]");
    if (!box) return;
    const tipos = PaginaSensor.TIPOS_ALERTA[this.sensor?.tipo] || [];
    if (!tipos.length) {
      box.innerHTML = `<div class="vazio-bloco">Sem catálogo de alertas pra este tipo.</div>`;
      return;
    }
    box.innerHTML = tipos.map(t => `
      <div class="tipo-alerta-item">
        <span class="tipo-alerta-sev ${t.sev}">${Notificacoes.rotuloSeveridade(t.sev)}</span>
        <div class="tipo-alerta-corpo">
          <div class="t">${t.t}</div>
          <div class="d">${t.d}</div>
        </div>
      </div>
    `).join("");
  }

  // =================================================================
  //  Alertas deste sensor (filtra Notificacoes pelo id)
  // =================================================================

  _renderizarAlertasDoSensor() {
    const box  = document.querySelector("[data-alertas-sensor]");
    const pill = document.querySelector("[data-alertas-contagem]");
    if (!box) return;

    const todas = Notificacoes.listar().filter(n => n.origem?.id === this.sensorId);
    if (pill) {
      pill.textContent = todas.length;
      pill.classList.toggle("tem", todas.length > 0);
    }

    if (!todas.length) {
      box.innerHTML = `
        <div class="vazio-bloco">
          <strong>Sem alertas</strong>
          <span>Tudo certo até agora. Novos alertas aparecem aqui automaticamente.</span>
        </div>
      `;
      return;
    }

    box.innerHTML = todas.map(n => `
      <div class="alerta-sensor-item sev-${n.severidade} ${n.lido ? 'lido' : ''}">
        <span class="alerta-marca"></span>
        <div class="alerta-corpo">
          <div class="alerta-titulo">${this._escapar(n.titulo)}</div>
          ${n.mensagem ? `<div class="alerta-mensagem">${this._escapar(n.mensagem)}</div>` : ""}
          <div class="alerta-quando">${Notificacoes.formatarQuando(n.criadoEm)}</div>
        </div>
      </div>
    `).join("");
  }

  // =================================================================
  //  Detector local de alertas — dispara Notificacoes a partir dos
  //  vereditos do AGENTE (única fonte de verdade). Cobre energia,
  //  temperatura E porta, e respeita parâmetros customizados por sensor.
  // =================================================================

  _detectarAlertasLocais(dados) {
    if (!dados?.points?.length || !this.sensor) return;
    const sensor = this.sensor;

    // Roda o agente do tipo (Energia/Temperatura/Porta) — mesma chamada
    // usada pela seção de análise da página. Garante unicidade.
    let verifs;
    try {
      verifs = new AnalisadorSensor(sensor, dados.points).avaliar();
    } catch (e) {
      console.error("Falha ao avaliar agente:", e);
      return;
    }

    // Mapa status do veredito → severidade da notificação
    const SEV = { crit: "critica", warn: "alta", info: null, ok: null };

    for (const v of verifs) {
      const severidade = SEV[v.status];
      if (!severidade) continue;   // só dispara pra crit/warn

      const codigo = v.id;          // dedupe por id da regra
      const jaExiste = Notificacoes.listar().some(n =>
        n.origem?.id === sensor.id &&
        n.metadados?.codigo === codigo &&
        !n.lido
      );
      if (jaExiste) continue;

      Notificacoes.enviar({
        severidade,
        titulo: v.label,
        mensagem: `${sensor.rotulo}: ${v.resumo || v.detalhe}`,
        origem: { tipo: "sensor", id: sensor.id, label: sensor.rotulo },
        acao:   { url: "index.html", texto: "Ver detalhes" },
        metadados: {
          codigo,
          fonte: v.fonte,
          valorMedido: v.valorMedido,
          valorIdeal:  v.valorIdeal,
          diagnostico: v.diagnostico,
        },
      });
    }
  }

  // =================================================================
  //  Análise automática em tempo real (substitui achados estáticos)
  // =================================================================

  /**
   * Renderiza a seção de análise no estado "aguardando dados".
   * Mostra a régua de chips com as verificações que este tipo de sensor faz,
   * em estado neutro, antes mesmo de os dados chegarem.
   */
  _renderizarAnaliseVazia() {
    const secao    = document.querySelector("[data-analise]");
    const banner   = document.querySelector("[data-analise-banner]");
    const chips    = document.querySelector("[data-analise-chips]");
    const detalhes = document.querySelector("[data-analise-detalhes]");
    const rodape   = document.querySelector("[data-analise-rodape]");
    if (!secao) return;

    const cat = AnalisadorSensor.catalogo(this.sensor?.tipo);
    banner.className = "analise-banner atencao";
    banner.innerHTML = `
      <span class="analise-banner-icone">…</span>
      <div class="analise-banner-conteudo">
        <div class="analise-banner-titulo">Aguardando dados</div>
        <div class="analise-banner-sub">Quando os pontos chegarem, cada verificação abaixo recebe um status (crítico, atenção, info ou ok).</div>
      </div>
    `;
    chips.innerHTML = cat.map(c => `
      <span class="chip status-info">
        <span class="chip-icone">·</span>
        <span class="chip-rotulo">${c.categoria}</span>
        <span class="chip-valor">· ${c.label}</span>
      </span>
    `).join("");
    detalhes.innerHTML = "";
    rodape.innerHTML = `<span>Lista do que este sensor de tipo <strong>${this.sensor?.tipo || "—"}</strong> verifica em tempo real.</span>`;
    secao.hidden = false;
  }

  _renderizarAnalise(dados) {
    const secao    = document.querySelector("[data-analise]");
    const banner   = document.querySelector("[data-analise-banner]");
    const chips    = document.querySelector("[data-analise-chips]");
    const detalhes = document.querySelector("[data-analise-detalhes]");
    const rodape   = document.querySelector("[data-analise-rodape]");
    if (!secao) return;

    const verifs = new AnalisadorSensor(this.sensor, dados.points || []).avaliar();
    const cont = { crit: 0, warn: 0, info: 0, ok: 0 };
    verifs.forEach(v => { cont[v.status] = (cont[v.status] || 0) + 1; });

    // ---------- Banner geral ----------
    let bannerClass, bannerIcone, bannerTitulo, bannerSub;
    if (cont.crit > 0) {
      bannerClass = "critico";
      bannerIcone = "✗";
      bannerTitulo = `Atenção urgente · ${cont.crit} ${cont.crit === 1 ? "verificação crítica" : "verificações críticas"}`;
      bannerSub = `${cont.warn} atenção · ${cont.info} info · ${cont.ok} ok`;
    } else if (cont.warn > 0) {
      bannerClass = "atencao";
      bannerIcone = "!";
      bannerTitulo = `${cont.warn} ${cont.warn === 1 ? "ponto de atenção" : "pontos de atenção"}`;
      bannerSub = `${cont.info} info · ${cont.ok} dentro da normalidade`;
    } else {
      bannerClass = "tudo-certo";
      bannerIcone = "✓";
      bannerTitulo = "Tudo dentro da normalidade";
      bannerSub = `${cont.ok} verificação${cont.ok === 1 ? "" : "ões"} ok${cont.info ? ` · ${cont.info} observação${cont.info === 1 ? "" : "ões"}` : ""}`;
    }
    banner.className = `analise-banner ${bannerClass}`;
    banner.innerHTML = `
      <span class="analise-banner-icone">${bannerIcone}</span>
      <div class="analise-banner-conteudo">
        <div class="analise-banner-titulo">${bannerTitulo}</div>
        <div class="analise-banner-sub">${bannerSub}</div>
      </div>
    `;

    // ---------- Chips ----------
    chips.innerHTML = verifs.map(v => `
      <button class="chip status-${v.status}" data-ir-para="${v.id}" title="${this._escapar(v.label)}">
        <span class="chip-icone">${this._iconeStatus(v.status)}</span>
        <span class="chip-rotulo">${this._escapar(v.categoria)}</span>
        ${v.resumo ? `<span class="chip-valor">· ${this._escapar(v.resumo)}</span>` : ""}
      </button>
    `).join("");

    chips.querySelectorAll("[data-ir-para]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.irPara;
        document.getElementById(`verif-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });

    // ---------- Detalhes (problemas primeiro, OK colapsado) ----------
    const ordem = { crit: 0, warn: 1, info: 2, ok: 3 };
    const ordenadas = [...verifs].sort((a, b) => (ordem[a.status] ?? 9) - (ordem[b.status] ?? 9));
    const problemas = ordenadas.filter(v => v.status !== "ok");
    const oks       = ordenadas.filter(v => v.status === "ok");

    let html = "";
    if (problemas.length) {
      html += `<div class="analise-detalhes-titulo">Pontos que pedem atenção</div>`;
      html += problemas.map(v => this._htmlDetalhe(v)).join("");
    }
    if (oks.length) {
      html += `<button class="analise-toggle-ok" data-toggle-ok>✓ Ver as ${oks.length} verificação${oks.length === 1 ? " que está" : "ões que estão"} ok</button>`;
      html += `<div class="analise-detalhes-titulo analise-detalhes-ok" hidden style="margin-top:14px">Verificações dentro da normalidade</div>`;
      html += `<div data-bloco-ok hidden>${oks.map(v => this._htmlDetalhe(v)).join("")}</div>`;
    }
    detalhes.innerHTML = html;

    detalhes.querySelector("[data-toggle-ok]")?.addEventListener("click", (ev) => {
      const btn = ev.currentTarget;
      const bloco = detalhes.querySelector("[data-bloco-ok]");
      const titulo = detalhes.querySelector(".analise-detalhes-ok");
      const aberto = !bloco.hidden;
      bloco.hidden = aberto;
      titulo.hidden = aberto;
      btn.textContent = aberto
        ? `✓ Ver as ${oks.length} verificação${oks.length === 1 ? " que está" : "ões que estão"} ok`
        : `Ocultar verificações ok`;
    });

    // ---------- Rodapé ----------
    rodape.innerHTML = `
      <span>Baseado em <strong>${dados.points.length}</strong> pontos da janela <code>${this.janela}</code> · sensor <strong>${this.sensor.tipo}</strong> · ${verifs.length} verificações executadas</span>
    `;

    secao.hidden = false;
  }

  _htmlDetalhe(v) {
    const rotuloSev = { crit: "crítico", warn: "atenção", info: "info", ok: "ok" }[v.status] || v.status;
    const diag = v.diagnostico
      ? `<div class="detalhe-diagnostico"><strong>Possível motivo e recomendação</strong>${this._escapar(v.diagnostico)}</div>`
      : "";
    return `
      <article class="detalhe-item status-${v.status}" id="verif-${v.id}">
        <div class="detalhe-topo">
          <span class="detalhe-sev status-${v.status}">${rotuloSev}</span>
          <span class="detalhe-categoria">${this._escapar(v.categoria)}</span>
          <span class="detalhe-label">${this._escapar(v.label)}</span>
        </div>
        <div class="detalhe-texto">${this._escapar(v.detalhe || "—")}</div>
        ${diag}
      </article>
    `;
  }

  _iconeStatus(status) {
    return { crit: "✗", warn: "!", info: "i", ok: "✓" }[status] || "·";
  }

  _escapar(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new PaginaSensor().iniciar();
});
