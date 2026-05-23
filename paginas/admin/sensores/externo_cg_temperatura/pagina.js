/**
 * Página de um sensor específico.
 * O ID é inferido pelo nome da pasta (segmento da URL após "sensores").
 * Monta o menu lateral, destaca o sensor atual e popula o header.
 * O conteúdo (conectividade, gráficos, alertas, latência) será desenvolvido depois.
 */
class PaginaSensor {
  constructor() {
    this.api = new ApiBEM();
    this.sensorId = PaginaSensor._extrairIdDaUrl();
    this.sensor = null;
    this.grupo = null;
  }

  static _extrairIdDaUrl() {
    const partes = window.location.pathname.split("/").filter(Boolean);
    const idx = partes.indexOf("sensores");
    return idx >= 0 ? partes[idx + 1] : null;
  }

  async iniciar() {
    if (!Autenticacao.protegerPagina("../../../login/login.html")) return;

    this.menu = new MenuLateral({ paginaAtiva: "sensor", raiz: "../../../../" });
    await this.menu.montar("#menu-lateral");
    if (this.sensorId) this.menu.destacarSensor(this.sensorId);

    this.sensor = this.menu.sensores.find(s => s.id === this.sensorId) || null;
    this.grupo  = this.menu.grupos.find(g => g.id === this.sensor?.grupo) || null;

    // Menu superior com sino de alertas — título mostra o nome do sensor.
    this.topo = new MenuTopo({
      titulo: this.sensor ? `Sensor · ${this.sensor.rotulo}` : "Sensor",
      raiz: "../../../../",
    });
    this.topo.montar("#menu-topo");

    this._renderizarCabecalho();
  }

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
}

document.addEventListener("DOMContentLoaded", () => {
  new PaginaSensor().iniciar();
});
