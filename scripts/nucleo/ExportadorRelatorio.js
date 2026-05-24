/**
 * ExportadorRelatorio · gera CSV, XML e PDF a partir dos dados que já
 * estão na memória do gráfico (sem nova chamada de API).
 *
 * Uso:
 *   ExportadorRelatorio.paraCSV(ctx);
 *   ExportadorRelatorio.paraXML(ctx);
 *   ExportadorRelatorio.paraPDF(ctx);
 *
 * `ctx` é o pacote de contexto montado pelo PaginaSensor:
 *   {
 *     sensor:    { id, rotulo, tipo, grupo },
 *     janela:    "-5m" | "-1h" | "-15d" ...
 *     titulo:    "Corrente (A)" (título visível do gráfico),
 *     chave:     "energia_corrente",
 *     labels:    ["00:00:01", "00:00:02", ...]  (eixo X já formatado),
 *     datasets:  [{ label, data:[..], borderColor }, ...] (séries visíveis),
 *     pontos:    array bruto da API (this.dados.points),
 *     fields:    array de campos relevantes (this.dados.fields),
 *     vereditos: array de vereditos do AnalisadorSensor (status/categoria/...)
 *   }
 *
 * PDF não usa lib externa — abre janela em branco com HTML formatado
 * e dispara window.print(). O usuário escolhe "Salvar como PDF" no
 * diálogo do browser. Funciona em 100% dos browsers modernos.
 */
class ExportadorRelatorio {

  // ===================================================================
  //  API PÚBLICA
  // ===================================================================

  static paraCSV(ctx) {
    const reconInfo = ExportadorRelatorio._extrairReconstrucao(ctx);
    const linhas = [];
    linhas.push(`# Relatório DataCold · ${ExportadorRelatorio._fmtSensor(ctx.sensor)}`);
    linhas.push(`# Gráfico: ${ctx.titulo}`);
    linhas.push(`# Período: ${ExportadorRelatorio._fmtPeriodo(ctx.janela)}`);
    linhas.push(`# Gerado em: ${new Date().toLocaleString("pt-BR")}`);
    linhas.push(`# Total de pontos: ${ctx.labels?.length || 0}`);
    if (reconInfo.totalReconstruidos > 0) {
      linhas.push(`# Pontos reconstruídos por IA: ${reconInfo.totalReconstruidos} de ${reconInfo.totalPontos} (${reconInfo.pctReconstruidos.toFixed(1)}%)`);
      linhas.push(`# Confiabilidade média da reconstrução: ${(reconInfo.confiancaMedia * 100).toFixed(0)}%`);
      linhas.push(`# Gaps detectados: ${reconInfo.gaps.length}`);
      linhas.push(`# Origem por linha: "real" = leitura do sensor · "reconstruido" = estimado pelo AgenteReconstrutor (ensemble Hampel+SPLC+Kalman+Spline)`);
    }
    linhas.push("");

    // Cabeçalho: timestamp + origem + confianca + cada série
    const series = (ctx.datasets || []).filter(d => !d._refLine);
    const header = ["timestamp", "origem", "confianca_pct", ...series.map(d => ExportadorRelatorio._csvEsc(d.label || "valor"))];
    linhas.push(header.join(","));

    const n = ctx.labels?.length || 0;
    for (let i = 0; i < n; i++) {
      const origem = reconInfo.origemPorIndice[i] || "real";
      const conf   = reconInfo.confiancaPorIndice[i];
      const row = [
        ExportadorRelatorio._csvEsc(ctx.labels[i]),
        origem,
        conf != null ? (conf * 100).toFixed(0) : "",
      ];
      for (const ds of series) {
        const v = ds.data?.[i];
        row.push(v == null ? "" : (typeof v === "number" ? v : ExportadorRelatorio._csvEsc(v)));
      }
      linhas.push(row.join(","));
    }

    // Apêndice: gaps reconstruídos (detalhe técnico)
    if (reconInfo.gaps.length) {
      linhas.push("");
      linhas.push("# === Gaps reconstruídos pelo Agente ===");
      linhas.push(["inicio", "fim", "duracao_s", "n_pontos", "estrategias", "confianca_pct"].join(","));
      for (const g of reconInfo.gaps) {
        linhas.push([
          ExportadorRelatorio._csvEsc(g.inicio_ts),
          ExportadorRelatorio._csvEsc(g.fim_ts),
          g.duracao_s,
          g.n_reconstruidos,
          ExportadorRelatorio._csvEsc((g.estrategias || []).join("|")),
          ((g.confianca || 0) * 100).toFixed(0),
        ].join(","));
      }
    }

    // Apêndice: vereditos
    if (ctx.vereditos?.length) {
      linhas.push("");
      linhas.push("# === Análise dos agentes ===");
      linhas.push(["status", "categoria", "regra", "resumo", "diagnostico", "fonte"].join(","));
      for (const v of ctx.vereditos) {
        linhas.push([
          v.status, v.categoria,
          ExportadorRelatorio._csvEsc(v.label || v.id || ""),
          ExportadorRelatorio._csvEsc(v.resumo || ""),
          ExportadorRelatorio._csvEsc(v.diagnostico || ""),
          ExportadorRelatorio._csvEsc(v.fonte || ""),
        ].join(","));
      }
    }

    const blob = new Blob([linhas.join("\n")], { type: "text/csv;charset=utf-8" });
    ExportadorRelatorio._baixar(blob, ExportadorRelatorio._nomeArquivo(ctx, "csv"));
  }

