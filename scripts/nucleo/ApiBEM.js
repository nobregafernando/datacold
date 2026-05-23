/**
 * Cliente HTTP que fala com 3 backends possíveis, escolhidos por URL base:
 *
 *   1) Supabase (PostgREST + RPCs)          ← DEFAULT no projeto inteiro
 *      https://fcverbceppwdbveustvq.supabase.co
 *
 *   2) Simulador Python local (FastAPI)     ← útil em dev quando o Supabase
 *      http://127.0.0.1:8001                  cai ou o usuário quer offline
 *
 *   3) API BEM real (hackathon)             ← se quiser bater na API original
 *      https://desafio.beminteligencia.com.br
 *
 * Os 3 expõem os mesmos 3 métodos (verificarSaude, listarCatalogo,
 * buscarDados) com o MESMO formato de resposta — o resto do front não
 * precisa saber qual é a fonte.
 *
 * Pra forçar uma backend específica em runtime:
 *   localStorage.setItem("datacold_api_url", "http://127.0.0.1:8001")
 *   localStorage.removeItem("datacold_api_url")   // volta pro default (Supabase)
 */
class ApiBEM {
  // === URLs disponíveis ===
  static URL_SUPABASE  = "https://fcverbceppwdbveustvq.supabase.co";
  static URL_SIMULADOR = "http://127.0.0.1:8001";
  static URL_BEM_REAL  = "https://desafio.beminteligencia.com.br";

  // === Chaves públicas (Supabase anon e hackathon BEM) ===
  // Ambas são públicas por design — anon do Supabase é destinada ao
  // browser, e a chave do hackathon estava hardcoded no explorador
  // desde o primeiro commit.
  static CHAVE_SUPABASE_ANON =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjdmVyYmNlcHB3ZGJ2ZXVzdHZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NTEzNTgsImV4cCI6MjA5NTEyNzM1OH0" +
    ".bI6SExnbpMGKI3bvOK2aGGa-NoV5PN_OTRhwPp5hays";
  static CHAVE_HACKATHON = "04379f4f1c57e0a01c5062ab5b224b2e863ad863";

  // === localStorage keys ===
  static URL_STORAGE   = "datacold_api_url";
  static CHAVE_STORAGE = "datacold_api_key";

  constructor({ urlBase = null, chave = null } = {}) {
    // Prioridade: argumento explícito > localStorage > default (Supabase).
    let salva = (typeof localStorage !== "undefined")
      ? localStorage.getItem(ApiBEM.URL_STORAGE)
      : null;
    // Migração: limpa URLs antigas do simulador local que estavam plantadas
    // antes do default virar Supabase. Assim a próxima visita já cai no novo.
    if (salva === "http://127.0.0.1:8001" || salva === "http://localhost:8001") {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(ApiBEM.URL_STORAGE);
        localStorage.removeItem(ApiBEM.CHAVE_STORAGE);   // chave antiga não serve no Supabase
      }
      salva = null;
    }
    this.urlBase = urlBase ?? salva ?? ApiBEM.URL_SUPABASE;

