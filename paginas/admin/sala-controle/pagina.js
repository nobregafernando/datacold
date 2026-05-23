/**
 * DataCold · Sala de Controle do simulador.
 *
 * Cada cartão mostra, em tempo real:
 *  - Última leitura gerada pelo agente fake
 *  - Receita do fake (personalidade + parâmetros físicos)
 *  - Comparativo "medido agora × receita base"
 *  - Botões pré-configurados pra injetar falhas
 *
 * Atualiza a cada 8s via Supabase RPC `buscar_dados`.
 */

(async () => {
  const usuario = Autenticacao.usuarioAtual();
  if (!usuario) { window.location.href = "../../login/login.html"; return; }

  const api = new ApiBEM();
  const raiz = "../../../";

  new MenuLateral({ usuario, raiz }).montar("#menu-lateral");
  new MenuTopo({ titulo: "Sala de Controle", raiz }).montar("#menu-topo");

  // ===================================================================
  //  PRESETS DE FALHAS POR TIPO
  // ===================================================================
  const PRESETS = {
    energia: [
      { acao:"pico_corrente",  titulo:"Pico de corrente",        sub:"spike 2.5× · 60s",   tipo:"spike",            magnitude:2.5,  duracaoS:60,
        severidade:"critica",  descricao:"Pico de corrente súbito (motor travando ou partida pesada)" },
      { acao:"queda_fp",       titulo:"Queda de FP",             sub:"drift −0.4 · 5 min", tipo:"drift",            magnitude:-0.4, duracaoS:300,
        severidade:"alta",     descricao:"Banco de capacitores queimou: fator de potência cai 0,4" },
      { acao:"sobrecarga",     titulo:"Sobrecarga térmica",      sub:"drift +30A · 3 min", tipo:"drift",            magnitude:30,   duracaoS:180,
        severidade:"alta",     descricao:"Motor sobrecarregando: corrente sobe gradualmente +30 A" },
      { acao:"desconectado",   titulo:"Desconectar da rede",     sub:"gap · 3 min",        tipo:"gap",              magnitude:0,    duracaoS:180,
        severidade:"media",    descricao:"Sensor perde conectividade — sem leituras por 3 minutos" },
      { acao:"offline",        titulo:"Equipamento parou",       sub:"offline · 5 min",    tipo:"offline",          magnitude:0,    duracaoS:300,
        severidade:"critica",  descricao:"Equipamento totalmente desligado por 5 minutos" },
      { acao:"valor_zoado",    titulo:"Leitura corrompida",      sub:"valor= −999 · 1 min",tipo:"valor_impossivel", magnitude:0, valor:-999, duracaoS:60,
        severidade:"media",    descricao:"Sensor reporta valor impossível (−999) por 1 minuto" },
    ],
    temperatura: [
      { acao:"superaquecer",   titulo:"Superaquecimento progressivo", sub:"drift +15°C · 10 min",  tipo:"drift",            magnitude:15,   duracaoS:600,
        severidade:"critica",  descricao:"Compressor falhando: temperatura sobe +15°C em 10 minutos" },
      { acao:"pico_calor",     titulo:"Pico súbito de calor",         sub:"drift +25°C · 1 min",   tipo:"drift",            magnitude:25,   duracaoS:60,
        severidade:"critica",  descricao:"Porta esquecida aberta: pico instantâneo de +25°C" },
      { acao:"congelar",       titulo:"Congelamento extremo",         sub:"drift −15°C · 5 min",   tipo:"drift",            magnitude:-15,  duracaoS:300,
        severidade:"alta",     descricao:"Setpoint mal configurado: temperatura cai −15°C" },
      { acao:"travado",        titulo:"Sensor travado",               sub:"valor= −22°C · 10 min", tipo:"valor_impossivel", magnitude:0, valor:-22, duracaoS:600,
        severidade:"alta",     descricao:"Sensor reporta sempre −22°C (sinal congelado)" },
      { acao:"desconectado",   titulo:"Desconectar da rede",          sub:"gap · 3 min",           tipo:"gap",              magnitude:0,    duracaoS:180,
        severidade:"media",    descricao:"Sensor para de enviar dados por 3 minutos" },
      { acao:"valor_zoado",    titulo:"Leitura absurda",              sub:"valor= +85°C · 30s",    tipo:"valor_impossivel", magnitude:0, valor:85, duracaoS:30,
        severidade:"media",    descricao:"Pico de leitura corrompida em +85°C (sensor com defeito)" },
    ],
    porta: [
      { acao:"porta_aberta",   titulo:"Porta presa aberta",           sub:"drift +100 · 30 min",   tipo:"drift",            magnitude:100,  duracaoS:1800,
        severidade:"critica",  descricao:"Porta esquecida aberta por 30 minutos" },
      { acao:"oscilacao",      titulo:"Porta oscilando",              sub:"spike 2× · 2 min",      tipo:"spike",            magnitude:2,    duracaoS:120,
        severidade:"alta",     descricao:"Sinal oscilando — porta batendo ou sensor com ruído" },
      { acao:"travado",        titulo:"Sensor travado",               sub:"valor= 0 · 10 min",     tipo:"valor_impossivel", magnitude:0, valor:0, duracaoS:600,
        severidade:"alta",     descricao:"Sensor de porta sem variação (ímã caiu ou reed quebrou)" },
      { acao:"desconectado",   titulo:"Desconectar da rede",          sub:"gap · 3 min",           tipo:"gap",              magnitude:0,    duracaoS:180,
        severidade:"media",    descricao:"Sensor para de enviar dados por 3 minutos" },
      { acao:"offline",        titulo:"Sensor offline",               sub:"offline · 5 min",       tipo:"offline",          magnitude:0,    duracaoS:300,
        severidade:"critica",  descricao:"Sensor totalmente offline por 5 minutos" },
    ],
  };

  // ===================================================================
  //  Estado
  // ===================================================================
  let sensores = [];
  let grupos = [];
  let perfisPorSensor = {};            // id → {personalidade, parametros}
  let incidentesAtivos = [];

  // ===================================================================
  //  Bootstrap
  // ===================================================================
  await Promise.all([carregarCatalogo(), carregarPerfis()]);
  renderizarGrade();
  await atualizar();
  setInterval(atualizar, 8000);

  ligarEventosTopo();

  // ===================================================================
  //  Carregamento
  // ===================================================================
  async function carregarCatalogo() {
    try {
      const d = await api.listarCatalogo();
      sensores = d.sensors || [];
      grupos   = d.groups  || [];
    } catch (e) {
      toast("Erro ao carregar catálogo", e.message, "erro");
      console.error("carregarCatalogo", e);
    }
  }

  async function carregarPerfis() {
    try {
      // SELECT direto na tabela sensores — pega personalidade + parametros JSONB
      const r = await fetch(`${api.urlBase}/rest/v1/sensores?select=id,personalidade,parametros`, {
        headers: api.cabecalhos,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const linhas = await r.json();
      linhas.forEach(l => { perfisPorSensor[l.id] = l; });
    } catch (e) {
      console.error("carregarPerfis", e);
    }
  }

  // ===================================================================
  //  Render da grade
  // ===================================================================
  function renderizarGrade() {
    const cont = document.querySelector("[data-grade]");
    if (!sensores.length) {
      cont.innerHTML = `<div class="sala-loading">Nenhum sensor disponível.</div>`;
      return;
    }

    const ordemGrupos = ["extrusao","camara_congelados","camara_estoque","graxaria","externo_campo_grande","externo_tres_lagoas"];
    const sensOrdenados = [...sensores].sort((a,b) => {
      const ia = ordemGrupos.indexOf(a.group), ib = ordemGrupos.indexOf(b.group);
      if (ia !== ib) return ia - ib;
      return a.id.localeCompare(b.id);
    });

    cont.innerHTML = sensOrdenados.map(s => {
      const presets = PRESETS[s.type] || [];
      const eHistorico = s.status === "historico";
      const grupo = grupos.find(g => g.id === s.group);
      const perfil = perfisPorSensor[s.id] || {};
      const params = perfil.parametros || {};

      return `
        <article class="sc-card tipo-${s.type} ${eHistorico ? "historico" : ""}" data-sensor="${s.id}">
          <div class="sc-stripe"></div>

          <div class="sc-head">
            <div>
              <h3>${s.label}</h3>
              <code>${s.id}</code>
              <div class="sc-grupo">${grupo ? grupo.label : s.group}</div>
            </div>
            <div class="sc-tags">
              <span class="sc-tipo ${s.type}">${s.type}</span>
              <span class="sc-status ${s.status}">${s.status}</span>
            </div>
          </div>

          <!-- Receita do fake -->
          <div class="sc-receita">
            <header>
              <span class="sr-eyebrow">Receita do agente fake</span>
              <button class="sr-toggle" data-toggle aria-label="expandir">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
            </header>
            <div class="sr-personalidade">${perfil.personalidade || "<i>sem personalidade definida</i>"}</div>
            <div class="sr-params" hidden>${renderizarParams(s.type, params)}</div>
          </div>

          <!-- Leitura ao vivo -->
          <div class="sc-leitura">
            <div class="sc-valor-bloco">
              <div class="sc-valor" data-valor>—</div>
              <div class="sc-extra" data-extra>${eHistorico ? "sensor histórico (sem dados ao vivo)" : "aguardando…"}</div>
              <div class="sc-quando" data-quando></div>
            </div>
            <div class="sc-spark" data-spark>
              <svg viewBox="0 0 110 44" preserveAspectRatio="none"></svg>
            </div>
          </div>

          <!-- Indicador medido vs receita -->
          <div class="sc-comparativo" data-comparativo>
            ${eHistorico ? "" : '<div class="sc-cmp-vazio">aguardando primeira leitura…</div>'}
          </div>

          <!-- Ações -->
          <div class="sc-acoes">
            ${presets.map(p => `
              <button class="sc-botao severidade-${p.severidade}"
                      data-preset='${JSON.stringify(p).replaceAll("'","&apos;")}'
                      ${eHistorico ? "disabled" : ""}>
                <span class="sb-titulo">${p.titulo}</span>
                <span class="sb-sub">${p.sub}</span>
              </button>
            `).join("")}
          </div>
        </article>
      `;
    }).join("");

    // toggle das receitas
    cont.querySelectorAll(".sc-card").forEach(card => {
      const toggle = card.querySelector("[data-toggle]");
      const params = card.querySelector(".sr-params");
      toggle.onclick = () => {
        params.hidden = !params.hidden;
        toggle.classList.toggle("aberto", !params.hidden);
      };
    });

    // clique nos botões de falha
    cont.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".sc-botao[data-preset]");
      if (!btn || btn.disabled) return;
      const card = btn.closest("[data-sensor]");
      const sensorId = card.dataset.sensor;
      const preset = JSON.parse(btn.dataset.preset.replaceAll("&apos;","'"));
      abrirModal(sensorId, preset);
    });
  }

  function renderizarParams(tipo, p) {
    if (!p || !Object.keys(p).length) return "<i>sem parâmetros</i>";
    const rotulos = {
      // energia
      corrente_nominal_a:"corrente nominal", corrente_desvio_a:"desvio de corrente",
      tensao_nominal_v:"tensão nominal",     tensao_desvio_v:"desvio de tensão",
      fp_base:"FP base",                     fp_desvio:"desvio de FP",
      cub_alvo_pct:"%CUB alvo",              fase_ausente:"fase ausente",
      drops_por_semana:"drops/semana",
      // temperatura
      setpoint_c:"setpoint",                 desvio_c:"desvio",
      media_real_c:"média real esperada",    amplitude_diaria_c:"amplitude diária",
      faixa_ideal_min:"faixa mín. ideal",    faixa_ideal_max:"faixa máx. ideal",
      ciclo_diario:"ciclo dia/noite",        sensor_defeituoso:"sensor defeituoso",
      prob_pico_defeito:"prob. pico defeito",prob_valor_impossivel:"prob. valor impossível",
      sobe_apos_porta_c:"sobe após porta",
      // porta
      aberturas_por_hora:"aberturas/hora",   duracao_media_s:"duração média",
      valor_aberto_max:"valor aberto máx.",  sinal_analogico:"sinal analógico",
    };
    const unidades = {
      corrente_nominal_a:"A", corrente_desvio_a:"A",
      tensao_nominal_v:"V",   tensao_desvio_v:"V",
      cub_alvo_pct:"%",
      setpoint_c:"°C", desvio_c:"°C", media_real_c:"°C",
      amplitude_diaria_c:"°C", faixa_ideal_min:"°C", faixa_ideal_max:"°C",
      sobe_apos_porta_c:"°C",
      duracao_media_s:"s",
    };
    return Object.entries(p)
      .filter(([k,v]) => v !== null && v !== "")
      .map(([k,v]) => {
        const rot = rotulos[k] || k;
        const unit = unidades[k] || "";
        let val = v;
        if (typeof v === "boolean") val = v ? "sim" : "não";
        return `<div class="sr-param"><span class="srp-k">${rot}</span><span class="srp-v">${val}${unit ? " " + unit : ""}</span></div>`;
      }).join("");
  }

  // ===================================================================
  //  Atualização periódica
  // ===================================================================
  async function atualizar() {
    document.querySelector('[data-kpi="sensores"]').textContent =
      sensores.filter(s => s.status === "ativo").length;

    // 1) incidentes ativos
    try {
      const r = await fetch(`${api.urlBase}/rest/v1/incidentes?removido_em=is.null&select=id,sensor_id,tipo,magnitude,valor,descricao,inicio,fim&order=inicio.desc`, {
        headers: api.cabecalhos,
      });
      incidentesAtivos = r.ok ? await r.json() : [];
    } catch { incidentesAtivos = []; }
    renderizarIncidentes();
    document.querySelector('[data-kpi="incidentes"]').textContent = incidentesAtivos.length;

    // 2) últimas leituras por sensor
    let total5min = 0;
    const promessas = sensores
      .filter(s => s.status === "ativo")
      .map(async (s) => {
        try {
          const d = await api.buscarDados(s.id, { inicio: "-15m", fim: "now", limite: 60 });
          const pontos = (d && d.points) ? d.points : [];
          atualizarCard(s, pontos);
          total5min += pontos.filter(p =>
            new Date(p.time).getTime() > (Date.now() - 5*60*1000)
          ).length;
        } catch (e) {
          console.error("buscarDados", s.id, e);
          atualizarCard(s, []);
        }
      });

    await Promise.all(promessas);
    document.querySelector('[data-kpi="leituras5min"]').textContent = total5min;
  }

  // ===================================================================
  //  Atualizar 1 card
  // ===================================================================
  function atualizarCard(s, pontos) {
    const card = document.querySelector(`[data-sensor="${s.id}"]`);
    if (!card) return;

    const elValor  = card.querySelector("[data-valor]");
    const elExtra  = card.querySelector("[data-extra]");
    const elQuando = card.querySelector("[data-quando]");
    const elCmp    = card.querySelector("[data-comparativo]");
    const svg      = card.querySelector("[data-spark] svg");
    const params   = (perfisPorSensor[s.id] || {}).parametros || {};

    if (!pontos.length) {
      elValor.textContent  = "—";
      elExtra.textContent  = "sem leituras na janela";
      elQuando.textContent = "";
      svg.innerHTML = "";
      elCmp.innerHTML = '<div class="sc-cmp-vazio">sem dados pra comparar com a receita</div>';
      card.classList.toggle("tem-incidente", incidentesAtivos.some(i => i.sensor_id === s.id));
      return;
    }

    const ultimo = pontos[pontos.length - 1];
    let valorTexto = "—", extraTexto = "";
    let valoresParaSpark = [];

    try {
      if (s.type === "energia") {
        const Im = (num(ultimo.corrente_fase_a) + num(ultimo.corrente_fase_b) + num(ultimo.corrente_fase_c)) / 3;
        const Vm = (num(ultimo.tensao_fase_a)   + num(ultimo.tensao_fase_b)   + num(ultimo.tensao_fase_c))   / 3;
        const FP = (num(ultimo.fator_potencia_a)+ num(ultimo.fator_potencia_b)+ num(ultimo.fator_potencia_c))/ 3;
        const P  = Im * Vm * FP * 3 / 1000;
        valorTexto = `${Im.toFixed(1)} A`;
        extraTexto = `V médio ${Vm.toFixed(0)} · FP ${FP.toFixed(2)} · ~${P.toFixed(1)} kW`;
        valoresParaSpark = pontos.map(p => (num(p.corrente_fase_a) + num(p.corrente_fase_b) + num(p.corrente_fase_c))/3);

        elCmp.innerHTML = comparativoEnergia({ Im, Vm, FP }, params);
      }
      else if (s.type === "temperatura") {
        const t = num(ultimo.temperatura);
        valorTexto = `${t.toFixed(1)} °C`;
        const vals = pontos.map(p => num(p.temperatura));
        const min = Math.min(...vals), max = Math.max(...vals);
        extraTexto = `min ${min.toFixed(1)} · max ${max.toFixed(1)} · σ ${desvio(vals).toFixed(2)}`;
        valoresParaSpark = vals;
        elCmp.innerHTML = comparativoTemperatura({ t, min, max }, params);
      }
      else if (s.type === "porta") {
        const v = num(ultimo.abertura_porta);
        const thr = params.valor_aberto_max ? params.valor_aberto_max * 0.5 : 0.5;
        const aberta = v > thr;
        valorTexto = aberta ? "ABERTA" : "fechada";
        const aberturas = contarAberturas(pontos);
        extraTexto = `${aberturas} aberturas em 15 min · sinal bruto ${v.toFixed(1)}`;
        valoresParaSpark = pontos.map(p => num(p.abertura_porta));
        elCmp.innerHTML = comparativoPorta({ aberta, aberturas, valor:v }, params);
      }
    } catch (e) {
      console.error("atualizarCard", s.id, e);
      valorTexto = "erro";
      extraTexto = String(e.message || e).substring(0, 60);
    }

    elValor.textContent  = valorTexto;
    elExtra.textContent  = extraTexto;
    elQuando.textContent = `última: ${formatarQuando(ultimo.time)}`;

    desenharSparkline(svg, valoresParaSpark);

    card.classList.toggle("tem-incidente", incidentesAtivos.some(i => i.sensor_id === s.id));
  }

  // ===================================================================
  //  Comparativo medido × receita
  // ===================================================================
  function comparativoEnergia(m, p) {
    if (!p || !Object.keys(p).length) return '<div class="sc-cmp-vazio">sem receita pra comparar</div>';
    const itens = [];
    if (p.corrente_nominal_a) itens.push(barra("corrente", m.Im, p.corrente_nominal_a, "A", 0));
    if (p.tensao_nominal_v)   itens.push(barra("tensão", m.Vm, p.tensao_nominal_v, "V", 0));
    if (p.fp_base !== undefined)
                              itens.push(barra("FP", m.FP, p.fp_base, "", 2));
    return itens.join("");
  }
  function comparativoTemperatura(m, p) {
    if (!p || !Object.keys(p).length) return '<div class="sc-cmp-vazio">sem receita pra comparar</div>';
    const itens = [];
    if (p.setpoint_c !== undefined)
      itens.push(barra("medido vs setpoint", m.t, p.setpoint_c, "°C", 1));
    if (p.faixa_ideal_min !== undefined && p.faixa_ideal_max !== undefined && p.faixa_ideal_min !== null)
      itens.push(faixa("dentro da faixa ideal", m.t, p.faixa_ideal_min, p.faixa_ideal_max, "°C"));
    return itens.length ? itens.join("") : '<div class="sc-cmp-vazio">sem referência</div>';
  }
  function comparativoPorta(m, p) {
    const itens = [];
    itens.push(`<div class="sc-cmp-linha"><span class="sl-l">estado agora</span><span class="sl-v ${m.aberta ? 'alerta':'ok'}">${m.aberta ? 'ABERTA' : 'fechada'}</span></div>`);
    if (p.aberturas_por_hora !== undefined) {
      const esperado = p.aberturas_por_hora * 0.25; // em 15 min
      itens.push(barra("aberturas (15 min)", m.aberturas, esperado, "", 1));
    }
    return itens.join("");
  }

  function barra(rotulo, medido, esperado, unidade, casas) {
    if (esperado === 0 || isNaN(esperado)) {
      return `<div class="sc-cmp-linha"><span class="sl-l">${rotulo}</span><span class="sl-v">${medido.toFixed(casas)}${unidade}</span></div>`;
    }
    const diff = (medido - esperado);
    const diffPct = (diff / Math.abs(esperado)) * 100;
    const cor = Math.abs(diffPct) < 10 ? "ok" : Math.abs(diffPct) < 25 ? "atencao" : "alerta";
    const sinal = diff >= 0 ? "+" : "";
    return `
      <div class="sc-cmp-linha">
        <span class="sl-l">${rotulo}</span>
        <span class="sl-medido">${medido.toFixed(casas)}${unidade}</span>
        <span class="sl-vs">vs receita ${esperado.toFixed(casas)}${unidade}</span>
        <span class="sl-diff ${cor}">${sinal}${diffPct.toFixed(0)}%</span>
      </div>
    `;
  }
  function faixa(rotulo, medido, lo, hi, unidade) {
    const dentro = medido >= lo && medido <= hi;
    return `
      <div class="sc-cmp-linha">
        <span class="sl-l">${rotulo}</span>
        <span class="sl-medido">${medido.toFixed(1)}${unidade}</span>
        <span class="sl-vs">faixa ${lo}${unidade} a ${hi}${unidade}</span>
        <span class="sl-diff ${dentro ? 'ok' : 'alerta'}">${dentro ? 'dentro' : 'FORA'}</span>
      </div>
    `;
  }

  // ===================================================================
  //  Incidentes
  // ===================================================================
  function renderizarIncidentes() {
    const lista = document.querySelector("[data-ib-lista]");
    if (!incidentesAtivos.length) {
      lista.innerHTML = `<div class="ib-vazio">Nenhum incidente injetado. Use os botões abaixo pra simular falhas.</div>`;
      return;
    }
    lista.innerHTML = incidentesAtivos.map(i => {
      const fimTexto = i.fim ? `expira em ${formatarRestante(i.fim)}` : "permanente";
      return `
        <div class="ib-item">
          <span class="ib-tipo">${i.tipo}</span>
          <div>
            <span class="ib-sensor">${i.sensor_id}</span>
            <span class="ib-desc"> · ${i.descricao || "sem descrição"}</span>
          </div>
          <span class="ib-tempo">${fimTexto}</span>
          <button class="ib-cancelar" data-cancelar="${i.id}" title="Cancelar incidente">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      `;
    }).join("");

    lista.querySelectorAll("[data-cancelar]").forEach(btn => {
      btn.onclick = async () => {
        try {
          await api.cancelarIncidente(btn.dataset.cancelar);
          toast("Incidente cancelado", btn.dataset.cancelar, "info");
          atualizar();
        } catch (e) { toast("Erro ao cancelar", e.message, "erro"); }
      };
    });
  }

  // ===================================================================
  //  Modal
  // ===================================================================
  function abrirModal(sensorId, preset) {
    const modal = document.querySelector("[data-modal]");
    const sensor = sensores.find(s => s.id === sensorId);
    document.querySelector("[data-modal-titulo]").textContent =
      `${preset.titulo} · ${sensor ? sensor.label : sensorId}`;

    const valorTxt = preset.valor !== undefined ? preset.valor : "—";
    document.querySelector("[data-modal-conteudo]").innerHTML = `
      <p>${preset.descricao}</p>
      <dl class="sm-params">
        <dt>sensor</dt><dd>${sensorId}</dd>
        <dt>tipo</dt><dd>${preset.tipo}</dd>
        <dt>magnitude</dt><dd>${preset.magnitude}</dd>
        <dt>valor</dt><dd>${valorTxt}</dd>
        <dt>duração</dt><dd>${preset.duracaoS}s (${(preset.duracaoS/60).toFixed(1)} min)</dd>
      </dl>
    `;

    modal.hidden = false;
    document.querySelector("[data-modal-confirmar]").onclick = async () => {
      modal.hidden = true;
      try {
        await api.criarIncidente({
          sensor: sensorId,
          tipo: preset.tipo,
          magnitude: preset.magnitude,
          valor: preset.valor || 0,
          duracaoS: preset.duracaoS,
          descricao: preset.descricao,
        });
        toast(`${preset.titulo} injetado`, `Em ${sensorId} por ${(preset.duracaoS/60).toFixed(1)} min`, "ok");
        atualizar();
      } catch (e) { toast("Erro ao injetar", e.message, "erro"); }
    };
  }
  document.querySelectorAll("[data-modal-close]").forEach(el => {
    el.onclick = () => document.querySelector("[data-modal]").hidden = true;
  });

  // ===================================================================
  //  Topbar
  // ===================================================================
  function ligarEventosTopo() {
    document.querySelector('[data-acao="atualizar"]').onclick = atualizar;
    document.querySelector('[data-acao="cancelar-todos"]').onclick = async () => {
      if (!incidentesAtivos.length) { toast("Sem incidentes", "Nada pra cancelar.", "info"); return; }
      if (!confirm(`Cancelar ${incidentesAtivos.length} incidente(s) ativos?`)) return;
      for (const i of incidentesAtivos) {
        try { await api.cancelarIncidente(i.id); } catch {/* segue */}
      }
      toast("Todos os incidentes cancelados", "", "ok");
      atualizar();
    };
  }

  // ===================================================================
  //  Utils
  // ===================================================================
  function num(v) { return Number(v) || 0; }

  function desenharSparkline(svg, valores) {
    if (!valores || valores.length < 2) { svg.innerHTML = ""; return; }
    const w = 110, h = 44, pad = 4;
    const min = Math.min(...valores), max = Math.max(...valores);
    const range = (max - min) || 1;
    const dx = (w - pad*2) / (valores.length - 1);
    const pts = valores.map((v, i) => [
      pad + dx * i,
      pad + (h - pad*2) * (1 - (v - min) / range),
    ]);
    const path = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const area = path + ` L ${pts[pts.length-1][0].toFixed(1)} ${h-pad} L ${pad} ${h-pad} Z`;
    svg.innerHTML = `<path class="area" d="${area}"></path><path d="${path}"></path>`;
  }

  function desvio(arr) {
    const m = arr.reduce((a,b)=>a+b,0)/arr.length;
    return Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/arr.length);
  }

  function contarAberturas(pontos) {
    if (!pontos.length) return 0;
    const valores = pontos.map(p => num(p.abertura_porta));
    const max = Math.max(...valores), min = Math.min(...valores);
    if (max === min) return 0;
    const thr = (max + min) / 2;
    let n = 0;
    for (let i=1;i<valores.length;i++) {
      if (valores[i] > thr && valores[i-1] <= thr) n++;
    }
    return n;
  }

  function formatarQuando(iso) {
    const t = new Date(iso);
    const seg = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (seg < 60) return `há ${seg}s`;
    if (seg < 3600) return `há ${Math.round(seg/60)}min`;
    return t.toLocaleString("pt-BR");
  }

  function formatarRestante(iso) {
    const t = new Date(iso);
    const seg = Math.round((t - Date.now()) / 1000);
    if (seg <= 0) return "agora";
    if (seg < 60) return `${seg}s`;
    return `${Math.round(seg/60)}min`;
  }

  function toast(titulo, msg, kind = "ok") {
    const cont = document.querySelector("[data-toasts]");
    const el = document.createElement("div");
    el.className = `sala-toast ${kind}`;
    el.innerHTML = `<strong>${titulo}</strong>${msg ? `<div>${msg}</div>` : ""}`;
    cont.appendChild(el);
    setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 400); }, 4000);
  }

})();