  static paraXML(ctx) {
    const esc = ExportadorRelatorio._xmlEsc;
    const series = (ctx.datasets || []).filter(d => !d._refLine);
    const n = ctx.labels?.length || 0;
    const reconInfo = ExportadorRelatorio._extrairReconstrucao(ctx);

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<relatorio gerado_em="${new Date().toISOString()}" plataforma="DataCold">\n`;
    xml += `  <sensor id="${esc(ctx.sensor?.id)}" tipo="${esc(ctx.sensor?.tipo)}" grupo="${esc(ctx.sensor?.grupo)}">${esc(ctx.sensor?.rotulo)}</sensor>\n`;
    xml += `  <grafico chave="${esc(ctx.chave)}">${esc(ctx.titulo)}</grafico>\n`;
    xml += `  <periodo janela="${esc(ctx.janela)}" descricao="${esc(ExportadorRelatorio._fmtPeriodo(ctx.janela))}"/>\n`;

    // Bloco resumido de reconstrução (sempre presente; vazio quando 0 gaps)
    xml += `  <reconstrucao total_pontos="${n}" reconstruidos="${reconInfo.totalReconstruidos}" `;
    xml += `pct_reconstruidos="${reconInfo.pctReconstruidos.toFixed(2)}" `;
    xml += `confianca_media="${reconInfo.confiancaMedia.toFixed(3)}" `;
    xml += `gaps_detectados="${reconInfo.gaps.length}">\n`;
    xml += `    <descricao>Pontos marcados como origem="reconstruido" foram estimados pelo AgenteReconstrutor `;
    xml += `(ensemble Hampel + SPLC + Kalman 1D + Spline PCHIP + Stacking + Conformal). `;
    xml += `Pontos "real" são leituras diretas do sensor.</descricao>\n`;
    for (const g of reconInfo.gaps) {
      xml += `    <gap inicio="${esc(g.inicio_ts)}" fim="${esc(g.fim_ts)}" `;
      xml += `duracao_s="${g.duracao_s}" n_pontos="${g.n_reconstruidos}" `;
      xml += `confianca="${(g.confianca || 0).toFixed(3)}" `;
      xml += `estrategias="${esc((g.estrategias || []).join(","))}"/>\n`;
    }
    xml += `  </reconstrucao>\n`;

    xml += `  <series>\n`;
    for (const ds of series) {
      xml += `    <serie label="${esc(ds.label || "valor")}" cor="${esc(ds.borderColor || "")}"/>\n`;
    }
    xml += `  </series>\n`;
    xml += `  <pontos count="${n}">\n`;
    for (let i = 0; i < n; i++) {
      const origem = reconInfo.origemPorIndice[i] || "real";
      const conf   = reconInfo.confiancaPorIndice[i];
      xml += `    <ponto t="${esc(ctx.labels[i])}" origem="${origem}"`;
      if (conf != null) xml += ` confianca="${conf.toFixed(3)}"`;
      xml += `>`;
      for (const ds of series) {
        const v = ds.data?.[i];
        if (v != null) xml += `<v s="${esc(ds.label || "valor")}">${esc(v)}</v>`;
      }
      xml += `</ponto>\n`;
    }
    xml += `  </pontos>\n`;
    if (ctx.vereditos?.length) {
      xml += `  <analise total="${ctx.vereditos.length}">\n`;
      for (const v of ctx.vereditos) {
        xml += `    <veredito status="${esc(v.status)}" categoria="${esc(v.categoria)}">\n`;
        xml += `      <regra>${esc(v.label || v.id || "")}</regra>\n`;
        xml += `      <resumo>${esc(v.resumo || "")}</resumo>\n`;
        if (v.diagnostico) xml += `      <diagnostico>${esc(v.diagnostico)}</diagnostico>\n`;
        if (v.fonte)       xml += `      <fonte>${esc(v.fonte)}</fonte>\n`;
        xml += `    </veredito>\n`;
      }
      xml += `  </analise>\n`;
    }
    xml += `</relatorio>\n`;

    const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
    ExportadorRelatorio._baixar(blob, ExportadorRelatorio._nomeArquivo(ctx, "xml"));
  }

  static paraPDF(ctx) {
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) {
      alert("Habilite pop-ups pra gerar o PDF.");
      return;
    }
    w.document.open();
    w.document.write(ExportadorRelatorio._htmlImpressao(ctx));
    w.document.close();
    // Espera o layout estabilizar antes do diálogo de impressão.
    w.onload = () => setTimeout(() => { w.focus(); w.print(); }, 250);
  }

  // ===================================================================
  //  HTML pra impressão (PDF via print dialog do browser)
  // ===================================================================

  static _htmlImpressao(ctx) {
    const series = (ctx.datasets || []).filter(d => !d._refLine);
    const n = ctx.labels?.length || 0;
    const reconInfo = ExportadorRelatorio._extrairReconstrucao(ctx);

    // Estatísticas por série (min/max/média) — só pra séries numéricas.
    const stats = series.map(ds => {
      const nums = (ds.data || []).filter(v => typeof v === "number" && Number.isFinite(v));
      if (!nums.length) return { label: ds.label, min: "—", max: "—", media: "—", n: 0 };
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      const media = nums.reduce((a, b) => a + b, 0) / nums.length;
      return {
        label: ds.label || "valor",
        cor: ds.borderColor || "#374151",
        min: ExportadorRelatorio._fmtNum(min),
        max: ExportadorRelatorio._fmtNum(max),
        media: ExportadorRelatorio._fmtNum(media),
        n: nums.length,
      };
    });

    // Vereditos agrupados por status
    const ordemStatus = ["crit", "warn", "info", "ok"];
    const rotuloStatus = { crit: "Crítico", warn: "Atenção", info: "Informativo", ok: "Conforme" };
    const corStatus    = { crit: "#dc2626", warn: "#d97706", info: "#0a93c4", ok: "#059669" };
    const vs = (ctx.vereditos || []).slice().sort((a, b) =>
      ordemStatus.indexOf(a.status) - ordemStatus.indexOf(b.status)
    );

    // Limita tabela de pontos em produção (PDF grande trava o browser).
    const LIMITE_LINHAS = 500;
    const limitado = n > LIMITE_LINHAS;

    const esc = ExportadorRelatorio._htmlEsc;
    const fmtTs = (ts) => {
      try {
        const d = new Date(ts);
        return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
      } catch { return String(ts); }
    };
    const fmtDur = (s) => {
      if (s < 60) return `${Math.round(s)}s`;
      if (s < 3600) return `${(s/60).toFixed(1)} min`;
      return `${(s/3600).toFixed(1)} h`;
    };
    const rotuloEstrategia = {
      ensemble:      "Ensemble (Hampel+SPLC+Kalman+Spline)",
      splc_semanal:  "SPLC semanal (mesmo dia/hora ×4 semanas)",
      splc_diario:   "SPLC diário (mesma hora 24h atrás)",
      splc_mensal:   "SPLC mensal (30 dias atrás)",
      media:         "Hold da média anterior",
      hold_last:     "Manter último valor",
      step:          "Step (sinal binário)",
    };

    return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Relatório · ${esc(ctx.sensor?.rotulo || ctx.sensor?.id || "Sensor")}</title>
<style>
  * { box-sizing: border-box; }
  :root {
    --azul-noite: #0b1d3a;
    --azul-profundo: #123b7a;
    --azul-medio: #1e6fd6;
    --ciano: #00b8f0;
    --roxo: #7c3aed;
    --roxo-claro: #f5f3ff;
    --texto: #1f2937;
    --texto-suave: #6b7280;
    --borda: #e5e7eb;
    --branco: #ffffff;
    --ok: #059669;
    --warn: #d97706;
    --crit: #dc2626;
    --info: #0a93c4;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
    color: var(--texto); margin: 32px; line-height: 1.45;
    background: #fff;
  }
  /* ====== HEADER COM GRADIENTE ====== */
  header.rel-head {
    display: flex; justify-content: space-between; align-items: center;
    background: linear-gradient(135deg, var(--azul-noite) 0%, var(--azul-profundo) 60%, var(--azul-medio) 100%);
    color: #fff;
    padding: 24px 28px;
    border-radius: 14px;
    margin-bottom: 28px;
    box-shadow: 0 8px 24px rgba(11,29,58,.12);
  }
  .marca { font-weight: 800; font-size: 26px; letter-spacing: -.02em; }
  .marca small { display:block; font-size: 11px; font-weight: 500; opacity: .82; letter-spacing: .08em; text-transform: uppercase; margin-top: 2px; }
  .meta { text-align: right; font-size: 12px; opacity: .92; }
  .meta strong { display: block; font-size: 13px; opacity: 1; margin-bottom: 2px; }

  h1 {
    font-size: 26px; margin: 0 0 4px; color: var(--azul-noite);
    letter-spacing: -.02em; font-weight: 800;
  }
  .h1-sub { color: var(--texto-suave); font-size: 14px; margin: 0 0 24px; }

  h2 {
    font-size: 13px; margin: 32px 0 14px; color: var(--azul-noite);
    letter-spacing: .08em; text-transform: uppercase; font-weight: 700;
    padding-bottom: 8px;
    border-bottom: 2px solid var(--borda);
    position: relative;
  }
  h2::after {
    content: "";
    position: absolute; left: 0; bottom: -2px;
    width: 48px; height: 2px;
    background: linear-gradient(90deg, var(--azul-medio), var(--ciano));
  }

  /* ====== STAT CARDS ====== */
  .stat-grade {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px;
    margin-bottom: 8px;
  }
  .stat-card {
    background: #fff;
    border: 1px solid var(--borda);
    border-radius: 12px;
    padding: 16px 18px;
    position: relative;
    overflow: hidden;
  }
  .stat-card::before {
    content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
    background: linear-gradient(180deg, var(--azul-medio), var(--ciano));
  }
  .stat-card .k { font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em; color: var(--texto-suave); font-weight: 700; }
  .stat-card .v { font-size: 22px; font-weight: 800; color: var(--azul-noite); margin-top: 4px; line-height: 1; letter-spacing: -.02em; }
  .stat-card .s { font-size: 11px; color: var(--texto-suave); margin-top: 4px; }

  /* ====== BANNER DE RECONSTRUÇÃO ====== */
  .recon-banner {
    margin: 18px 0 8px;
    background: linear-gradient(135deg, #f5f3ff 0%, #faf5ff 60%, #fdf4ff 100%);
    border: 1px solid #ddd6fe;
    border-left: 5px solid var(--roxo);
    border-radius: 12px;
    padding: 18px 22px;
    display: grid;
    grid-template-columns: 80px 1fr auto;
    gap: 18px;
    align-items: center;
  }
  .recon-donut {
    width: 80px; height: 80px;
    background:
      conic-gradient(var(--roxo) calc(var(--pct) * 1%), #ddd6fe 0);
    border-radius: 50%;
    display: grid; place-items: center;
    position: relative;
  }
  .recon-donut::after {
    content: ""; position: absolute; inset: 8px;
    background: #fff; border-radius: 50%;
  }
  .recon-donut .pct-num {
    position: relative; z-index: 1;
    font-size: 16px; font-weight: 800; color: var(--roxo);
    letter-spacing: -.02em;
  }
  .recon-info h3 { margin: 0 0 4px; font-size: 15px; color: var(--azul-noite); font-weight: 700; }
  .recon-info p { margin: 0; font-size: 12.5px; color: var(--texto); line-height: 1.5; }
  .recon-info strong { color: var(--roxo); }
  .recon-stats { text-align: right; font-size: 11px; color: var(--texto-suave); line-height: 1.6; }
  .recon-stats b { color: var(--azul-noite); font-size: 13px; font-weight: 700; display: block; }

  /* ====== TABELA DE GAPS ====== */
  .gap-list { display: flex; flex-direction: column; gap: 8px; }
  .gap-card {
    border: 1px solid #ddd6fe;
    border-left: 4px solid var(--roxo);
    border-radius: 8px;
    padding: 10px 14px;
    background: #faf5ff;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 14px;
    align-items: center;
    font-size: 12px;
  }
  .gap-card .gap-when { font-weight: 700; color: var(--azul-noite); }
  .gap-card .gap-strategy { color: var(--texto-suave); font-size: 11.5px; }
  .gap-card .gap-conf {
    background: var(--roxo); color: #fff;
    padding: 4px 10px; border-radius: 999px;
    font-size: 11px; font-weight: 700; letter-spacing: .03em;
    white-space: nowrap;
  }

  /* ====== TABELA GERAL ====== */
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; border-radius: 8px; overflow: hidden; box-shadow: 0 0 0 1px var(--borda); }
  thead th {
    background: var(--azul-noite); color: #fff; text-align: left;
    padding: 10px 12px; font-weight: 700; font-size: 10.5px;
    text-transform: uppercase; letter-spacing: .06em;
  }
  tbody td { padding: 7px 12px; border-bottom: 1px solid var(--borda); }
  tbody tr:nth-child(even) { background: #fafbfc; }
  tbody tr.rec-row { background: #faf5ff !important; }
  tbody tr.rec-row td:first-child { border-left: 3px solid var(--roxo); }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }

  .rec-badge {
    display: inline-block;
    background: var(--roxo); color: #fff;
    padding: 1px 6px; border-radius: 4px;
    font-size: 9.5px; font-weight: 700;
    letter-spacing: .05em; text-transform: uppercase;
    margin-left: 6px; vertical-align: middle;
  }

  /* ====== VEREDITOS ====== */
  .ver-list { display: flex; flex-direction: column; gap: 10px; }
  .ver-card {
    border-left: 4px solid #374151;
    padding: 12px 14px;
    background: #f9fafb;
    border-radius: 8px;
  }
  .ver-card.crit { border-color: var(--crit); background: #fef2f2; }
  .ver-card.warn { border-color: var(--warn); background: #fffbeb; }
  .ver-card.info { border-color: var(--info); background: #f0f9ff; }
  .ver-card.ok   { border-color: var(--ok);   background: #f0fdf4; }
  .ver-tag {
    display: inline-block; padding: 2px 9px; border-radius: 999px;
    font-size: 10px; font-weight: 800; text-transform: uppercase;
    letter-spacing: .06em; color: #fff; margin-right: 6px;
  }
  .ver-cat { font-size: 10.5px; color: var(--texto-suave); letter-spacing: .06em; text-transform: uppercase; font-weight: 700; }
  .ver-tit { font-size: 14px; font-weight: 700; color: var(--azul-noite); margin: 4px 0; }
  .ver-txt { font-size: 12px; color: var(--texto); }
  .ver-meta { font-size: 10.5px; color: var(--texto-suave); margin-top: 4px; }

  .swatch { display: inline-block; width: 11px; height: 11px; border-radius: 3px; vertical-align: middle; margin-right: 7px; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--borda); font-size: 10.5px; color: var(--texto-suave); text-align: center; }
  .footer strong { color: var(--azul-noite); }
  .aviso { font-size: 11.5px; color: var(--texto-suave); font-style: italic; margin: 10px 0; padding: 10px 14px; background: #f9fafb; border-radius: 6px; border-left: 3px solid var(--borda); }
  .aviso-recon { background: var(--roxo-claro); border-left-color: var(--roxo); color: var(--azul-noite); }
  .aviso-recon strong { color: var(--roxo); }

  @media print {
    body { margin: 14mm; }
    header.rel-head { box-shadow: none; }
    .no-print { display: none; }
    h2 { page-break-after: avoid; }
    tr, .ver-card, .gap-card, .stat-card { page-break-inside: avoid; }
  }
</style></head><body>

<header class="rel-head">
  <div>
    <div class="marca">DataCold<small>Plataforma de telemetria industrial</small></div>
  </div>
  <div class="meta">
    <strong>Relatório técnico</strong>
    Gerado em ${esc(new Date().toLocaleString("pt-BR"))}<br>
    Gráfico: ${esc(ctx.chave || "—")}
  </div>
</header>

<h1>${esc(ctx.titulo)}</h1>
<p class="h1-sub">${esc(ctx.sensor?.rotulo || ctx.sensor?.id || "")} · ${esc(ctx.sensor?.grupo || "")}</p>

<div class="stat-grade">
  <div class="stat-card"><div class="k">Sensor</div><div class="v">${esc(ctx.sensor?.id || "—")}</div><div class="s">${esc(ctx.sensor?.tipo || "")}</div></div>
  <div class="stat-card"><div class="k">Período</div><div class="v">${esc(ExportadorRelatorio._fmtPeriodo(ctx.janela))}</div><div class="s">janela ${esc(ctx.janela || "")}</div></div>
  <div class="stat-card"><div class="k">Pontos coletados</div><div class="v">${n}</div><div class="s">${reconInfo.totalReconstruidos} reconstruídos</div></div>
  <div class="stat-card"><div class="k">Achados</div><div class="v">${vs.length}</div><div class="s">${vs.filter(v=>v.status==="crit").length} críticos · ${vs.filter(v=>v.status==="warn").length} alertas</div></div>
</div>

${reconInfo.totalReconstruidos > 0 ? `
<div class="recon-banner" style="--pct: ${reconInfo.pctReconstruidos.toFixed(1)};">
  <div class="recon-donut"><div class="pct-num">${reconInfo.pctReconstruidos.toFixed(0)}%</div></div>
  <div class="recon-info">
    <h3>Este relatório contém dados reconstruídos pelo Agente</h3>
    <p>
      <strong>${reconInfo.totalReconstruidos} de ${reconInfo.totalPontos} pontos</strong> foram estimados pelo
      <strong>AgenteReconstrutor</strong> (ensemble Hampel + SPLC + Kalman 1D + Spline PCHIP + Stacking + Conformal Prediction).
      Esses pontos preenchem falhas momentâneas de leitura — geralmente quedas de internet ou indisponibilidade do gateway —
      usando o padrão histórico do mesmo dia/horário em semanas anteriores.
    </p>
  </div>
  <div class="recon-stats">
    <b>${(reconInfo.confiancaMedia * 100).toFixed(0)}%</b>confiabilidade média<br>
    <b>${reconInfo.gaps.length}</b>${reconInfo.gaps.length === 1 ? "gap detectado" : "gaps detectados"}
  </div>
</div>
` : ""}

<h2>Resumo estatístico</h2>
<table>
  <thead><tr><th>Série</th><th class="num">Mínimo</th><th class="num">Máximo</th><th class="num">Média</th><th class="num">Amostras</th></tr></thead>
  <tbody>
    ${stats.map(s => `
      <tr>
        <td><span class="swatch" style="background:${esc(s.cor || "#374151")}"></span>${esc(s.label)}</td>
        <td class="num">${esc(s.min)}</td>
        <td class="num">${esc(s.max)}</td>
        <td class="num">${esc(s.media)}</td>
        <td class="num">${s.n}</td>
      </tr>`).join("")}
  </tbody>
</table>

${reconInfo.gaps.length ? `
<h2>Detalhe dos gaps reconstruídos</h2>
<div class="gap-list">
  ${reconInfo.gaps.map(g => {
    const estr = (g.estrategias || []).map(e => rotuloEstrategia[e] || e).join(" + ");
    return `
      <div class="gap-card">
        <div>
          <div class="gap-when">${esc(fmtTs(g.inicio_ts))} → ${esc(fmtTs(g.fim_ts))}</div>
          <div class="gap-strategy">${esc(estr || "—")} · ${g.n_reconstruidos} ponto(s) estimado(s)</div>
        </div>
        <div style="text-align:right; color: var(--texto-suave); font-size: 11.5px;">
          Duração: <b style="color:var(--azul-noite);">${esc(fmtDur(g.duracao_s))}</b>
        </div>
        <div class="gap-conf">${((g.confianca || 0) * 100).toFixed(0)}% confiança</div>
      </div>`;
  }).join("")}
</div>
` : ""}

<h2>Análise dos agentes (${vs.length})</h2>
${vs.length ? `
  <div class="ver-list">
    ${vs.map(v => `
      <div class="ver-card ${esc(v.status)}">
        <span class="ver-tag" style="background:${esc(corStatus[v.status] || "#374151")}">${esc(rotuloStatus[v.status] || v.status)}</span>
        <span class="ver-cat">${esc(v.categoria || "")}</span>
        <div class="ver-tit">${esc(v.label || v.id || "Veredito")}</div>
        ${v.resumo      ? `<div class="ver-txt">${esc(v.resumo)}</div>` : ""}
        ${v.diagnostico ? `<div class="ver-txt" style="margin-top:4px;">${esc(v.diagnostico)}</div>` : ""}
        ${v.fonte       ? `<div class="ver-meta">Fonte: ${esc(v.fonte)}</div>` : ""}
      </div>`).join("")}
  </div>
` : `<div class="aviso">Nenhum achado relevante nesta janela — sistema dentro dos parâmetros esperados.</div>`}

<h2>Série temporal${limitado ? ` (primeiros ${LIMITE_LINHAS} de ${n} pontos)` : ""}</h2>
${reconInfo.totalReconstruidos > 0 ? `
<div class="aviso aviso-recon">
  Linhas com <strong>fundo lavanda</strong> e badge <span class="rec-badge">REC</span> indicam pontos
  <strong>reconstruídos pelo agente</strong> (não foram leituras diretas do sensor). A coluna "%" mostra a confiabilidade desse ponto.
</div>` : ""}
<table>
  <thead>
    <tr>
      <th>Timestamp</th>
      <th class="num" style="width:54px;">Conf.</th>
      ${series.map(d => `<th class="num">${esc(d.label || "valor")}</th>`).join("")}
    </tr>
  </thead>
  <tbody>
    ${Array.from({ length: Math.min(LIMITE_LINHAS, n) }, (_, i) => {
      const isRec = reconInfo.origemPorIndice[i] === "reconstruido";
      const conf  = reconInfo.confiancaPorIndice[i];
      return `<tr class="${isRec ? "rec-row" : ""}">
        <td>${esc(ctx.labels[i])}${isRec ? `<span class="rec-badge">REC</span>` : ""}</td>
        <td class="num">${conf != null ? `${(conf * 100).toFixed(0)}%` : "—"}</td>
        ${series.map(ds => {
          const v = ds.data?.[i];
          return `<td class="num">${v == null ? "—" : esc(typeof v === "number" ? ExportadorRelatorio._fmtNum(v) : v)}</td>`;
        }).join("")}
      </tr>`;
    }).join("")}
  </tbody>
</table>
${limitado ? `<div class="aviso">Tabela truncada nos primeiros ${LIMITE_LINHAS} pontos pra manter o PDF leve. Para acessar todos os ${n} pontos, exporte em CSV ou XML — eles têm as mesmas marcações de origem/confiança.</div>` : ""}

<div class="footer">
  <strong>Relatório gerado pela plataforma DataCold</strong> · MVP construído em hackathon · ${new Date().getFullYear()}<br>
  ${reconInfo.totalReconstruidos > 0
    ? `Inclui ${reconInfo.totalReconstruidos} ponto(s) reconstruído(s) pelo AgenteReconstrutor (confiabilidade média ${(reconInfo.confiancaMedia * 100).toFixed(0)}%). Use a coluna "Conf." pra interpretar a qualidade de cada estimativa.`
    : `Todos os ${n} pontos foram lidos diretamente do sensor — sem reconstrução por IA nesta janela.`}
</div>

</body></html>`;
  }

