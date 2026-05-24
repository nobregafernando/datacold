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
    this.janela = "-5m";
    this.graficos = {};          // chave -> Chart (re-usados entre refreshes)
    this.graficosMeta = {};      // chave -> { titulo, labels, datasets } (snapshot pro exportador)
    this._tipoGraficoAtual = null;
    this.autoTimer = null;
    this.renderTimer = null;
    // Fetch a cada 3s — busca janela inteira + render completo + redesenha gráfico.
    // Render a cada 1s — DESACOPLADO: usa clock local pra atualizar o contador
    //   "Última leitura há Xs", conectividade (online→instavel→offline),
    //   velocímetros (sem sinal), e estender a linha morta no gráfico.
    //   Sem isso, quando o dado para de chegar, NADA mais re-renderiza
    //   (UI fica congelada no último estado conhecido).
    // O Realtime (WebSocket) ainda entrega push entre os ticks de fetch.
    this.autoIntervalo = 3000;
    this.renderIntervalo = 1000;
    this.intervaloPesado = 3000;
    this._ultimoCarregamentoPesado = 0;
    this.carregando = false;
    this._canalRealtime = null;        // canal WebSocket pro Supabase Realtime
    this._ultimoEstadoOffline = null;  // pra detectar transições online↔offline
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

    // Dispara o histórico estendido (30d) em BACKGROUND — não bloqueia o
    // primeiro render. O AgenteReconstrutor cai em fallback degradado nos
    // primeiros ticks; quando o cache hidrata (uns segundos depois), volta
    // a fazer SPLC multi-ciclo completo.
    this._dispararHistoricoEstendido();
    await this._carregarDados();
    // Realtime via WebSocket — push de pontos novos em ~200ms. Polling
    // (autoRefresh) vira só fallback se o canal cair.
    this._abrirRealtime();
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

  // =================================================================
  //  Auto-refresh
  // =================================================================

  _armarAutoRefresh() {
    this._pararAutoRefresh();
    // Refresh imediato (se o último foi >1s atrás) pra não esperar o tick
    // quando a aba volta a ficar visível.
    const desdeUltimo = Date.now() - (this._ultimoCarregamentoEm || 0);
    if (desdeUltimo > 1000) this._carregarDados();
    this.autoTimer   = setInterval(() => this._carregarDados(), this.autoIntervalo);
    this.renderTimer = setInterval(() => this._tickRender(),     this.renderIntervalo);
    document.querySelector("[data-aovivo]")?.classList.remove("pausado");
  }

  _pararAutoRefresh() {
    if (this.autoTimer)   clearInterval(this.autoTimer);
    if (this.renderTimer) clearInterval(this.renderTimer);
    this.autoTimer = null;
    this.renderTimer = null;
    document.querySelector("[data-aovivo]")?.classList.add("pausado");
  }

  /**
   * Tick de RENDER puro — clock-based, NUNCA busca dado. Roda a cada 1s.
   *
   * REGRA DE OURO: NÃO chamar nada caro aqui (gráfico, reconstrutor,
   * downsample, Chart.js update). Re-renderizar gráfico a 1Hz trava a aba.
   *
   * Apenas:
   *   - contador "Última leitura há Xs" e badge online→instavel→offline
   *   - lúdico/KPIs SOMENTE em transição de estado (não a cada tick)
   *
   * Gráfico + linha morta são re-renderizados pelo fetch tick a cada 3s —
   * a linha morta cresce em saltos de ~3s, o que é imperceptível.
   */
  _tickRender() {
    if (!this.dados?.points?.length) return;
    try {
      const estavaOffline = !!this._estaOffline;
      this._detectarOffline(this.dados);

      // Conectividade — barato (só innerHTML de pill + texto).
      const incOff = this.incidentesAtivos?.find(i => i.tipo === "gap" || i.tipo === "offline");
      if (incOff) {
        const r = incOff.segundos_restantes;
        this._renderizarConectividade(this.dados, "offline",
          `Simulação "${incOff.tipo}" disparada pela Sala de Controle · ${r != null ? r + "s restantes" : "ativo"}`);
      } else {
        this._renderizarConectividade(this.dados);
      }

      // Lúdico/KPIs: em transição de estado OU quando chegou ponto novo
      // via Realtime (flag setada no _receberPontoRealtime). Throttle 1Hz —
      // velocímetros tem animação canvas custosa, não pode rodar a 3Hz.
      const transicaoOffline = this._estaOffline !== estavaOffline;
      if (transicaoOffline || this._novoPontoRealtime) {
        this._novoPontoRealtime = false;
        this._renderizarLudico(this.dados);
        this._renderizarKpis(this.dados);
      }
    } catch (e) {
      console.warn("[tickRender]", e);
    }
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
    // Cadência real hoje = 3s (pg_cron sub-minuto). Margem 20%.
    // Era 30s antes — subestimava 10× e cortava dados, fazendo o front
    // achar que o sensor tinha parado.
    const estimado = Math.ceil(seg / 3 * 1.2);
    // Mínimo 500, máximo 25 000 (Chart.js fica lento acima disso)
    return Math.min(25000, Math.max(500, estimado));
  }

  /**
   * Busca histórico estendido (30 dias) em background — alimenta o
   * AgenteReconstrutor pra SPLC multi-ciclo. Cache de 5 min.
   *
   * IMPORTANTE: NÃO awaitar essa função no caminho crítico de render.
   * Dispara e segue. O reconstrutor cai em fallback degradado durante
   * a primeira carga, mas o gráfico/velocímetro abrem instantâneos.
   *
   * Limite 15k pontos: com cadência de 3s, isso cobre ~12h. Pro SPLC
   * de 24h/7d/30d o front amostra subconjuntos via JS — sem precisar
   * baixar 800k+ pontos crus.
   */
  _dispararHistoricoEstendido() {
    const agora = Date.now();
    const idadeCache = agora - (this._historicoEstendidoEm || 0);
    if (idadeCache < 5 * 60_000 && this._historicoEstendido) return;
    if (this._historicoEstendidoPromise) return;
    this._historicoEstendidoPromise = (async () => {
      try {
        const r = await this.api.buscarDados(this.sensorId, {
          inicio: "-720h",          // 30 dias (server-side LIMIT corta)
          fim: "now",
          limite: 15000,            // teto pra não travar download/parse
        });
        this._historicoEstendido = r?.points || [];
        this._historicoEstendidoEm = Date.now();
      } catch (e) {
        // silencioso — reconstrutor cai pra fallback de interpolação
      } finally {
        this._historicoEstendidoPromise = null;
      }
    })();
  }

  // =================================================================
  //  Realtime (push via WebSocket)
  // =================================================================

  /** Carrega @supabase/supabase-js sob demanda (CDN). Resolve uma única
   *  vez — chamadas subsequentes reusam o módulo já carregado. */
  static _carregarSupabaseLib() {
    if (window.supabase?.createClient) return Promise.resolve(window.supabase);
    if (PaginaSensor._libPromise) return PaginaSensor._libPromise;
    PaginaSensor._libPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      s.onload  = () => resolve(window.supabase);
      s.onerror = () => reject(new Error("falha ao carregar @supabase/supabase-js"));
      document.head.appendChild(s);
    });
    return PaginaSensor._libPromise;
  }

  /**
   * Abre canal WebSocket pra receber INSERTs em tempo real da tabela de
   * leituras desse sensor. Cada novo ponto chega em ~200ms (vs. 3-30s do
   * polling) e atualiza gauge / KPIs / conectividade sem esperar tick.
   *
   * Falha silenciosamente se a lib não carregar — polling assume.
   */
  async _abrirRealtime() {
    if (!this.sensor || !this.sensorId) return;
    if (this._canalRealtime) return;
    try {
      const lib = await PaginaSensor._carregarSupabaseLib();
      const cli = lib.createClient(ApiBEM.URL_SUPABASE, ApiBEM.CHAVE_SUPABASE_ANON, {
        realtime: { params: { eventsPerSecond: 20 } },
      });
      // JWT do usuário (RLS das tabelas exige) — passamos pro canal.
      const jwt = localStorage.getItem(ApiBEM.JWT_STORAGE);
      if (jwt) cli.realtime.setAuth(jwt);

      const tabela = `leituras_${this.sensor.tipo}`;  // energia/temperatura/porta
      const canal = cli
        .channel(`live-${this.sensorId}`)
        .on("postgres_changes", {
          event:  "INSERT",
          schema: "public",
          table:  tabela,
          filter: `sensor_id=eq.${this.sensorId}`,
        }, (msg) => this._receberPontoRealtime(msg.new))
        .subscribe((status) => {
          this._statusRealtime = status;
          // status: "SUBSCRIBED" | "CLOSED" | "CHANNEL_ERROR" | "TIMED_OUT"
        });
      this._canalRealtime = canal;
      this._clienteRealtime = cli;
    } catch (e) {
      // segue só com polling — sem barulho na UI
      console.warn("[realtime] indisponível, usando polling:", e.message);
    }
  }

  /** Converte a row crua do INSERT pro formato { time, ...campos } e
   *  empurra no this.dados.points. NÃO re-renderiza aqui — o tickRender
   *  (1s) detecta a mudança e atualiza o que for barato. Re-render direto
   *  no push handler trava a aba quando vêm vários eventos seguidos. */
  _receberPontoRealtime(row) {
    if (!row || !this.dados?.points) return;
    const pt = { time: row.momento };
    Object.keys(row).forEach(k => {
      if (!["id", "sensor_id", "momento", "criado_em"].includes(k)) pt[k] = row[k];
    });
    // Dedupe: se já temos exatamente esse timestamp (ou mais novo), ignora.
    const ult = this.dados.points[this.dados.points.length - 1];
    if (ult && new Date(ult.time).getTime() >= new Date(pt.time).getTime()) return;
    this.dados.points.push(pt);
    // Cap defensivo: cadência de 3s × 30d = 864k pts no pior caso.
    if (this.dados.points.length > 50000) this.dados.points.splice(0, 5000);
    // Marca pro próximo tickRender atualizar gauge/KPIs (1× máx, não a 3Hz).
    this._novoPontoRealtime = true;
  }

  _fecharRealtime() {
    try { this._canalRealtime?.unsubscribe(); } catch {}
    try { this._clienteRealtime?.removeAllChannels(); } catch {}
    this._canalRealtime = null;
    this._clienteRealtime = null;
  }

  /**
   * Refresh em duas pistas:
   *  - LEVE (default): só incidentes + último ponto. Roda a cada `autoIntervalo`
   *    (10s — fallback do realtime). Pinta banner/badge/KPIs/incidentes.
   *  - PESADO: leve + janela completa de pontos + gráficos/tabela/análise.
   *    Roda a cada `intervaloPesado` (30s) ou quando forçado.
   *
   * O `forcado=true` força um PESADO mesmo dentro da janela leve.
   */
  async _carregarDados(forcado = false) {
    if (!this.sensor) return;

    // Lock único — uma chamada por vez. Polling agora roda a cada 3s e
    // sempre faz o fluxo completo (era leve/pesado split, mas o merge do
    // leve causava bugs de "última leitura há 48s" mesmo com Realtime).
    if (this.carregando) return;
    this.carregando = true;
    try {
      let inicio = this.janela;
      let fim    = "now";
      if (this.sensor.historico && !["-72h","-167h","-24h","-15d","-30d"].includes(inicio)) {
        inicio = "-90d";
        fim    = "-30d";
      }

      // Limite dinâmico baseado na janela escolhida.
      const limiteDinamico = this._limitePorJanela(inicio);
      // Histórico estendido (30d, pro AgenteReconstrutor) roda em BACKGROUND
      // — não bloqueia o render. Durante a primeira carga o reconstrutor cai
      // em fallback degradado; nos próximos ticks (< 5 min) o cache hidrata
      // ele com SPLC multi-ciclo completo.
      this._dispararHistoricoEstendido();
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
      this._renderizarLatencia(this.dados);
      // Tabela + análise são caras (loop por todos os pontos + DOM grande).
      // Roda a cada 3 fetches (~9s) — esses dados não mudam tão rápido
      // que justifique a 3s. Sem isso a aba trava com sensores grandes
      // (extrusora tem 9 séries: 3 fases × corrente/tensão/FP).
      this._contadorFetch = (this._contadorFetch || 0) + 1;
      if (this._contadorFetch % 3 === 0 || forcado) {
        this._renderizarTabela(this.dados);
        this._renderizarAnalise(this.dados);
      }
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
      this._ultimoCarregamentoPesado = Date.now();
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

      // Thresholds alinhados com _detectarOffline. Pra cadência de 3s:
      //   instavel após 6s sem leitura
      //   offline após 12s sem leitura (3 ticks perdidos)
      const limOffline  = Math.max(12, intMedio * 4);
      const limInstavel = Math.max(6,  intMedio * 2);
      if (intMedio > 0 && diff > limOffline)        { status = "offline";  titulo = "Offline";  }
      else if (intMedio > 0 && diff > limInstavel)  { status = "instavel"; titulo = "Instável"; }

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
    // Piso de 12s evita falso positivo no primeiro tick (com 1-2 pontos a
    // cadência observada pode estar estranha). Com cadência real de 3s,
    // sensor é marcado offline após 3 ticks perdidos (~9s).
    const threshold = Math.max(12, this._cadenciaObservada * 3);
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
          <div class="gauge-carga" data-carga>—</div>
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
        const elCarga = card.querySelector("[data-carga]");
        if (elCarga) elCarga.textContent = "";
      });
      return;
    }
    // Escala: usa a corrente nominal do equipamento (parâmetros do sensor)
    // quando disponível. O ARCO vai até 1.3× o nominal — dá margem visual
    // pra sobrecarga aparecer (sem capar) e mantém operação normal na
    // metade verde do gauge.
    //
    // Limites RELATIVOS ao nominal (não à escala bruta):
    //   < 100% nominal → ok (verde)     operação normal/saudável
    //   100-115%       → warn (amarelo) sobrecarga leve, monitorar
    //   > 115%         → crit (vermelho) sobrecarga severa
    //
    // (Antes: warn=60%, crit=85% — calibrado errado, motor operando dentro
    //  do nominal aparecia em vermelho.)
    const nominal   = Number(this.sensor?.parametros?.corrente_nominal_a) || 250;
    const maxEscala = nominal * 1.3;
    const limWarn   = 1.00 / 1.3;   // = 0.769 do arco
    const limCrit   = 1.15 / 1.3;   // = 0.885 do arco
    ["a","b","c"].forEach(f => {
      const card = visual.querySelector(`[data-gauge="${f}"]`);
      const v = Math.abs(ultimo[`corrente_fase_${f}`] || 0);
      const pct = Math.max(0, Math.min(1, v / maxEscala));
      const sev = pct < limWarn ? "ok" : pct < limCrit ? "warn" : "crit";
      const arco  = card.querySelector(".gauge-arco");
      const agulha = card.querySelector(".gauge-agulha");
      const dash = 251.3;   // perímetro do arco SVG (π·80)
      arco.setAttribute("stroke-dashoffset", String(dash - dash * pct));
      arco.setAttribute("class", `gauge-arco ${sev}`);
      const angulo = -90 + pct * 180;
      agulha.style.transform = `rotate(${angulo}deg)`;
      card.querySelector("[data-valor]").textContent = `${v.toFixed(1)} A`;
      const elCarga = card.querySelector("[data-carga]");
      if (elCarga) {
        const cargaPct = Math.round((v / nominal) * 100);
        elCarga.textContent = `${cargaPct}% do nominal (${nominal} A)`;
        elCarga.className = `gauge-carga ${sev}`;
      }
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
    // O histórico estendido (30d) JÁ foi carregado no _carregarDados em
    // paralelo com a janela atual — então this._historicoEstendido sempre
    // está populado nesse ponto.
    const recon = (typeof AgenteReconstrutor !== "undefined")
      ? new AgenteReconstrutor(this.sensor).reconstruir(dados.points, this._historicoEstendido)
      : { pontos: dados.points, gaps: [] };
    let pontos = recon.pontos;
    this._ultimoRecon = recon;

    // Diagnóstico: se houver gaps reconstruídos, loga quantos domingos
    // (ou outro DOW) o SPLC realmente encontrou. Ajuda a debugar
    // "deveria pegar 4 semanas e só pegou 1".
    if (recon.gaps?.length && console?.debug) {
      const histDias = this._historicoEstendido?.length
        ? (Date.now() - new Date(this._historicoEstendido[0].time).getTime()) / (86400 * 1000)
        : 0;
      const primeiroGap = recon.gaps[0];
      console.debug(
        `[reconstrutor ${this.sensorId}] gaps=${recon.gaps.length}, ` +
        `hist=${this._historicoEstendido?.length || 0} pts (~${histDias.toFixed(1)}d), ` +
        `1º gap: estrategias=${primeiroGap.estrategias?.join("/")}, ` +
        `conf=${primeiroGap.confianca}`
      );
    }

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
          // Legenda clara: "estimado pelo agente · confiabilidade média X%"
          label: `${label} · estimado (${Math.round(confMediaRec * 100)}% conf. média)`,
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

    // Helper: média dos campos do ponto (ignora null/NaN). Usado pra
    // colapsar 3 fases (A/B/C) em 1 linha. Funciona pra pontos reais E
    // reconstruídos — o AgenteReconstrutor preenche cada campo individual.
    const mediaCampos = (p, campos) => {
      const v = campos.map(c => p?.[c]).filter(x => typeof x === "number" && Number.isFinite(x));
      if (!v.length) return null;
      return v.reduce((s, x) => s + x, 0) / v.length;
    };
    const sensorIdRender = this.sensor?.id || "x";
    const fasesExpandidas = (chave) => sessionStorage.getItem(`__chart_fases_${sensorIdRender}_${chave}`) === "1";

    if (this.sensor.tipo === "energia") {
      const campCorr = ["corrente_fase_a","corrente_fase_b","corrente_fase_c"];
      const campTens = ["tensao_fase_a","tensao_fase_b","tensao_fase_c"];
      const campFp   = ["fator_potencia_a","fator_potencia_b","fator_potencia_c"];

      // ===== CORRENTE — 1 linha (média das 3 fases) =====
      const dsCorrente = [...par("Corrente (média 3 fases)", p => mediaCampos(p, campCorr), "#1E6FD6")];
      if (fasesExpandidas("corrente")) {
        // Fases individuais como linhas finas e desbotadas (sem reconstrução pra não poluir)
        dsCorrente.push(
          { label: "Fase A", data: pontos.map(p => p.corrente_fase_a ?? null), borderColor: "rgba(18,59,122,.45)", borderWidth: 1.2, pointRadius: 0, tension: .25, _faseExtra: true },
          { label: "Fase B", data: pontos.map(p => p.corrente_fase_b ?? null), borderColor: "rgba(30,111,214,.45)", borderWidth: 1.2, pointRadius: 0, tension: .25, _faseExtra: true },
          { label: "Fase C", data: pontos.map(p => p.corrente_fase_c ?? null), borderColor: "rgba(0,184,240,.45)",  borderWidth: 1.2, pointRadius: 0, tension: .25, _faseExtra: true },
        );
      }
      this._upsertChart("corrente", box, "Corrente (A)", labels, dsCorrente, { mostrarToggleFases: true });

      // ===== TENSÃO — 1 linha (média das 3 fases) =====
      const dsTensao = [...par("Tensão (média 3 fases)", p => mediaCampos(p, campTens), "#123B7A")];
      if (fasesExpandidas("tensao")) {
        dsTensao.push(
          { label: "Fase A", data: pontos.map(p => p.tensao_fase_a ?? null), borderColor: "rgba(18,59,122,.45)", borderWidth: 1.2, pointRadius: 0, tension: .25, _faseExtra: true },
          { label: "Fase B", data: pontos.map(p => p.tensao_fase_b ?? null), borderColor: "rgba(30,111,214,.45)", borderWidth: 1.2, pointRadius: 0, tension: .25, _faseExtra: true },
          { label: "Fase C", data: pontos.map(p => p.tensao_fase_c ?? null), borderColor: "rgba(0,184,240,.45)",  borderWidth: 1.2, pointRadius: 0, tension: .25, _faseExtra: true },
        );
      }
      this._upsertChart("tensao", box, "Tensão (V)", labels, dsTensao, { mostrarToggleFases: true });

      // ===== FP — 1 linha (média das 3 fases) + faixa ANEEL como linha de referência =====
      const dsFp = [...par("Fator de potência (média 3 fases)", p => mediaCampos(p, campFp), "#00B8F0")];
      dsFp.push({
        label: "Limite ANEEL (0,92)",
        data: pontos.map(() => 0.92),
        borderColor: "#dc2626", borderDash: [6,4], pointRadius: 0, borderWidth: 1.2,
        _refLine: true,
      });
      if (fasesExpandidas("fp")) {
        dsFp.push(
          { label: "Fase A", data: pontos.map(p => p.fator_potencia_a ?? null), borderColor: "rgba(18,59,122,.45)", borderWidth: 1.2, pointRadius: 0, tension: .25, _faseExtra: true },
          { label: "Fase B", data: pontos.map(p => p.fator_potencia_b ?? null), borderColor: "rgba(30,111,214,.45)", borderWidth: 1.2, pointRadius: 0, tension: .25, _faseExtra: true },
          { label: "Fase C", data: pontos.map(p => p.fator_potencia_c ?? null), borderColor: "rgba(0,184,240,.45)",  borderWidth: 1.2, pointRadius: 0, tension: .25, _faseExtra: true },
        );
      }
      this._upsertChart("fp", box, "Fator de potência", labels, dsFp, { mostrarToggleFases: true });

      // ===== POTÊNCIA ATIVA TOTAL — já é 1 linha, sem toggle =====
      const pot = (p) =>
        ((p.tensao_fase_a||0)*(p.corrente_fase_a||0)*(p.fator_potencia_a||0) +
         (p.tensao_fase_b||0)*(p.corrente_fase_b||0)*(p.fator_potencia_b||0) +
         (p.tensao_fase_c||0)*(p.corrente_fase_c||0)*(p.fator_potencia_c||0)) / 1000;
      this._upsertChart("potencia", box, "Potência ativa total (kW)", labels, [
        ...par("Potência total", pot, "#1E6FD6"),
      ]);
    }
    else if (this.sensor.tipo === "temperatura") {
      const faixa = PaginaSensor.FAIXAS_TERMICAS[this.sensor.grupo];
      const ds = [...par("Temperatura", p => p.temperatura, "#00B8F0")];
      if (faixa) {
        // Faixa ideal como ÁREA verde semitransparente (entre min e max).
        // Truque: 2 datasets superpostos — base no min com fill abaixo (transparente)
        // e topo no max com fill ATÉ a base anterior (verde claro).
        ds.push({
          label: `Mín ideal (${faixa.min}°C)`,
          data: pontos.map(() => faixa.min),
          borderColor: "rgba(22,163,74,.35)", borderWidth: 1,
          pointRadius: 0, fill: false, _refLine: true,
        });
        ds.push({
          label: `Máx ideal (${faixa.max}°C)`,
          data: pontos.map(() => faixa.max),
          borderColor: "rgba(22,163,74,.35)", borderWidth: 1,
          pointRadius: 0,
          fill: "-1",                     // preenche ATÉ o dataset anterior (min)
          backgroundColor: "rgba(22,163,74,.10)",
          _refLine: true,
        });
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
  /**
   * Charts que ficam AO VIVO por padrão. Os demais (tensão, FP, potência)
   * abrem PAUSADOS — o usuário ativa um por um se quiser. Isso evita
   * travamento em PCs lentos quando a página tem 4+ gráficos atualizando
   * a cada 3s simultaneamente.
   */
  _chartAoVivoDefault(chave) {
    return chave === "corrente" || chave === "temperatura" || chave === "porta";
  }

  _chartAoVivo(chave) {
    const sid = this.sensor?.id || "x";
    const v = sessionStorage.getItem(`__chart_aovivo_${sid}_${chave}`);
    if (v === "1") return true;
    if (v === "0") return false;
    return this._chartAoVivoDefault(chave);
  }

  _upsertChart(chave, parent, titulo, labels, datasets, opts = {}) {
    // Snapshot pro Exportador (PDF/XML/CSV). Salvamos a cada chamada — tanto
    // na criação quanto no update — pra que o botão sempre exporte o estado
    // EXATO renderizado no gráfico (incluindo toggle de fases, tipo, etc.).
    this.graficosMeta[chave] = { chave, titulo, labels, datasets, opts };

    const existente = this.graficos[chave];
    if (existente) {
      // Chart pausado: ignora updates do auto-refresh. Mantém visualização
      // congelada no último estado. Usuário ativa clicando "▶ Ao vivo".
      if (!this._chartAoVivo(chave) && !this._forcarUpdateChart) return;
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
          if (novo._faseExtra !== undefined)  ds._faseExtra = novo._faseExtra;
          if (novo._refLine !== undefined)    ds._refLine = novo._refLine;
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
    // Prefixa as keys com o ID do sensor pra cada página ter suas próprias
    // prefs — sem isso, "corrente em barras" no extrusora_1 vazaria pro
    // extrusora_2/3 e todos os outros sensores de energia.
    const sensorId = this.sensor?.id || "x";
    const keyFases  = `__chart_fases_${sensorId}_${chave}`;
    const keyTipo   = `__chart_tipo_${sensorId}_${chave}`;
    const keyAoVivo = `__chart_aovivo_${sensorId}_${chave}`;
    const expandido = sessionStorage.getItem(keyFases) === "1";
    const tipoSalvo = sessionStorage.getItem(keyTipo) === "bar" ? "bar" : "line";
    const aoVivo    = this._chartAoVivo(chave);
    const toggleFasesHtml = opts.mostrarToggleFases
      ? `<button type="button" class="chart-toggle-fases" data-chart-toggle="${chave}" aria-pressed="${expandido}">
           ${expandido ? "↑ Ocultar fases" : "↓ Ver fases A/B/C"}
         </button>`
      : "";
    const svgPlay = `<svg width="9" height="10" viewBox="0 0 9 10" aria-hidden="true"><path d="M1 1l7 4-7 4z" fill="currentColor"/></svg>`;
    const toggleAoVivoHtml = `
      <button type="button" class="chart-toggle-aovivo ${aoVivo ? "ativo" : "pausado"}"
              data-chart-aovivo="${chave}" aria-pressed="${aoVivo}"
              title="${aoVivo ? "Clique pra pausar atualização em tempo real" : "Clique pra ativar atualização em tempo real"}">
        ${aoVivo ? `<span class="chart-aovivo-dot"></span>Ao vivo` : `${svgPlay}<span>Ativar ao vivo</span>`}
      </button>`;
    const svgBarras = `<svg class="chart-toggle-ic" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2"  y="9" width="2.4" height="5"  rx=".4" fill="currentColor"/><rect x="6.8" y="6" width="2.4" height="8"  rx=".4" fill="currentColor"/><rect x="11.6" y="3" width="2.4" height="11" rx=".4" fill="currentColor"/></svg>`;
    const svgLinha  = `<svg class="chart-toggle-ic" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><polyline points="1.5,12 5,8 8.5,10 12,5 14.5,7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const toggleTipoHtml = `
      <button type="button" class="chart-toggle-tipo" data-chart-tipo="${chave}"
              title="Alternar entre linha e barras" aria-pressed="${tipoSalvo === "bar"}">
        ${tipoSalvo === "bar" ? svgLinha + "<span>Linha</span>" : svgBarras + "<span>Barras</span>"}
      </button>`;
    // 3 botões de exportar (PDF/XML/CSV) — gerados por _btnExport() pra
    // manter ícone+label consistentes e DRY entre formatos.
    const exportHtml = `
      <div class="chart-export" role="group" aria-label="Exportar relatório">
        <span class="chart-export-rotulo">Exportar:</span>
        ${this._btnExport(chave, "pdf")}
        ${this._btnExport(chave, "xml")}
        ${this._btnExport(chave, "csv")}
      </div>`;
    wrap.innerHTML = `
      <header class="chart-bloco-head">
        <h4>${titulo}</h4>
        <div class="chart-bloco-acoes">
          ${toggleAoVivoHtml}
          ${toggleFasesHtml}
          ${toggleTipoHtml}
          ${exportHtml}
        </div>
      </header>
      <div class="chart-wrap">
        <canvas></canvas>
        <button type="button" class="chart-overlay-ativar" data-chart-overlay="${chave}" hidden>
          ${svgPlay}
          <span>Clique pra atualizar em tempo real</span>
        </button>
      </div>`;
    if (!aoVivo) {
      wrap.classList.add("chart-bloco-pausado");
      wrap.querySelector(`[data-chart-overlay="${chave}"]`)?.removeAttribute("hidden");
    }
    parent.appendChild(wrap);

    // Overlay grande do centro do chart pausado — atalho pra ativar sem ter
    // que procurar o botão pequeno do header.
    wrap.querySelector(`[data-chart-overlay="${chave}"]`)?.addEventListener("click", () => {
      wrap.querySelector(`[data-chart-aovivo="${chave}"]`)?.click();
    });

    // Liga o toggle Ao vivo / Pausado.
    const btnAoVivo = wrap.querySelector(`[data-chart-aovivo="${chave}"]`);
    btnAoVivo?.addEventListener("click", () => {
      const eraAoVivo = this._chartAoVivo(chave);
      sessionStorage.setItem(keyAoVivo, eraAoVivo ? "0" : "1");
      const novoAoVivo = !eraAoVivo;
      btnAoVivo.className = `chart-toggle-aovivo ${novoAoVivo ? "ativo" : "pausado"}`;
      btnAoVivo.setAttribute("aria-pressed", String(novoAoVivo));
      btnAoVivo.title = novoAoVivo
        ? "Clique pra pausar atualização em tempo real"
        : "Clique pra ativar atualização em tempo real";
      btnAoVivo.innerHTML = novoAoVivo
        ? `<span class="chart-aovivo-dot"></span>Ao vivo`
        : `${svgPlay}<span>Ativar ao vivo</span>`;
      wrap.classList.toggle("chart-bloco-pausado", !novoAoVivo);
      const overlay = wrap.querySelector(`[data-chart-overlay="${chave}"]`);
      if (overlay) overlay.toggleAttribute("hidden", novoAoVivo);
      // Quando ATIVA, força um update imediato pra mostrar dados atuais
      // (em vez de esperar o próximo refresh automático).
      if (novoAoVivo) {
        this._forcarUpdateChart = true;
        try { this._renderizarGraficos(this.dados); } finally { this._forcarUpdateChart = false; }
      }
    });

    // Liga os 3 botões de export. Single handler delega pelo data-export.
    wrap.querySelectorAll("[data-export]").forEach(btn => {
      btn.addEventListener("click", () => this._exportarGrafico(chave, btn.dataset.export));
    });

    // Liga o toggle de fases.
    if (opts.mostrarToggleFases) {
      const btn = wrap.querySelector(`[data-chart-toggle="${chave}"]`);
      btn?.addEventListener("click", () => {
        const atual = sessionStorage.getItem(keyFases) === "1";
        sessionStorage.setItem(keyFases, atual ? "0" : "1");
        btn.textContent = !atual ? "↑ Ocultar fases" : "↓ Ver fases A/B/C";
        btn.setAttribute("aria-pressed", String(!atual));
        this._renderizarGraficos(this.dados);
      });
    }

    // Liga o toggle de tipo (linha ↔ barras). Trocar tipo no Chart.js
    // 4.x requer destruir e recriar — fazemos isso forçando re-render
    // do conjunto inteiro de gráficos.
    const btnTipo = wrap.querySelector(`[data-chart-tipo="${chave}"]`);
    btnTipo?.addEventListener("click", () => {
      const novo = sessionStorage.getItem(keyTipo) === "bar" ? "line" : "bar";
      sessionStorage.setItem(keyTipo, novo);
      // Limpa TUDO antes de re-renderizar. Sem isso o chart trocado ia
      // pro fim do parent e os outros subiam de posição — usuário via
      // "outros viraram bar" ou "o que cliquei continua linha".
      Object.values(this.graficos).forEach(c => { try { c?.destroy(); } catch {} });
      this.graficos = {};
      const box = document.querySelector("[data-charts]");
      if (box) box.innerHTML = "";
      // Suprime animação de 700ms na re-renderização — alternância instantânea.
      this._alternandoTipo = true;
      this._renderizarGraficos(this.dados);
      this._alternandoTipo = false;
    });

    const canvas = wrap.querySelector("canvas");

    // Em modo barra:
    //  - datasets normais (real/reconstruído/vazio) ganham backgroundColor
    //    sólido e perdem o tracejado (não funciona em bar);
    //  - datasets _refLine e _faseExtra ficam SEMPRE como linha
    //    sobreposta (mesma escala, visual de referência).
    const tipoChart = tipoSalvo;
    const datasetsFinal = datasets.map(d => {
      const novo = { ...d };
      if (tipoChart === "bar") {
        if (d._refLine || d._faseExtra) {
          novo.type = "line";    // sobrescreve no nível do dataset
        } else {
          // Fundo sólido com a cor da borda em tom semi-transparente
          // pra parecer "prediinho" sem ficar saturado demais.
          const cor = d.borderColor || "#1E6FD6";
          novo.backgroundColor = this._corBarra(cor, !!d.borderDash);
          // Tracejado não faz sentido em barra
          delete novo.borderDash;
          novo.borderWidth = d.borderDash ? 2 : 0;
          // Crítico: sem isso o `_estilizarDataset` vê fill:"start" e sobrescreve
          // o backgroundColor com gradient — aí as barras "somem" (gradiente
          // vertical com topo claro fica invisível no fundo branco).
          novo.fill = false;
        }
      }
      return novo;
    });
    const ds = datasetsFinal.map(d => this._estilizarDataset(d, canvas));

    const ch = new Chart(canvas, {
      type: tipoChart,
      data: { labels, datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        animation: this._alternandoTipo ? false : { duration: 700, easing: "easeOutCubic" },
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
              // Tooltip MINIMALISTA: hint pequeno indicando que dá pra clicar.
              afterBody: (items) => {
                if (!items?.length) return "";
                for (const it of items) {
                  const meta = it.dataset?.recInfo?.[it.dataIndex];
                  if (meta?.reconstruido) {
                    const conf = Math.round((meta.confianca || 0) * 100);
                    return ["", `🧩 ponto estimado · ${conf}% conf.`];
                  }
                }
                return ["", "📊 clique para ver detalhes"];
              },
            },
          },
        },
        // Click abre modal pra QUALQUER ponto.
        //  - Ponto reconstruído (roxo) → modo "estimado"
        //  - Ponto real (azul) → modo "real" com todos os campos do payload
        // Linhas-extras (faseExtra) e linhas de referência (refLine) são ignoradas.
        onClick: (ev, els, chart) => {
          if (!els?.length || typeof ModalReconstrucao === "undefined") return;
          for (const el of els) {
            const ds = chart.data.datasets[el.datasetIndex];
            if (!ds || ds._faseExtra || ds._refLine) continue;
            const valor = ds.data?.[el.index];
            if (valor == null) continue;
            const meta = ds.recInfo?.[el.index];
            const labelTempo = chart.data.labels?.[el.index];

            if (meta?.reconstruido) {
              // Modo estimado (modal existente)
              const dataPonto = meta.gap_inicio_ts && meta.gap_fim_ts
                ? new Date((new Date(meta.gap_inicio_ts).getTime() + new Date(meta.gap_fim_ts).getTime()) / 2).toISOString()
                : labelTempo;
              ModalReconstrucao.abrir({
                modo: "estimado",
                meta,
                rotuloDataset: ds.label?.replace(/\s+·\s+estimado.*$/i, "").replace(/\s+\(.*$/, "") || "Reconstrução",
                valorPonto: valor,
                dataPonto,
              });
              return;
            }

            // Modo real: passa o payload bruto do ponto (todos os 9 campos pra energia)
            const pontoBruto = this.dados?.points?.[el.index] || {};
            ModalReconstrucao.abrir({
              modo: "real",
              pontoDados: pontoBruto,
              sensorTipo: this.sensor.tipo,
              rotuloDataset: ds.label?.replace(/\s+\(.*$/, "") || "Leitura",
              valorPonto: valor,
              dataPonto: pontoBruto.time || labelTempo,
              historico: this._historicoEstendido || this.dados?.points || [],
            });
            return;
          }
        },
        // Cursor pointer ao passar sobre QUALQUER ponto clicável (real ou estimado).
        onHover: (ev, els, chart) => {
          const target = ev.native?.target;
          if (!target) return;
          const clicavel = els?.some(el => {
            const ds = chart.data.datasets[el.datasetIndex];
            return ds && !ds._faseExtra && !ds._refLine && ds.data?.[el.index] != null;
          });
          target.style.cursor = clicavel ? "pointer" : "default";
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

  // ===================================================================
  //  EXPORTAR RELATÓRIO (PDF · XML · CSV) — botões em cada gráfico
  // ===================================================================

  /** Gera o HTML de UM botão de export (PDF/XML/CSV) com o ícone certo. */
  _btnExport(chave, formato) {
    const ico = {
      pdf: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6M9 17h4"/></svg>`,
      xml: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13l-2 2 2 2M16 13l2 2-2 2M13 12l-2 6"/></svg>`,
      csv: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="8" y2="17"/><line x1="12" y1="13" x2="12" y2="17"/><line x1="16" y1="13" x2="16" y2="17"/></svg>`,
    }[formato];
    const titulo = { pdf: "Baixar PDF (impressão)", xml: "Baixar XML", csv: "Baixar CSV" }[formato];
    return `
      <button type="button" class="chart-export-btn export-${formato}"
              data-export="${formato}" data-chart-export="${chave}"
              title="${titulo}" aria-label="${titulo}">
        ${ico}<span>${formato.toUpperCase()}</span>
      </button>`;
  }

  /**
   * Monta o `ctx` do gráfico (snapshot + análise dos agentes) e dispara
   * o exportador no formato pedido. Tudo em memória, sem nova chamada
   * de API — usa exatamente o que está renderizado no canvas.
   */
  _exportarGrafico(chave, formato) {
    const meta = this.graficosMeta[chave];
    if (!meta) return;
    if (typeof ExportadorRelatorio === "undefined") {
      alert("Módulo ExportadorRelatorio não carregou.");
      return;
    }
    // Roda o analisador na janela atual pra anexar vereditos.
    let vereditos = [];
    try {
      if (typeof AnalisadorSensor !== "undefined" && this.sensor && this.dados?.points?.length) {
        const ver = new AnalisadorSensor(this.sensor, this.dados.points).avaliar();
        vereditos = Array.isArray(ver) ? ver : [];
      }
    } catch (e) {
      console.warn("Análise falhou; export segue sem vereditos:", e);
    }
    const ctx = {
      sensor:    this.sensor,
      janela:    this.janela,
      titulo:    meta.titulo,
      chave:     meta.chave,
      labels:    meta.labels,
      datasets:  meta.datasets,
      pontos:    this.dados?.points || [],
      fields:    this.dados?.fields || [],
      vereditos,
      // Pacote de reconstrução pro exportador marcar pontos estimados,
      // gerar resumo + tabela de gaps no PDF/XML/CSV.
      recon:     this._ultimoRecon || { pontos: [], gaps: [] },
    };
    if (formato === "pdf") return ExportadorRelatorio.paraPDF(ctx);
    if (formato === "xml") return ExportadorRelatorio.paraXML(ctx);
    if (formato === "csv") return ExportadorRelatorio.paraCSV(ctx);
  }

  /**
   * Cor de preenchimento das "barras-prédio" quando o chart está em modo bar.
   * Aceita hex (#123B7A) ou rgba(...) e devolve rgba(...) com alpha ajustado.
   * Datasets tracejados (linha reconstruída roxa) ficam mais transparentes
   * pra continuar visualmente distintos.
   */
  _corBarra(cor, eTracejado) {
    const alpha = eTracejado ? 0.45 : 0.85;
    if (typeof cor !== "string") return `rgba(30,111,214,${alpha})`;
    // hex (#1E6FD6 ou #1E6FD6FF)
    const hex = cor.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
    if (hex) {
      const n = parseInt(hex[1], 16);
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      return `rgba(${r},${g},${b},${alpha})`;
    }
    // rgba(...) ou rgb(...) — substitui o alpha
    const rgba = cor.match(/^rgba?\(([^)]+)\)$/i);
    if (rgba) {
      const partes = rgba[1].split(",").map(s => s.trim());
      return `rgba(${partes[0]},${partes[1]},${partes[2]},${alpha})`;
    }
    return cor;
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

    // OFFLINE AGORA: prioridade máxima — não importa se os pontos passados
    // estavam saudáveis. Se o sensor não está mandando nada nesse momento,
    // a "saúde da latência" é problema.
    if (this._estaOffline) {
      const inc = this._incidenteOffline;
      const tempo = this._segDesde < 60
        ? `${Math.round(this._segDesde)}s`
        : this._segDesde < 3600
          ? `${Math.floor(this._segDesde / 60)} min`
          : `${(this._segDesde / 3600).toFixed(1)}h`;
      const motivo = inc
        ? (inc.tipo === "gap" ? "Simulação de queda de conectividade ativa." : "Equipamento desligado pela Sala de Controle.")
        : `Última leitura há ${tempo}. Sensor parou de enviar dados.`;
      box.innerHTML = `
        <div class="latencia-saude saude-crit">
          <span class="latencia-saude-ponto"></span>
          <div>
            <div class="latencia-saude-titulo">Offline</div>
            <div class="latencia-saude-msg">${motivo}</div>
          </div>
        </div>
        <div class="latencia-grid">
          <div class="latencia-item"><div class="l">Sem leitura há</div><div class="v" style="color:#dc2626">${tempo}</div></div>
          <div class="latencia-item"><div class="l">Cadência esperada</div><div class="v">${this._formatarIntervalo(this._cadenciaObservada || this.sensor?.cadenciaSegundos || 60)}</div></div>
          <div class="latencia-item tem"><div class="l">Status</div><div class="v" style="color:#dc2626">offline</div></div>
          <div class="latencia-item tem"><div class="l">Tipo</div><div class="v">${inc ? inc.tipo : "—"}</div></div>
        </div>
        <div class="latencia-extra" style="color:#dc2626">
          Sensor parou de enviar dados. Espere voltar pra ver métricas novamente.
        </div>
      `;
      return;
    }

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
