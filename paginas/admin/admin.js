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
    this.perfisPorSensor = {};   // id → {personalidade, parametros}
    this.incidentesAtivos = [];  // [{sensor_id, tipo, ...}]
    this.ultimaLeituraPorSensor = {}; // id → ISO timestamp da última leitura
  }

  async iniciar() {
    // 1. Proteger rota
    if (!Autenticacao.protegerPagina("../login//")) return;

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

    // 6. Carregar personalidade + incidentes + última leitura por sensor (conectividade real)
    await Promise.all([this._carregarPerfis(), this._carregarIncidentes(), this._carregarUltimasLeituras()]);
    // Atualiza conectividade a cada 30s sem rerender total
    setInterval(() => this._carregarUltimasLeituras().then(() => this._renderizarGrade()), 30000);

    // 7. KPIs + ambientes
    this._renderizarKpis();
    this._renderizarAmbientes();

    // 7. Botão atualizar
    document.querySelector("[data-acao='atualizar']").addEventListener("click", () => this._recarregar());

    // 8. Demo do sistema de notificações (uma única vez por usuário)
    this._disparoDemoNotificacoes();
  }

  /**
   * Demonstração do sistema de notificações.
   * Dispara um exemplo de cada severidade na primeira vez que o admin carrega.
   * REMOVER quando o detector de anomalias real for plugado.
   */
  _disparoDemoNotificacoes() {
    const CHAVE_DEMO = "datacold_demo_notificacoes";
    if (localStorage.getItem(CHAVE_DEMO)) return;
    localStorage.setItem(CHAVE_DEMO, "1");

    Notificacoes.critica(
      "Superaquecimento detectado",
      "Câmara de congelados acima de -8°C há 5 min — risco de perda de carga.",
      {
        origem: { tipo: "sensor", id: "congelados_temperatura", label: "Câmara de Congelados" },
        acao: { url: "sensores/congelados_temperatura/index.html", texto: "Abrir sensor" },
      }
    );
    Notificacoes.alta(
      "Fator de potência baixo",
      "Extrusora 2: FP=0,45 abaixo do limite ANEEL (0,92). Multa garantida.",
      {
        origem: { tipo: "sensor", id: "extrusora_2", label: "Extrusora 2" },
        acao: { url: "sensores/extrusora_2/index.html", texto: "Abrir sensor" },
      }
    );
    Notificacoes.media(
      "Calibração pendente",
      "Sensor de porta da câmara de estoque com leituras erráticas — recomenda calibrar.",
      { origem: { tipo: "sensor", id: "estoque_porta", label: "Porta do Estoque" } }
    );
    Notificacoes.comum(
      "Sincronização concluída",
      "Catálogo de 14 sensores atualizado a partir da API BEM.",
      { origem: { tipo: "sistema", label: "Sincronização" } }
    );
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
    await Promise.all([this._carregarPerfis(), this._carregarIncidentes()]);
    this._renderizarKpis();
    this._renderizarAmbientes();
  }

  async _carregarPerfis() {
    try {
      const r = await fetch(`${this.api.urlBase}/rest/v1/sensores?select=id,personalidade,parametros`, {
        headers: this.api.cabecalhos,
      });
      if (!r.ok) return;
      const linhas = await r.json();
      this.perfisPorSensor = {};
      linhas.forEach(l => { this.perfisPorSensor[l.id] = l; });
    } catch (e) { console.error("perfis", e); }
  }

  async _carregarIncidentes() {
    try {
      const r = await fetch(`${this.api.urlBase}/rest/v1/incidentes?removido_em=is.null&select=sensor_id,tipo`, {
        headers: this.api.cabecalhos,
      });
      this.incidentesAtivos = r.ok ? await r.json() : [];
    } catch { this.incidentesAtivos = []; }
  }

  /** Pega o `momento` da última leitura de cada sensor pela view do Supabase. */
  async _carregarUltimasLeituras() {
    try {
      const r = await fetch(`${this.api.urlBase}/rest/v1/ultima_leitura_por_sensor?select=sensor_id,momento`, {
        headers: this.api.cabecalhos,
      });
      if (!r.ok) return;
      const linhas = await r.json();
      this.ultimaLeituraPorSensor = {};
      linhas.forEach(l => { this.ultimaLeituraPorSensor[l.sensor_id] = l.momento; });
    } catch (e) { console.error("ultimas-leituras", e); }
  }

  /**
   * Calcula a conectividade real baseada no `momento` da última leitura.
   * online (verde) = recebeu há < 2 min
   * atraso (âmbar) = recebeu há < 15 min
   * mudo (cinza)   = recebeu há > 15 min (ou nunca)
   */
  _conectividade(sensorId) {
    const iso = this.ultimaLeituraPorSensor[sensorId];
    if (!iso) return { codigo: "mudo", rotulo: "sem leituras", segundos: null };
    const seg = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (seg < 120)  return { codigo: "online", rotulo: `há ${seg}s`,                segundos: seg };
    if (seg < 900)  return { codigo: "atraso", rotulo: `há ${Math.round(seg/60)} min`, segundos: seg };
    return            { codigo: "mudo",   rotulo: `há ${Math.round(seg/60)} min`, segundos: seg };
  }

  /**
   * Calcula a saúde do sensor combinando status declarado +
   * personalidade do gerador fake + incidentes ativos.
   */
  _saudeDoSensor(s) {
    // 1) Status declarado
    if (s.status === "offline") {
      return { codigo: "offline", rotulo: "offline", nivel: 0 };
    }
    if (s.status === "historico") {
      return { codigo: "historico", rotulo: "histórico", nivel: 2 };
    }
    // 2) Incidente ativo no momento
    const incidente = this.incidentesAtivos.find(i => i.sensor_id === s.id);
    if (incidente) {
      return { codigo: "critico", rotulo: "INCIDENTE", nivel: 1 };
    }
    // 3) Personalidade + parâmetros (problemas crônicos do gerador fake)
    const perfil = this.perfisPorSensor[s.id] || {};
    const p = (perfil.personalidade || "").toLowerCase();
    const params = perfil.parametros || {};

    const palavrasCriticas = ["crítico", "critico", "falha real", "ausente", "monofásico", "monofasico"];
    const palavrasAtencao  = ["queimado", "defeituoso", "defeito", "invertido", "fp baixo", "fp muito baixo", "desequilíbrio", "desequilibrio", "evolutivo"];

    if (palavrasCriticas.some(k => p.includes(k))) {
      return { codigo: "critico", rotulo: "crítico", nivel: 1 };
    }
    if (palavrasAtencao.some(k => p.includes(k))) {
      return { codigo: "atencao", rotulo: "atenção", nivel: 2 };
    }
    // FP <0,92 ou negativo
    if (params.fp_base !== undefined && (params.fp_base < 0.85)) {
      return { codigo: "critico", rotulo: "FP baixo", nivel: 1 };
    }
    if (params.fp_base !== undefined && params.fp_base < 0.92) {
      return { codigo: "atencao", rotulo: "FP baixo", nivel: 2 };
    }
    if (params.cub_alvo_pct !== undefined && params.cub_alvo_pct > 10) {
      return { codigo: "critico", rotulo: "desbalanceado", nivel: 1 };
    }
    if (params.sensor_defeituoso) {
      return { codigo: "atencao", rotulo: "defeito", nivel: 2 };
    }
    return { codigo: "saudavel", rotulo: "saudável", nivel: 4 };
  }

  // ===================================================================
  //  KPIs
  // ===================================================================

  _renderizarKpis() {
    const cont = document.querySelector("[data-kpis]");
    if (!cont) return;

    const total = this.sensores.length;
    const ambientes = this.grupos.length;
    const saudes = this.sensores.map(s => this._saudeDoSensor(s));
    const saudaveis = saudes.filter(x => x.codigo === "saudavel").length;
    const atencao   = saudes.filter(x => x.codigo === "atencao").length;
    const criticos  = saudes.filter(x => x.codigo === "critico").length;
    const historicos= saudes.filter(x => x.codigo === "historico").length;

    cont.innerHTML = `
      <div class="pf-kpi"><div class="pfk-v">${total}</div><div class="pfk-l">sensores</div></div>
      <div class="pf-kpi pfk-ok"><div class="pfk-v">${saudaveis}</div><div class="pfk-l">saudáveis</div></div>
      <div class="pf-kpi pfk-warn"><div class="pfk-v">${atencao}</div><div class="pfk-l">atenção</div></div>
      <div class="pf-kpi pfk-crit"><div class="pfk-v">${criticos}</div><div class="pfk-l">críticos</div></div>
      <div class="pf-kpi"><div class="pfk-v">${historicos}</div><div class="pfk-l">histórico</div></div>
      <div class="pf-kpi"><div class="pfk-v">${ambientes}</div><div class="pfk-l">ambientes</div></div>
    `;
  }

  // ===================================================================
  //  Grid plano: todos os sensores em cards iguais, com tag do ambiente
  // ===================================================================

  _renderizarAmbientes() {
    if (!this.sensores.length) {
      const cont = document.querySelector("[data-ambientes]");
      if (cont) cont.innerHTML = `<div class="placeholder-amb">Sem sensores no catálogo.</div>`;
      return;
    }
    this._filtroAmbiente = this._filtroAmbiente || "todos";
    this._renderizarFiltros();
    this._renderizarGrade();
  }

  _renderizarFiltros() {
    const cont = document.querySelector("[data-filtros-ambiente]");
    if (!cont) return;
    const ordem = ["extrusao","camara_congelados","camara_estoque","graxaria","externo_campo_grande","externo_tres_lagoas"];
    const filtros = [
      { id: "todos", label: "Todos", count: this.sensores.length },
      ...ordem.map(gid => {
        const grupo = this.grupos.find(g => g.id === gid);
        if (!grupo) return null;
        const itens = this.sensores.filter(s => s.grupo === gid);
        if (!itens.length) return null;
        return { id: gid, label: grupo.label, count: itens.length };
      }).filter(Boolean),
    ];
    cont.innerHTML = filtros.map(f => `
      <button class="chip-filtro ${this._filtroAmbiente === f.id ? 'ativo' : ''}" data-filtro-amb="${f.id}">
        ${f.id !== 'todos' ? `<span class="cf-ico" data-amb="${f.id}">${PaginaAdmin.ICONES_AMBIENTE[f.id] || ''}</span>` : ''}
        <span class="cf-label">${f.label}</span>
        <span class="cf-count">${f.count}</span>
      </button>
    `).join("");
    cont.querySelectorAll("[data-filtro-amb]").forEach(b => {
      b.onclick = () => {
        this._filtroAmbiente = b.dataset.filtroAmb;
        this._renderizarFiltros();
        this._renderizarGrade();
      };
    });
  }

  _renderizarGrade() {
    const cont = document.querySelector("[data-ambientes]");
    if (!cont) return;
    const filtrados = this._filtroAmbiente === "todos"
      ? this.sensores
      : this.sensores.filter(s => s.grupo === this._filtroAmbiente);

    if (!filtrados.length) {
      cont.innerHTML = `<div class="placeholder-amb">Sem sensores neste filtro.</div>`;
      return;
    }

    // ordena: críticos primeiro, depois atenção, depois saudáveis, depois histórico/offline
    const peso = { critico: 0, atencao: 1, saudavel: 2, historico: 3, offline: 4 };
    const ordemGrupo = ["extrusao","camara_congelados","camara_estoque","graxaria","externo_campo_grande","externo_tres_lagoas"];
    const ordenados = [...filtrados].sort((a, b) => {
      const sa = this._saudeDoSensor(a).codigo;
      const sb = this._saudeDoSensor(b).codigo;
      if (peso[sa] !== peso[sb]) return peso[sa] - peso[sb];
      const ga = ordemGrupo.indexOf(a.grupo);
      const gb = ordemGrupo.indexOf(b.grupo);
      if (ga !== gb) return ga - gb;
      return a.id.localeCompare(b.id);
    });

    cont.innerHTML = ordenados.map(s => this._renderizarSensorCard(s)).join("");
  }

  _renderizarSensorCard(s) {
    const saude = this._saudeDoSensor(s);
    const conn  = this._conectividade(s.id);
    const pin   = this._corDoPin(saude, conn);
    const grupo = this.grupos.find(g => g.id === s.grupo);
    const perfil = this.perfisPorSensor[s.id] || {};
    const tooltip = `${s.rotulo} · ${saude.rotulo}\nÚltima leitura ${conn.rotulo}${perfil.personalidade ? '\n' + perfil.personalidade : ''}`;
    const url = `sensores/${encodeURIComponent(s.id)}/index.html`;
    return `
      <a class="sensor-bento tipo-${s.tipo} saude-${saude.codigo}" href="${url}" title="${tooltip}">
        <div class="sb-topo">
          <span class="sb-ico-tipo tipo-${s.tipo}">${PaginaAdmin.ICONES_TIPO[s.tipo] || ""}</span>
          <span class="sb-conn conn-${conn.codigo} pin-${pin}" title="Última leitura ${conn.rotulo} · saúde ${saude.rotulo}"></span>
        </div>
        <div class="sb-nome">${s.rotulo}</div>
        <div class="sb-rodape">
          <span class="sb-amb" data-amb="${s.grupo}">
            <span class="sb-amb-ico" data-amb="${s.grupo}">${PaginaAdmin.ICONES_AMBIENTE[s.grupo] || ""}</span>
            <span class="sb-amb-nome">${grupo ? grupo.label : s.grupo}</span>
          </span>
          <span class="saude-badge ${saude.codigo}">${saude.rotulo}</span>
        </div>
      </a>
    `;
  }

  _renderizarSensorPill(s) {
    const saude = this._saudeDoSensor(s);
    const url = `sensores/${encodeURIComponent(s.id)}/index.html`;
    const perfil = this.perfisPorSensor[s.id] || {};
    const tooltip = `${s.rotulo} · ${saude.rotulo}${perfil.personalidade ? '\n' + perfil.personalidade : ''}`;
    return `
      <a class="sensor-pill tipo-${s.tipo} saude-${saude.codigo}" href="${url}" title="${tooltip}">
        <span class="sp-ico tipo-${s.tipo}">${PaginaAdmin.ICONES_TIPO[s.tipo] || ""}</span>
        <div class="sp-conteudo">
          <div class="sp-nome">${s.rotulo}</div>
          <div class="sp-tipo">${this._rotuloTipo(s.tipo)}</div>
        </div>
        <span class="saude-badge ${saude.codigo}">${saude.rotulo}</span>
      </a>
    `;
  }

  _nivelSinal(s) {
    if (s.status === "ativo")     return 4;
    if (s.status === "historico") return 2;
    return 0;
  }

  /**
   * Decide a cor da bolinha como o PIOR caso entre saúde e rede:
   *   - crit  (vermelho): saúde crítica/offline, OU sensor mudo (sem leituras)
   *   - warn  (laranja):  saúde em atenção/histórico, OU rede com atraso
   *                       (e nada pior simultâneo)
   *   - ok    (verde):    saudável e online
   * Laranja só sobra pra cenários genuinamente intermediários.
   */
  _corDoPin(saude, conn) {
    const saudeCrit = saude.codigo === "critico" || saude.codigo === "offline";
    const saudeWarn = saude.codigo === "atencao" || saude.codigo === "historico";
    const connCrit  = conn.codigo === "mudo";
    const connWarn  = conn.codigo === "atraso";

    if (saudeCrit || connCrit) return "crit";
    if (saudeWarn || connWarn) return "warn";
    return "ok";
  }

  _rotuloTipo(t) {
    return ({ energia: "Energia", temperatura: "Temperatura", porta: "Porta" })[t] || t;
  }
}

PaginaAdmin.ICONES_TIPO = {
  energia:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
  temperatura: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4 4 0 1 0 5 0z"></path></svg>`,
  porta:       `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"></path><path d="M6 20V4h10v16"></path><circle cx="13" cy="12" r="1" fill="currentColor"></circle></svg>`,
};

PaginaAdmin.ICONES_AMBIENTE = {
  extrusao:              `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"></path><path d="M5 21V9l5 3V9l5 3V9l4 3v9"></path></svg>`,
  camara_congelados:     `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="5" y1="5" x2="19" y2="19"></line><line x1="19" y1="5" x2="5" y2="19"></line></svg>`,
  camara_estoque:        `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`,
  graxaria:              `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>`,
  externo_campo_grande:  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>`,
  externo_tres_lagoas:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>`,
  _default:              `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle></svg>`,
};

document.addEventListener("DOMContentLoaded", () => {
  new PaginaAdmin().iniciar();
});