  // ===================================================================
  //  Helpers
  // ===================================================================

  /**
   * Cruza os pontos reconstruídos (do AgenteReconstrutor) com os labels
   * do gráfico, devolvendo `origemPorIndice[i]` (real|reconstruido) e
   * `confiancaPorIndice[i]` por índice da série. Faz match por timestamp
   * com tolerância — labels são strings formatadas, points têm ISO time.
   */
  static _extrairReconstrucao(ctx) {
    const pontosRecon = ctx.recon?.pontos || [];
    const gaps        = ctx.recon?.gaps   || [];
    const totalPontos = (ctx.labels || []).length;
    const origemPorIndice = new Array(totalPontos).fill("real");
    const confiancaPorIndice = new Array(totalPontos).fill(null);

    // O array de pontos efetivamente renderizado (real + reconstruídos
    // intercalados) está em ctx.recon.pontos — mesma ordem dos labels do gráfico.
    // ctx.pontos é o array BRUTO da API, sem os reconstruídos.
    for (let i = 0; i < totalPontos; i++) {
      const p = pontosRecon[i];
      if (p && p._reconstruido) {
        origemPorIndice[i] = "reconstruido";
        confiancaPorIndice[i] = p._meta?.confianca ?? null;
      }
    }

    const totalReconstruidos = origemPorIndice.filter(o => o === "reconstruido").length;
    const pctReconstruidos = totalPontos > 0 ? (totalReconstruidos / totalPontos) * 100 : 0;
    const confs = confiancaPorIndice.filter(c => Number.isFinite(c));
    const confiancaMedia = confs.length ? confs.reduce((s, x) => s + x, 0) / confs.length : 0;

    return {
      origemPorIndice,
      confiancaPorIndice,
      totalPontos,
      totalReconstruidos,
      pctReconstruidos,
      confiancaMedia,
      gaps,
    };
  }

