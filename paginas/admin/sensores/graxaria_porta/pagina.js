/**
 * Página de um sensor específico.
 * O ID é inferido pelo nome da pasta (segmento da URL após "sensores").
 * Monta o menu lateral, destaca o sensor atual, popula o header e renderiza
 * os achados automáticos (erros, motivos e recomendações).
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
    this._renderizarAchados();
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

  // ===================================================================
  //  Achados automáticos: erros, possíveis motivos e recomendações
  // ===================================================================

  _renderizarAchados() {
    const secao   = document.querySelector("[data-achados]");
    const resumo  = document.querySelector("[data-achados-resumo]");
    const lista   = document.querySelector("[data-achados-lista]");
    const rodape  = document.querySelector("[data-achados-rodape]");
    if (!secao || !lista) return;

    const fonte = Array.isArray(window.ACHADOS_SENSORES) ? window.ACHADOS_SENSORES : [];
    const achado = fonte.find(a => a.sensor === this.sensorId);

    if (!achado) {
      secao.hidden = false;
      resumo.innerHTML = "";
      lista.innerHTML = `
        <div class="achado-vazio">
          <strong>Sem investigação registrada para este sensor.</strong>
          <span>Quando a próxima rodada da análise automática rodar,
          os achados aparecem aqui.</span>
        </div>
      `;
      rodape.innerHTML = "";
      return;
    }

    const perguntas = achado.questions || [];
    const contagem = { crit: 0, warn: 0, info: 0, ok: 0 };
    perguntas.forEach(p => { contagem[p.status] = (contagem[p.status] || 0) + 1; });

    // Resumo (chips no topo)
    resumo.innerHTML = `
      <span class="resumo-chip crit"><strong>${contagem.crit}</strong> crítico${contagem.crit===1?"":"s"}</span>
      <span class="resumo-chip warn"><strong>${contagem.warn}</strong> atenção</span>
      <span class="resumo-chip info"><strong>${contagem.info}</strong> info</span>
      <span class="resumo-chip ok"><strong>${contagem.ok}</strong> ok</span>
    `;

    // Ordena: críticos primeiro, depois atenção, info, ok
    const ordem = { crit: 0, warn: 1, info: 2, ok: 3 };
    const ordenadas = [...perguntas].sort((a, b) =>
      (ordem[a.status] ?? 9) - (ordem[b.status] ?? 9)
    );

    lista.innerHTML = ordenadas.map(p => this._htmlAchado(p)).join("");

    rodape.innerHTML = `
      <span class="achados-meta">
        Baseado em <strong>${achado.count}</strong> pontos da janela
        <code>${achado.window || "—"}</code>
        · tipo <strong>${achado.type}</strong>
        · grupo <strong>${achado.group}</strong>
      </span>
    `;

    secao.hidden = false;
  }

  _htmlAchado(p) {
    const rotulo = {
      crit: "crítico",
      warn: "atenção",
      info: "informativo",
      ok:   "tudo certo",
    }[p.status] || p.status;

    const diagnostico = p.diagnostico
      ? `
        <div class="achado-bloco">
          <span class="achado-rotulo">Possíveis motivos e recomendação</span>
          <p>${this._escapar(p.diagnostico)}</p>
        </div>`
      : "";

    return `
      <article class="achado severidade-${p.status}">
        <header class="achado-topo">
          <span class="achado-sev">${rotulo}</span>
          <h3 class="achado-q">${this._escapar(p.q || "")}</h3>
        </header>
        <div class="achado-bloco achado-resposta">
          <span class="achado-rotulo">O que os dados mostram</span>
          <p>${this._escapar(p.answer || "—")}</p>
        </div>
        ${diagnostico}
      </article>
    `;
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