    // Chave guardada por usuário ou padrão por backend.
    let chaveSalva = (typeof localStorage !== "undefined")
      ? localStorage.getItem(ApiBEM.CHAVE_STORAGE)
      : null;
    // Se a chave salva claramente não pertence ao backend atual, troca:
    // - Backend Supabase exige um JWT (começa com "eyJ"). Se tiver outra
    //   coisa salva (ex: chave do hackathon plantada antes), substitui.
    // - Backend BEM/simulador NÃO aceita um JWT — se tiver, volta pra
    //   chave do hackathon.
    const ehSupabase = this.urlBase === ApiBEM.URL_SUPABASE;
    const pareceJwt  = !!chaveSalva && chaveSalva.startsWith("eyJ");
    const precisaTrocar =
      !chaveSalva ||
      chaveSalva === "simulador-local" ||
      (ehSupabase && !pareceJwt) ||
      (!ehSupabase && pareceJwt);
    if (precisaTrocar) {
      chaveSalva = this._chavePadrao();
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(ApiBEM.CHAVE_STORAGE, chaveSalva);
      }
    }
    this._chave = chave ?? chaveSalva;
  }

  // ===================================================================
  //  Configuração derivada da URL escolhida
  // ===================================================================

  /** true quando o backend é o Supabase. */
  get _ehSupabase() { return this.urlBase === ApiBEM.URL_SUPABASE; }

  /** Chave default por backend. */
  _chavePadrao() {
    return this._ehSupabase ? ApiBEM.CHAVE_SUPABASE_ANON : ApiBEM.CHAVE_HACKATHON;
  }

  /** Headers HTTP por backend. */
  get cabecalhos() {
    const h = { "Accept": "application/json" };
    if (this._ehSupabase) {
      // Supabase exige apikey + Authorization Bearer (ambos com a anon).
      h["apikey"]        = this._chave || ApiBEM.CHAVE_SUPABASE_ANON;
      h["Authorization"] = `Bearer ${this._chave || ApiBEM.CHAVE_SUPABASE_ANON}`;
    } else if (this._chave) {
      h["X-API-Key"] = this._chave;
    }
    return h;
  }

  get chave() { return this._chave; }
  set chave(valor) {
    this._chave = (valor || "").trim();
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ApiBEM.CHAVE_STORAGE, this._chave);
    }
  }

  // ===================================================================
  //  Núcleo de fetch
  // ===================================================================

  async _requisitar(caminho, opcoes = {}) {
    const url = `${this.urlBase}${caminho}`;
    const resposta = await fetch(url, {
      ...opcoes,
      headers: { ...this.cabecalhos, ...(opcoes.headers || {}) },
    });
    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => "");
      throw new Error(`HTTP ${resposta.status} · ${corpo.substring(0, 140)}`);
    }
    return resposta.json();
  }

  /** Helper para chamar RPCs do PostgREST (POST com body JSON). */
  async _rpc(nome, parametros = {}) {
    return this._requisitar(`/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parametros),
    });
  }

  // ===================================================================
  //  API pública (mesmo contrato pros 3 backends)
  // ===================================================================

  async verificarSaude() {
    return this._ehSupabase
      ? this._rpc("verificar_saude")
      : this._requisitar("/health");
  }

  async listarCatalogo() {
    return this._ehSupabase
      ? this._rpc("listar_catalogo")
      : this._requisitar("/api/v1/sensors");
  }

  async buscarDados(sensorId, { inicio = "-1h", fim = "now", limite = 1000 } = {}) {
    if (this._ehSupabase) {
      return this._rpc("buscar_dados", {
        p_sensor: sensorId,
        p_start:  inicio,
        p_stop:   fim,
        p_limit:  limite,
      });
    }
    const qs = new URLSearchParams({
      sensor: sensorId,
      start:  inicio,
      stop:   fim,
      limit:  String(limite),
    });
    return this._requisitar(`/api/v1/data?${qs.toString()}`);
  }

  // ===================================================================
  //  Extras (só Supabase) — disponíveis pra injetar/cancelar incidentes
  // ===================================================================

  async criarIncidente({ sensor, tipo, duracaoS = null, magnitude = 0, valor = 0, descricao = "" }) {
    if (!this._ehSupabase) {
      // No simulador local, usa o endpoint específico /sim/incidente
      return this._requisitar("/sim/incidente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sensor, tipo, duracao_s: duracaoS, magnitude, valor, descricao }),
      });
    }
    return this._rpc("criar_incidente", {
      p_sensor:    sensor,
      p_tipo:      tipo,
      p_duracao_s: duracaoS,
      p_magnitude: magnitude,
      p_valor:     valor,
      p_descricao: descricao,
    });
  }

  async cancelarIncidente(id) {
    if (!this._ehSupabase) {
      return this._requisitar(`/sim/incidente/${id}`, { method: "DELETE" });
    }
    return this._rpc("cancelar_incidente", { p_id: id });
  }
}

if (typeof window !== "undefined") window.ApiBEM = ApiBEM;