  static _fmtSensor(s) {
    if (!s) return "Sensor desconhecido";
    return `${s.rotulo || s.id} (${s.id})`;
  }

  static _fmtPeriodo(j) {
    if (!j) return "—";
    const m = String(j).match(/^-(\d+(?:\.\d+)?)([smhd])$/);
    if (!m) return j;
    const n = Number(m[1]);
    const u = m[2];
    if (u === "s") return `Últimos ${n} segundos`;
    if (u === "m") return `Últimos ${n} minutos`;
    if (u === "h") return n < 24 ? `Últimas ${n} horas` : `Últimos ${(n/24).toFixed(0)} dias`;
    if (u === "d") return `Últimos ${n} dias`;
    return j;
  }

  static _fmtNum(v) {
    if (!Number.isFinite(v)) return String(v);
    const abs = Math.abs(v);
    if (abs >= 1000) return v.toFixed(0);
    if (abs >= 10)   return v.toFixed(1);
    if (abs >= 1)    return v.toFixed(2);
    return v.toFixed(3);
  }

  static _nomeArquivo(ctx, ext) {
    const slug = (ctx.chave || "grafico").replace(/[^a-z0-9_-]+/gi, "_").toLowerCase();
    const sid  = (ctx.sensor?.id || "sensor").replace(/[^a-z0-9_-]+/gi, "_").toLowerCase();
    const j    = (ctx.janela || "").replace(/[^a-z0-9-]+/gi, "");
    const ts   = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    return `datacold_${sid}_${slug}_${j}_${ts}.${ext}`;
  }

  static _baixar(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
  }

  static _csvEsc(v) {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  static _xmlEsc(v) {
    if (v == null) return "";
    return String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  static _htmlEsc(v) {
    if (v == null) return "";
    return String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}

if (typeof window !== "undefined") window.ExportadorRelatorio = ExportadorRelatorio;
