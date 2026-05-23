/**
 * Cliente único que conversa com o backend via a Edge Function "proxy"
 * do Supabase. Nenhuma chave de API, anon key ou JWT de admin fica no
 * browser — tudo é resolvido server-side.
 *
 * Endpoint público (e o ÚNICO que esse cliente conhece):
 *   POST <PROXY_URL>
 *   body: { acao: "rpc:<nome>" | "auth:<acao>" | "perfil:buscar",
 *           payload?: any,
 *           jwt?: string         // token do usuário autenticado, se houver
 *         }
 *
 * O PROXY_URL pode ser alterado em runtime via:
 *   localStorage.setItem("datacold_proxy_url", "https://...")
 *
 * Default: edge function pública no Supabase do projeto.
 */
class ApiBEM {
  /** URL pública do proxy (Supabase Edge Function). Não é segredo, mas pode ser
   *  trocada via localStorage se um dia trocarmos de hospedagem. */
  static PROXY_URL_PADRAO =
    "https://fcverbceppwdbveustvq.supabase.co/functions/v1/proxy";

  static URL_STORAGE = "datacold_proxy_url";
  static JWT_STORAGE = "datacold_jwt";       // setado pelo Autenticacao

  constructor({ proxyUrl = null } = {}) {
    let salva = (typeof localStorage !== "undefined")
      ? localStorage.getItem(ApiBEM.URL_STORAGE)
      : null;
    // Migração: limpa configs antigas que apontavam pra Supabase direto ou
    // pro simulador local. A partir desta versão, tudo passa pelo proxy.
    if (
      salva && (
        salva.includes(".supabase.co") && !salva.includes("/functions/v1/proxy") ||
        salva.includes("127.0.0.1") ||
        salva.includes("localhost") ||
        salva.includes("beminteligencia")
      )
    ) {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(ApiBEM.URL_STORAGE);
        localStorage.removeItem("datacold_api_url");
        localStorage.removeItem("datacold_api_key");
      }
      salva = null;
    }
    this.proxyUrl = proxyUrl ?? salva ?? ApiBEM.PROXY_URL_PADRAO;
  }

  // ===================================================================
  //  Helpers internos
  // ===================================================================

  /** Retorna o JWT do usuário (se houver sessão real Supabase). */
  _jwt() {
    try {
      const cru = (typeof localStorage !== "undefined")
        ? localStorage.getItem(ApiBEM.JWT_STORAGE)
        : null;
      return cru || null;
    } catch { return null; }
  }

  /** Chamada base: monta o body { acao, payload, jwt }, faz POST no proxy. */
  async _chamar(acao, payload = {}) {
    const corpo = { acao, payload };
    const jwt = this._jwt();
    if (jwt) corpo.jwt = jwt;

    const resp = await fetch(this.proxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const texto = await resp.text().catch(() => "");
    let dados;
    try { dados = texto ? JSON.parse(texto) : null; }
    catch { dados = texto; }

    if (!resp.ok) {
      const msg = (dados && dados.erro) ? dados.erro : `HTTP ${resp.status}`;
      throw new Error(msg);
    }
    return dados;
  }

  /** Helpers tipados (cada um equivalente a uma rpc PostgREST). */
  _rpc(nome, parametros = {}) {
    return this._chamar(`rpc:${nome}`, parametros);
  }

  // ===================================================================
  //  API pública usada pelo front
  // ===================================================================

  async verificarSaude()      { return this._rpc("verificar_saude"); }
  async listarCatalogo()      { return this._rpc("listar_catalogo"); }

  async buscarDados(sensorId, { inicio = "-1h", fim = "now", limite = 1000 } = {}) {
    return this._rpc("buscar_dados", {
      p_sensor: sensorId, p_start: inicio, p_stop: fim, p_limit: limite,
    });
  }

  // ===================================================================
  //  Incidentes (Sala de Controle)
  // ===================================================================

  async criarIncidente({ sensor, tipo, duracaoS = null, magnitude = 0, valor = 0, descricao = "" }) {
    return this._rpc("criar_incidente", {
      p_sensor: sensor, p_tipo: tipo, p_duracao_s: duracaoS,
      p_magnitude: magnitude, p_valor: valor, p_descricao: descricao,
    });
  }

  async cancelarIncidente(id) {
    return this._rpc("cancelar_incidente", { p_id: id });
  }

  async incidentesAtivos(sensorId = null) {
    try {
      const r = await this._rpc("incidentes_ativos", { p_sensor: sensorId });
      return Array.isArray(r) ? r : [];
    } catch { return []; }
  }

  // ===================================================================
  //  Parâmetros por sensor (catálogo de overrides)
  // ===================================================================

  async atualizarParametrosSensor(sensor, parametros) {
    return this._rpc("atualizar_parametros_sensor", {
      p_sensor: sensor, p_parametros: parametros,
    });
  }

  async obterParametrosSensor(sensorId) {
    try {
      return await this._rpc("obter_parametros_sensor", { p_sensor: sensorId }) || {};
    } catch { return {}; }
  }

  // ===================================================================
  //  Dashboard admin — leituras agregadas
  // ===================================================================

  async listarPerfisSensores() {
    try {
      const r = await this._rpc("listar_perfis_sensores");
      return Array.isArray(r) ? r : [];
    } catch { return []; }
  }

  async listarIncidentesAtivosResumo() {
    try {
      const r = await this._rpc("listar_incidentes_ativos_resumo");
      return Array.isArray(r) ? r : [];
    } catch { return []; }
  }

  async listarUltimasLeituras() {
    try {
      const r = await this._rpc("listar_ultimas_leituras");
      return Array.isArray(r) ? r : [];
    } catch { return []; }
  }

  // ===================================================================
  //  Notificações multi-usuário (RLS por perfil; sem localStorage)
  // ===================================================================

  async listarMinhasNotificacoes({ limit = 50, offset = 0, status = "todas", severidade = null } = {}) {
    try {
      const r = await this._rpc("listar_minhas_notificacoes", {
        p_limit: limit, p_offset: offset, p_status: status, p_severidade: severidade,
      });
      return r || { notificacoes: [], total: 0 };
    } catch { return { notificacoes: [], total: 0 }; }
  }

  async contarNaoLidas() {
    try {
      return await this._rpc("contar_nao_lidas") || { total: 0, critica: 0 };
    } catch { return { total: 0, critica: 0 }; }
  }

  async marcarNotificacaoLida(id)      { return this._rpc("marcar_notificacao_lida", { p_id: id }); }
  async arquivarNotificacao(id)        { return this._rpc("arquivar_notificacao",     { p_id: id }); }
  async desarquivarNotificacao(id)     { return this._rpc("desarquivar_notificacao",  { p_id: id }); }
  async marcarTodasLidas()             { return this._rpc("marcar_todas_lidas"); }

  // ===================================================================
  //  Compatibilidade — antes existiam `chave` getter/setter usados pra
  //  exibir o "X-API-Key" no header. Hoje não tem mais chave no front.
  //  Mantemos os métodos como no-op pra não quebrar callsites antigos.
  // ===================================================================

  get chave() { return ""; }
  set chave(_) { /* no-op — não guardamos mais chaves no browser */ }
}

if (typeof window !== "undefined") window.ApiBEM = ApiBEM;
