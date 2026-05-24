/**
 * Página de comparativo de um grupo (Linha de Extrusão, Câmara de Estoque, etc.)
 *
 * - Lê o group_id do nome da pasta na URL.
 * - Lista todos os sensores do grupo.
 * - Busca dados de cada um em paralelo (Promise.all).
 * - Renderiza cards lado a lado, gráficos sobrepostos por tipo,
 *   ranking, insights e tabela comparativa.
 * - Atualiza tudo a cada 30s (pausa em aba escondida).
 */
class PaginaGrupo {

  /** Limite (qtde de pontos) por janela. Cresce nas janelas longas pra
   *  não cortar a série (a API devolve os mais recentes). Valores
   *  alinhados com sim_tick de 1 ponto/minuto. */
  static _limitePorJanela(j) {
    const mapa = {
      "-30m": 60, "-1h": 120, "-6h": 720, "-24h": 2000,
      "-72h": 4500, "-167h": 10000, "-15d": 22000, "-30d": 44000,
      "-90d": 100000,
    };
    return mapa[j] ?? 1000;
  }


  /** Sequência de cores pra atribuir uma cor única a cada sensor. */
  static CORES = ["#123B7A", "#1E6FD6", "#00B8F0", "#8EDBFF", "#7c3aed", "#d97706", "#16a34a", "#dc2626"];

  /** Helper: descobre o id do grupo pelo segmento da URL após "grupos". */
  static _extrairIdDaUrl() {
    const partes = window.location.pathname.split("/").filter(Boolean);
    const idx = partes.indexOf("grupos");
    return idx >= 0 ? partes[idx + 1] : null;
  }

  constructor() {
    this.api = new ApiBEM();
    this.grupoId = PaginaGrupo._extrairIdDaUrl();
    this.grupo = null;
    this.sensores = [];
    this.coresPorSensor = {};
    this.dadosPorSensor = {};
    this.janela = "-1h";
    this.graficos = [];
    this.autoTimer = null;
    this.autoIntervalo = 30000;
    this.carregando = false;
  }

  // =================================================================
  //  Boot
  // =================================================================

  async iniciar() {
    if (!Autenticacao.protegerPagina("../../../login/")) return;

    this.menu = new MenuLateral({ paginaAtiva: "grupo", raiz: "../../../../" });
    await this.menu.montar("#menu-lateral");

    this.grupo = this.menu.grupos.find(g => g.id === this.grupoId) || null;
    this.sensores = this.menu.sensores.filter(s => s.grupo === this.grupoId);
    this.sensores.forEach((s, i) => {
      this.coresPorSensor[s.id] = PaginaGrupo.CORES[i % PaginaGrupo.CORES.length];
    });

    this.topo = new MenuTopo({
      titulo: `Comparativo · ${this.grupo?.label || "Grupo"}`,
      raiz: "../../../../",
    });
    this.topo.montar("#menu-topo");

    this._renderizarCabecalho();
    this._renderizarCardsSensoresVazio();
    this._marcarJanelaAtiva();
    this._ligarEventos();

    await this._carregarDados();
    this._armarAutoRefresh();
  }

  _renderizarCabecalho() {
    const nome = document.querySelector("[data-grupo-nome]");
    const desc = document.querySelector("[data-grupo-descricao]");
    const meta = document.querySelector("[data-grupo-meta]");

    if (!this.grupo) {
      nome.textContent = "Grupo não encontrado";
      desc.textContent = `id "${this.grupoId}" não está no catálogo.`;
      meta.innerHTML = "";
      return;
    }
    nome.textContent = this.grupo.label;
    desc.textContent = this.grupo.description || "Comparativo entre os sensores deste grupo.";
    document.title = `DataCold · ${this.grupo.label} · Comparativo`;

    const tipos = [...new Set(this.sensores.map(s => s.tipo))];
    meta.innerHTML = `
      <span class="grupo-meta-pill">${this.sensores.length} sensor${this.sensores.length === 1 ? "" : "es"}</span>
      ${tipos.map(t => `<span class="grupo-meta-pill">${t}</span>`).join("")}
    `;
  }

