/**
 * Cliente HTTP para a API BEM Inteligência.
 * Encapsula chamadas e armazena a chave em localStorage.
 */
class ApiBEM {
  static URL_PADRAO = "https://desafio.beminteligencia.com.br";
  static CHAVE_STORAGE = "datacold_api_key";

  constructor({ urlBase = ApiBEM.URL_PADRAO, chave = null } = {}) {
    this.urlBase = urlBase;
    this._chave = chave ?? localStorage.getItem(ApiBEM.CHAVE_STORAGE) ?? "";
  }

  get chave() { return this._chave; }
  set chave(valor) {
    this._chave = (valor || "").trim();
    localStorage.setItem(ApiBEM.CHAVE_STORAGE, this._chave);
  }

  get cabecalhos() {
    const h = { "Accept": "application/json" };
    if (this._chave) h["X-API-Key"] = this._chave;
    return h;
  }

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

  async verificarSaude() {
    return this._requisitar("/health");
  }

  async listarCatalogo() {
    return this._requisitar("/api/v1/sensors");
  }

  async buscarDados(sensorId, { inicio = "-1h", fim = "now", limite = 1000 } = {}) {
    const qs = new URLSearchParams({
      sensor: sensorId,
      start: inicio,
      stop: fim,
      limit: String(limite),
    });
    return this._requisitar(`/api/v1/data?${qs.toString()}`);
  }
}

if (typeof window !== "undefined") window.ApiBEM = ApiBEM;
