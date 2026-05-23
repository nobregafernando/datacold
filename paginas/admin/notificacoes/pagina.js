/**
 * DataCold · Centro de Notificações
 *
 * 3 abas:
 *  - Ativas agora    → roda os 4 agentes em todos os sensores e mostra crit/warn
 *  - Catálogo        → todas as regras possíveis (sem inventar nada)
 *  - Histórico       → notificações salvas em localStorage pelo sistema Notificacoes
 *
 * Catálogo: extrai dinamicamente as REGRAS de cada agente (AgenteEnergia.REGRAS,
 * AgenteTemperatura.REGRAS, AgentePorta.REGRAS) + verificações comuns
 * (conectividade + telemetria do AgenteBase via VerificacoesComuns).
 */

(async () => {
  if (!Autenticacao.usuarioAtual()) { window.location.href = "../../login/"; return; }
  const api = new ApiBEM();

  await new MenuLateral({ paginaAtiva: "notificacoes", raiz: "../../../" }).montar("#menu-lateral");
  new MenuTopo({ titulo: "Notificações", raiz: "../../../" }).montar("#menu-topo");

  // === Catálogo de tipos (4 agentes + verificações comuns) ===
  const TIPOS = [
    {
      id: "energia",
      nome: "Agente · Energia",
      sub: "Avalia medidores trifásicos: FP, balanceamento, picos, carga, phantom load.",
      icone: "E",
      regras: AgenteEnergia.REGRAS || [],
    },
    {
      id: "temperatura",
      nome: "Agente · Temperatura",
      sub: "Avalia câmaras frias e sensores ambiente: faixa térmica, oscilação, tendência, defeitos.",
      icone: "T",
      regras: AgenteTemperatura.REGRAS || [],
    },
    {
      id: "porta",
      nome: "Agente · Porta",
      sub: "Avalia sensores de porta: tempo aberta, rajadas, padrão evolutivo.",
      icone: "P",
      regras: AgentePorta.REGRAS || [],
    },
    {
      id: "todos",
      nome: "Verificações comuns · todos os sensores",
      sub: "Aplicadas por todos os agentes (vêm do AgenteBase + VerificacoesComuns).",
      icone: "✓",
      regras: [
        { id: "conectividade", categoria: "Conectividade", label: "Sensor está online?",
          fonte: "NORMAS.TELEMETRIA.offline_multiplicador",
          sevsPossiveis: ["ok","warn","crit","info"] },
        { id: "telemetria",    categoria: "Telemetria",    label: "A telemetria é confiável?",
          fonte: "NORMAS.TELEMETRIA.gap_multiplicador",
          sevsPossiveis: ["ok","warn","crit","info"] },
      ],
    },
  ];

  // Calcula severidades possíveis de cada Regra inspecionando o código da função `avaliar`
  function severidadesDe(regra) {
    if (Array.isArray(regra.sevsPossiveis)) return regra.sevsPossiveis;
    const src = String(regra.avaliar || "");
    const sevs = new Set();
    for (const m of src.matchAll(/status:\s*["'`](\w+)["'`]/g)) sevs.add(m[1]);
    return Array.from(sevs);
  }

  // ============ TABS ============
  document.querySelectorAll(".notif-tabs button").forEach(b => {
    b.onclick = () => {
      document.querySelectorAll(".notif-tabs button").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      document.querySelectorAll("[data-painel]").forEach(p => p.hidden = p.dataset.painel !== b.dataset.tab);
    };
  });

  // ============ AÇÕES TOPO ============
  document.querySelector("[data-acao='atualizar']").onclick = () => { renderizar(); };
  document.querySelector("[data-acao='marcar-todas']").onclick = () => {
    Notificacoes.marcarTodasLidas?.();
    renderizar();
  };

  // ============ CATÁLOGO ============
  function renderizarCatalogo() {
    const cont = document.querySelector("[data-catalogo]");
    let total = 0;
    cont.innerHTML = TIPOS.map(t => {
      total += t.regras.length;
      return `
        <article class="notif-grupo tipo-${t.id}">
          <header class="notif-grupo-cab">
            <div class="notif-grupo-icone">${t.icone}</div>
            <div>
              <h3>${t.nome}</h3>
              <div class="sub">${t.sub}</div>
            </div>
            <span class="conta">${t.regras.length} regra${t.regras.length > 1 ? "s" : ""}</span>
          </header>
          <div class="notif-regras">
            ${t.regras.map(r => {
              const sevs = severidadesDe(r);
              return `
                <div class="notif-regra">
                  <div class="notif-regra-cab">
                    <span class="notif-regra-cat">${r.categoria || "—"}</span>
                    <span class="notif-regra-id">${r.id}</span>
                  </div>
                  <div class="notif-regra-label">${r.label}</div>
                  <div class="notif-regra-sevs">
                    ${sevs.map(s => `<span class="notif-regra-sev ${s}">${s}</span>`).join("")}
                  </div>
                  ${r.fonte ? `<div class="notif-regra-fonte">${r.fonte}</div>` : ""}
                </div>
              `;
            }).join("")}
          </div>
        </article>
      `;
    }).join("");
    document.querySelector("[data-total-regras]").textContent = total;
  }

  // ============ ATIVAS — roda agentes sobre os dados reais ============
  async function renderizarAtivas() {
    const cont = document.querySelector("[data-ativas]");
    cont.innerHTML = `<div class="notif-vazio">Avaliando agentes em todos os sensores…</div>`;

    try {
      const cat = await api.listarCatalogo();
      const sensores = (cat.sensors || []).map(s => FabricaSensor.criar(s));
      const ativas = [];

      await Promise.all(sensores.map(async (sensor) => {
        if (sensor.status === "historico") return;
        try {
          const dados = await api.buscarDados(sensor.id, { inicio: "-15m", fim: "now", limite: 60 });
          const pontos = dados?.points || [];
          if (!pontos.length) return;
          const verifs = new AnalisadorSensor(sensor, pontos).avaliar();
          verifs.filter(v => v.status === "crit" || v.status === "warn").forEach(v => {
            ativas.push({
              sensor, regraId: v.id, label: v.label, status: v.status,
              detalhe: v.detalhe || v.resumo, diagnostico: v.diagnostico,
              valorMedido: v.valorMedido, valorIdeal: v.valorIdeal, fonte: v.fonte,
            });
          });
        } catch (e) { /* ignora erro pontual */ }
      }));

      if (!ativas.length) {
        cont.innerHTML = `<div class="notif-vazio">Nenhuma notificação ativa no momento.<br>Tudo dentro dos limites.</div>`;
        return;
      }

      // Ordena: crit antes de warn, depois por sensor
      ativas.sort((a, b) => {
        const sev = { crit: 0, warn: 1 };
        if (sev[a.status] !== sev[b.status]) return sev[a.status] - sev[b.status];
        return a.sensor.id.localeCompare(b.sensor.id);
      });

      cont.innerHTML = ativas.map(a => itemHTML({
        severidade: a.status === "crit" ? "critica" : "alta",
        titulo: a.label,
        msg: `${a.sensor.rotulo}: ${a.detalhe || "—"}${a.diagnostico ? " — " + a.diagnostico : ""}`,
        sensorId: a.sensor.id,
        regraId: a.regraId,
        valor: a.valorMedido,
        ideal: a.valorIdeal,
        fonte: a.fonte,
      })).join("");
    } catch (e) {
      cont.innerHTML = `<div class="notif-vazio">Erro ao avaliar: ${e.message}</div>`;
    }
  }

  // ============ HISTÓRICO — lista do Notificacoes (localStorage) ============
  function renderizarHistorico() {
    const cont = document.querySelector("[data-historico]");
    const lista = Notificacoes.listar?.() || [];

    if (!lista.length) {
      cont.innerHTML = `<div class="notif-vazio">Nenhuma notificação no histórico.</div>`;
      return;
    }

    cont.innerHTML = lista.map(n => itemHTML({
      severidade: n.severidade || "comum",
      titulo: n.titulo || "(sem título)",
      msg: n.mensagem || "",
      sensorId: n.origem?.id,
      regraId: n.metadados?.codigo,
      valor: n.metadados?.valorMedido,
      ideal: n.metadados?.valorIdeal,
      fonte: n.metadados?.fonte,
      quando: n.criadaEm,
      lida: n.lido,
      id: n.id,
    })).join("");

    cont.querySelectorAll("[data-marcar-lida]").forEach(b => {
      b.onclick = () => { Notificacoes.marcarLida?.(b.dataset.marcarLida); renderizar(); };
    });
  }

  function itemHTML(o) {
    const sev = o.severidade || "comum";
    const meta = [];
    if (o.sensorId) meta.push(`<span>sensor <code>${o.sensorId}</code></span>`);
    if (o.regraId)  meta.push(`<span>regra <code>${o.regraId}</code></span>`);
    if (o.valor != null)  meta.push(`<span>medido: <strong>${o.valor}</strong></span>`);
    if (o.ideal != null)  meta.push(`<span>ideal: <strong>${o.ideal}</strong></span>`);
    if (o.fonte)    meta.push(`<span>fonte: ${o.fonte}</span>`);
    if (o.quando)   meta.push(`<span>${formatarQuando(o.quando)}</span>`);

    return `
      <article class="notif-item sev-${sev} ${o.lida ? "lida" : ""}">
        <div class="notif-item-sev">${rotuloSev(sev)}</div>
        <div class="notif-item-conteudo">
          <div class="notif-item-titulo">${o.titulo}</div>
          ${o.msg ? `<div class="notif-item-msg">${o.msg}</div>` : ""}
          ${meta.length ? `<div class="notif-item-meta">${meta.join("")}</div>` : ""}
        </div>
        ${o.id && !o.lida ? `<div class="notif-item-acoes"><button data-marcar-lida="${o.id}">Marcar como lida</button></div>` : ""}
      </article>
    `;
  }

  function rotuloSev(s) {
    return ({ critica: "crítica", alta: "atenção", media: "média", comum: "comum" })[s] || s;
  }

  function formatarQuando(iso) {
    if (!iso) return "";
    const t = new Date(iso);
    const seg = Math.max(0, Math.round((Date.now() - t.getTime()) / 1000));
    if (seg < 60) return `há ${seg}s`;
    if (seg < 3600) return `há ${Math.round(seg/60)} min`;
    if (seg < 86400) return `há ${Math.round(seg/3600)}h`;
    return t.toLocaleString("pt-BR");
  }

  // ============ KPIs ============
  function renderizarKpis() {
    const lista = Notificacoes.listar?.() || [];
    const cnt = { critica:0, alta:0, media:0, comum:0 };
    lista.forEach(n => { cnt[n.severidade || "comum"] = (cnt[n.severidade || "comum"] || 0) + 1; });
    document.querySelector("[data-kpi='total']").textContent    = lista.length;
    document.querySelector("[data-kpi='critica']").textContent  = cnt.critica;
    document.querySelector("[data-kpi='alta']").textContent     = cnt.alta;
    document.querySelector("[data-kpi='media']").textContent    = cnt.media;
    document.querySelector("[data-kpi='comum']").textContent    = cnt.comum;
    document.querySelector("[data-kpi='naoLidas']").textContent = lista.filter(n => !n.lido).length;
  }

  // ============ ORQUESTRA ============
  async function renderizar() {
    renderizarKpis();
    renderizarCatalogo();
    renderizarHistorico();
    await renderizarAtivas();
  }

  await renderizar();
  setInterval(renderizar, 15000);   // refresh a cada 15s
})();
