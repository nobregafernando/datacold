/**
 * Painel — primeira página interna.
 * Carrega o catálogo via ApiBEM e instancia cada sensor pela FabricaSensor.
 */
class PaginaPainel {
  constructor() {
    this.api = new ApiBEM();
    this.lista = document.getElementById("lista-sensores");
    this.seloStatus = document.querySelector("[data-status-texto]");
    this.sensores = [];
    this.areas = [];
  }

  async iniciar() {
    this._verificarStatus();
    await this._carregarSensores();
  }

  async _verificarStatus() {
    try {
      const saude = await this.api.verificarSaude();
      this.seloStatus.textContent = saude.demo_mode ? "API · modo demo" : "API · dados reais";
    } catch {
      this.seloStatus.textContent = "API offline";
    }
  }

  async _carregarSensores() {
    this.lista.innerHTML = `<div class="placeholder-carregando">Carregando catálogo…</div>`;
    try {
      const dados = await this.api.listarCatalogo();
      this.sensores = FabricaSensor.criarLista(dados.sensors || []);
      this.areas = dados.groups || [];
      this._renderizar();
    } catch (e) {
      this.lista.innerHTML = `<div class="aviso">Erro ao carregar catálogo: ${e.message}</div>`;
    }
  }

  _renderizar() {
    if (!this.sensores.length) {
      this.lista.innerHTML = `<div class="placeholder-carregando">Nenhum sensor disponível.</div>`;
      return;
    }
    const porId = new Map(this.sensores.map(s => [s.id, s]));
    const blocos = this.areas
      .map(area => ({ area, itens: (area.sensors || []).map(id => porId.get(id)).filter(Boolean) }))
      .filter(b => b.itens.length);

    this.lista.innerHTML = blocos.map(({ area, itens }) => `
      <section class="bloco-area">
        <header class="cabecalho-area">
          <h2>${area.label}</h2>
          ${area.description ? `<p>${area.description}</p>` : ""}
          <span class="contagem">${itens.length} sensor${itens.length > 1 ? "es" : ""}</span>
        </header>
        <div class="grade-sensores">
          ${itens.map(s => `
            <article class="item-sensor ${s.tipo}" data-id="${s.id}">
              <div class="topo">
                <span class="tag-tipo">${s.tipo}</span>
                <span class="id">${s.id}</span>
              </div>
              <h3>${s.rotulo}</h3>
              <div class="grupo">status: ${s.status}</div>
            </article>
          `).join("")}
        </div>
      </section>
    `).join("");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new PaginaPainel().iniciar();
});