  _renderizarCardsSensoresVazio() {
    const box = document.querySelector("[data-cards-sensores]");
    if (!this.sensores.length) {
      box.innerHTML = `<div class="vazio-bloco" style="grid-column:1/-1"><strong>Sem sensores</strong><span>Este grupo não tem sensores no catálogo.</span></div>`;
      return;
    }
    box.innerHTML = this.sensores.map(s => {
      const cor = this.coresPorSensor[s.id];
      return `
        <a href="../../sensores/${s.id}/" class="card-sensor-mini" style="--cor-sensor: ${cor}">
          <div class="card-mini-topo">
            <div class="card-mini-nome">${s.rotulo}</div>
            <div class="card-mini-cor"></div>
          </div>
          <div class="card-mini-rotulo">Aguardando dados</div>
          <div class="card-mini-valor">—</div>
          <div class="card-mini-sub">${s.tipo} · ${s.id}</div>
          <span class="card-mini-status off"><span class="ponto"></span>aguardando</span>
        </a>
      `;
    }).join("");
  }

  // =================================================================
  //  Eventos / auto-refresh
  // =================================================================

  _ligarEventos() {
    document.querySelectorAll("[data-janela]").forEach(b => {
      b.addEventListener("click", () => {
        this.janela = b.dataset.janela;
        this._marcarJanelaAtiva();
        this._carregarDados();
      });
    });
    document.querySelector("[data-acao='atualizar']")?.addEventListener("click", () => this._carregarDados());
      if (ev.key === "Enter") this._salvarChave();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this._pararAutoRefresh();
      else                 this._armarAutoRefresh();
    });
  }

  _marcarJanelaAtiva() {
    document.querySelectorAll("[data-janela]").forEach(b => {
      b.classList.toggle("ativo", b.dataset.janela === this.janela);
    });
  }

  _armarAutoRefresh() {
    this._pararAutoRefresh();
    this.autoTimer = setInterval(() => this._carregarDados(), this.autoIntervalo);
    document.querySelector("[data-aovivo]")?.classList.remove("pausado");
  }
  _pararAutoRefresh() {
    if (this.autoTimer) clearInterval(this.autoTimer);
    this.autoTimer = null;
    document.querySelector("[data-aovivo]")?.classList.add("pausado");
  }

  // =================================================================
  //  Carregar todos os sensores em paralelo
  // =================================================================

  async _carregarDados() {
    if (this.carregando || !this.sensores.length) return;
    // (banner de chave removido — chave padrão hardcoded no ApiBEM)

    this.carregando = true;
    try {
      const ehHistorico = this.sensores.some(s => s.historico);
      let inicio = this.janela, fim = "now";
      if (ehHistorico && !["-72h","-167h","-24h","-15d","-30d"].includes(inicio)) {
        inicio = "-90d"; fim = "-30d";
      }

      // Limite proporcional à janela (default 1000 cobre até ~16h em sensores
      // que enviam 1 ponto/min; 15-30d precisa de muito mais).
      const limite = PaginaGrupo._limitePorJanela(inicio);
      const promessas = this.sensores.map(s =>
        this.api.buscarDados(s.id, { inicio, fim, limite })
          .then(d => [s.id, d, null])
          .catch(e => [s.id, null, e.message])
      );
      const resultados = await Promise.all(promessas);
      this.dadosPorSensor = {};
      this.errosPorSensor = {};
      resultados.forEach(([id, d, err]) => {
        this.dadosPorSensor[id] = d;
        if (err) this.errosPorSensor[id] = err;
      });

      const ts = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      document.querySelector("[data-atualizado-em]").textContent = ts;

      this._renderizarConectividade();
      this._renderizarCardsSensores();
      this._renderizarGraficos();
      this._renderizarRanking();
      this._renderizarInsights();
      this._renderizarTabela();
    } catch (e) {
      this._estadoSemDados("Erro inesperado", e.message);
      console.error(e);
    } finally {
      this.carregando = false;
    }
  }

  _estadoSemDados(titulo, msg) {
    const blocoVazio = `<div class="vazio-bloco"><strong>${titulo}</strong><span>${msg}</span></div>`;
    const charts = document.querySelector("[data-charts]");
    if (charts) { this._destruirGraficos(); charts.innerHTML = blocoVazio; }
    document.querySelector("[data-ranking]").innerHTML = blocoVazio;
    document.querySelector("[data-insights]").innerHTML = `<li>${blocoVazio}</li>`;
    document.querySelector("[data-tabela-comparativa]").innerHTML = blocoVazio;
    const conec = document.querySelector("[data-conectividade]");
    conec.className = "conectividade conectividade-sem-chave";
    conec.innerHTML = `
      <span class="conectividade-pill"><span class="conectividade-ponto"></span><strong>${titulo}</strong></span>
      <span class="conectividade-info">${msg}</span>
    `;
  }

  // =================================================================
  //  Renderização
  // =================================================================

  _renderizarConectividade() {
    const conec = document.querySelector("[data-conectividade]");
    const total = this.sensores.length;
    let online = 0, offline = 0, instavel = 0;

    this.sensores.forEach(s => {
      const d = this.dadosPorSensor[s.id];
      if (!d || !d.points?.length) { offline++; return; }
      const ultimo = new Date(d.points[d.points.length - 1].time);
      const diff = (Date.now() - ultimo.getTime()) / 1000;
      const intervalos = [];
      for (let i = 1; i < d.points.length; i++) intervalos.push((new Date(d.points[i].time) - new Date(d.points[i-1].time)) / 1000);
      const medio = intervalos.length ? intervalos.reduce((a,b)=>a+b,0)/intervalos.length : 0;
      if (medio > 0 && diff > medio * 10)     offline++;
      else if (medio > 0 && diff > medio * 3) instavel++;
      else online++;
    });

    let status, titulo, info;
    if (offline === total)             { status = "offline";  titulo = "Todos offline"; info = `${total} sensor(es) sem leituras recentes.`; }
    else if (offline > 0 || instavel)  { status = "instavel"; titulo = "Conexão parcial"; info = `${online} online · ${instavel} instável · ${offline} offline`; }
    else                                { status = "online";   titulo = "Todos online";  info = `${total} sensor(es) enviando normalmente.`; }

    conec.className = `conectividade conectividade-${status}`;
    conec.innerHTML = `
      <span class="conectividade-pill"><span class="conectividade-ponto"></span><strong>${titulo}</strong></span>
      <span class="conectividade-info">${info}</span>
      <span class="conectividade-pontos">${this.janela}</span>
    `;
  }

  /** Cards mini: 1 valor-âncora por sensor (potência média, temp média, etc.) */
  _renderizarCardsSensores() {
    const box = document.querySelector("[data-cards-sensores]");
    box.innerHTML = this.sensores.map(s => {
      const cor = this.coresPorSensor[s.id];
      const d = this.dadosPorSensor[s.id];
      const erro = this.errosPorSensor?.[s.id];

      if (!d || !d.points?.length) {
        const motivo = erro ? "erro" : "sem dados";
        return `
          <a href="../../sensores/${s.id}/" class="card-sensor-mini" style="--cor-sensor: ${cor}">
            <div class="card-mini-topo">
              <div class="card-mini-nome">${s.rotulo}</div>
              <div class="card-mini-cor"></div>
            </div>
            <div class="card-mini-rotulo">${s.tipo}</div>
            <div class="card-mini-valor">—</div>
            <div class="card-mini-sub">${motivo} · ${s.id}</div>
            <span class="card-mini-status off"><span class="ponto"></span>${motivo}</span>
          </a>
        `;
      }

      const ind = s.calcularIndicadores(d.points);
      const primeiro = ind[0] || { rotulo: "—", valor: "—" };
      const sev = ind.find(i => i.severidade === "erro")
        ? "crit"
        : ind.find(i => i.severidade === "alerta") ? "warn" : "ok";
      const statusLabel = sev === "ok" ? "online" : sev === "warn" ? "atenção" : "crítico";

      return `
        <a href="../../sensores/${s.id}/" class="card-sensor-mini" style="--cor-sensor: ${cor}">
          <div class="card-mini-topo">
            <div class="card-mini-nome">${s.rotulo}</div>
            <div class="card-mini-cor"></div>
          </div>
          <div class="card-mini-rotulo">${primeiro.rotulo}</div>
          <div class="card-mini-valor">${primeiro.valor}</div>
          <div class="card-mini-sub">${s.tipo} · ${d.points.length} pontos</div>
          <span class="card-mini-status ${sev}"><span class="ponto"></span>${statusLabel}</span>
        </a>
      `;
    }).join("");
  }

  /** Gráficos sobrepostos: 1 série por sensor, agrupados por tipo. */
  _renderizarGraficos() {
    const box = document.querySelector("[data-charts]");
    this._destruirGraficos();
    box.innerHTML = "";

    if (typeof Chart === "undefined") {
      box.innerHTML = `<div class="vazio-bloco">Chart.js não carregou.</div>`;
      return;
    }

    const tipos = [...new Set(this.sensores.map(s => s.tipo))];
    tipos.forEach(tipo => {
      const ss = this.sensores.filter(s => s.tipo === tipo);
      if (tipo === "energia") this._chartEnergia(box, ss);
      else if (tipo === "temperatura") this._chartTemperatura(box, ss);
      else if (tipo === "porta") this._chartPorta(box, ss);
    });

    if (!box.children.length) {
      box.innerHTML = `<div class="vazio-bloco">Sem séries pra comparar.</div>`;
    }
  }

  /**
   * Reduz a quantidade de pontos para visualização preservando o shape
   * da curva (LTTB). Aplica o alvo derivado da janela ativa.
   */
  _reduzir(pares) {
    if (typeof Downsample === "undefined") return pares;
    const alvo = Downsample.alvoPorJanela(this.janela);
    return Downsample.aplicarXY(pares, alvo);
  }

  _chartEnergia(box, sensores) {
    // 1) Potência ativa total — uma série por sensor
    const datasets = sensores.map(s => {
      const d = this.dadosPorSensor[s.id];
      if (!d?.points?.length) return null;
      const dados = d.points.map(p => ({
        x: new Date(p.time).getTime(),
        y: ((p.tensao_fase_a||0)*(p.corrente_fase_a||0)*(p.fator_potencia_a||0) +
            (p.tensao_fase_b||0)*(p.corrente_fase_b||0)*(p.fator_potencia_b||0) +
            (p.tensao_fase_c||0)*(p.corrente_fase_c||0)*(p.fator_potencia_c||0)) / 1000,
      }));
      return {
        label: s.rotulo,
        data: this._reduzir(dados),
        borderColor: this.coresPorSensor[s.id],
        backgroundColor: this.coresPorSensor[s.id] + "20",
      };
    }).filter(Boolean);
    if (datasets.length) this._novoChart(box, "Potência ativa total (kW) — sobreposto", datasets);

    // 2) FP composto
    const dsFP = sensores.map(s => {
      const d = this.dadosPorSensor[s.id];
      if (!d?.points?.length) return null;
      const dados = d.points.map(p => ({
        x: new Date(p.time).getTime(),
        y: ((p.fator_potencia_a || 0) + (p.fator_potencia_b || 0) + (p.fator_potencia_c || 0)) / 3,
      }));
      return {
        label: s.rotulo,
        data: this._reduzir(dados),
        borderColor: this.coresPorSensor[s.id],
      };
    }).filter(Boolean);
    if (dsFP.length) {
      // adiciona linha de referência ANEEL (só nos extremos — Chart.js extrapola)
      const xs = dsFP[0].data;
      const ref = xs.length ? [{ x: xs[0].x, y: 0.92 }, { x: xs[xs.length - 1].x, y: 0.92 }] : [];
      dsFP.push({ label: "Limite ANEEL (0,92)", data: ref, borderColor: "#dc2626", borderDash: [6,4], pointRadius: 0 });
      this._novoChart(box, "Fator de potência composto — sobreposto", dsFP);
    }
  }

  _chartTemperatura(box, sensores) {
    const datasets = sensores.map(s => {
      const d = this.dadosPorSensor[s.id];
      if (!d?.points?.length) return null;
      const dados = d.points.map(p => ({ x: new Date(p.time).getTime(), y: p.temperatura }));
      return {
        label: s.rotulo,
        data: this._reduzir(dados),
        borderColor: this.coresPorSensor[s.id],
        backgroundColor: this.coresPorSensor[s.id] + "20",
      };
    }).filter(Boolean);
    if (datasets.length) this._novoChart(box, "Temperatura (°C) — sobreposto", datasets);
  }

  _chartPorta(box, sensores) {
    const datasets = sensores.map(s => {
      const d = this.dadosPorSensor[s.id];
      if (!d?.points?.length) return null;
      const dados = d.points.map(p => ({ x: new Date(p.time).getTime(), y: p.abertura_porta }));
      return {
        label: s.rotulo,
        data: this._reduzir(dados),
        borderColor: this.coresPorSensor[s.id],
        stepped: true,
      };
    }).filter(Boolean);
    if (datasets.length) this._novoChart(box, "Sinal de abertura — sobreposto", datasets);
  }

  _novoChart(parent, titulo, datasets) {
    const wrap = document.createElement("div");
    wrap.className = "chart-bloco";
    wrap.innerHTML = `<h4>${titulo}</h4><div class="chart-wrap"><canvas></canvas></div>`;
    parent.appendChild(wrap);

    const ds = datasets.map(d => ({
      ...d,
      borderWidth: 1.8,
      pointRadius: 1.2,
      pointHoverRadius: 4,
      tension: 0.15,
      fill: false,
    }));
    const ch = new Chart(wrap.querySelector("canvas"), {
      type: "line",
      data: { datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 250 },
        interaction: { mode: "nearest", intersect: false },
        plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 }, padding: 10 } } },
        scales: {
          x: {
            type: "linear",
            ticks: {
              callback: (v) => new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
              maxTicksLimit: 7, font: { size: 10 }, color: "#5b6b86",
            },
            grid: { color: "#eef1f7" },
          },
          y: { ticks: { font: { size: 10 }, color: "#5b6b86" }, grid: { color: "#eef1f7" } },
        },
      },
    });
    this.graficos.push(ch);
  }

  _destruirGraficos() {
    this.graficos.forEach(c => { try { c.destroy(); } catch {} });
    this.graficos = [];
  }

  // =================================================================
  //  Ranking + Insights + Tabela
  // =================================================================

  /** Calcula score 0-100 baseado em quantos indicadores estão ok. */
  _scoreSensor(s) {
    const d = this.dadosPorSensor[s.id];
    if (!d || !d.points?.length) return null;
    const ind = s.calcularIndicadores(d.points);
    const total = ind.length;
    const okPts = ind.reduce((acc, i) => {
      if (!i.severidade)         return acc + 1;
      if (i.severidade === "ok") return acc + 1;
      if (i.severidade === "alerta") return acc + 0.5;
      return acc;
    }, 0);
    return total > 0 ? Math.round(okPts / total * 100) : null;
  }

  _renderizarRanking() {
    const box = document.querySelector("[data-ranking]");
    const lista = this.sensores.map(s => ({
      sensor: s,
      cor: this.coresPorSensor[s.id],
      score: this._scoreSensor(s),
    })).filter(x => x.score !== null);

    if (!lista.length) {
      box.innerHTML = `<div class="vazio-bloco">Sem dados pra ranquear.</div>`;
      return;
    }
    lista.sort((a, b) => b.score - a.score);
    box.innerHTML = lista.map((x, i) => `
      <div class="ranking-item posicao-${i+1}" style="--cor-sensor: ${x.cor}">
        <div class="ranking-posicao">${i+1}</div>
        <div class="ranking-info">
          <div class="ranking-nome">${x.sensor.rotulo}</div>
          <div class="ranking-detalhe">${x.sensor.tipo} · ${x.sensor.id}</div>
        </div>
        <div class="ranking-pontuacao">
          <div class="valor">${x.score}</div>
          <div class="l">saúde</div>
        </div>
      </div>
    `).join("");
  }

  _renderizarInsights() {
    const box = document.querySelector("[data-insights]");
    const itens = [];

    const validos = this.sensores
      .map(s => ({ sensor: s, score: this._scoreSensor(s) }))
      .filter(x => x.score !== null);

    if (validos.length >= 2) {
      const ordenados = [...validos].sort((a, b) => b.score - a.score);
      const melhor = ordenados[0];
      const pior = ordenados[ordenados.length - 1];
      itens.push({
        classe: "melhor",
        icone: "🏆",
        titulo: `${melhor.sensor.rotulo} é o mais saudável`,
        detalhe: `Pontuação ${melhor.score}/100 baseada nos KPIs do tipo ${melhor.sensor.tipo}.`,
      });
      if (melhor.sensor.id !== pior.sensor.id) {
        itens.push({
          classe: "pior",
          icone: "⚠️",
          titulo: `${pior.sensor.rotulo} precisa de atenção`,
          detalhe: `Pontuação ${pior.score}/100 — diferença de ${melhor.score - pior.score} pontos pra liderança.`,
        });
      }
    }

    // Soma de potência (energia)
    const energia = this.sensores.filter(s => s.tipo === "energia");
    if (energia.length >= 2) {
      let somaP = 0, contam = 0;
      energia.forEach(s => {
        const d = this.dadosPorSensor[s.id];
        if (!d?.points?.length) return;
        const ind = s.calcularIndicadores(d.points);
        const p = parseFloat(ind.find(i => i.rotulo === "Potência média")?.valor);
        if (Number.isFinite(p)) { somaP += p; contam++; }
      });
      if (contam > 0) {
        itens.push({
          classe: "alerta",
          icone: "⚡",
          titulo: `Potência total do grupo: ${somaP.toFixed(1)} kW`,
          detalhe: `Soma da potência média de ${contam} equipamento(s) no intervalo ${this.janela}.`,
        });
      }
    }

    if (!itens.length) {
      box.innerHTML = `<li><div class="vazio-bloco">Sem insights nesse intervalo ainda.</div></li>`;
      return;
    }
    box.innerHTML = itens.map(it => `
      <li class="insight ${it.classe}">
        <div class="insight-icone">${it.icone}</div>
        <div class="insight-conteudo">
          <div class="insight-titulo">${it.titulo}</div>
          <div class="insight-detalhe">${it.detalhe}</div>
        </div>
      </li>
    `).join("");
  }

  _renderizarTabela() {
    const box = document.querySelector("[data-tabela-comparativa]");
    if (!this.sensores.length) { box.innerHTML = `<div class="vazio-bloco">Sem sensores.</div>`; return; }

    // Junta o conjunto de KPIs (rotulos) de todos os sensores
    const rotulosSet = new Set();
    const indicadoresPorSensor = {};
    this.sensores.forEach(s => {
      const d = this.dadosPorSensor[s.id];
      const ind = d?.points?.length ? s.calcularIndicadores(d.points) : [];
      indicadoresPorSensor[s.id] = ind;
      ind.forEach(i => rotulosSet.add(i.rotulo));
    });
    const rotulos = [...rotulosSet];

    if (!rotulos.length) {
      box.innerHTML = `<div class="vazio-bloco">Sem indicadores calculados.</div>`;
      return;
    }

    box.innerHTML = `
      <table class="tabela-comparativa">
        <thead>
          <tr>
            <th>Sensor</th>
            ${rotulos.map(r => `<th>${r}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${this.sensores.map(s => {
            const cor = this.coresPorSensor[s.id];
            const ind = indicadoresPorSensor[s.id] || [];
            const mapa = Object.fromEntries(ind.map(i => [i.rotulo, i]));
            return `
              <tr>
                <td class="nome"><span class="bola" style="background:${cor}"></span>${s.rotulo}</td>
                ${rotulos.map(r => {
                  const i = mapa[r];
                  if (!i) return `<td class="num">—</td>`;
                  const cls = i.severidade ? `sev-${i.severidade === "erro" ? "crit" : i.severidade === "alerta" ? "warn" : "ok"}` : "";
                  return `<td class="num ${cls}">${i.valor}</td>`;
                }).join("")}
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new PaginaGrupo().iniciar();
});
