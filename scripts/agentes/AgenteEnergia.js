/**
 * Agente para sensores de ENERGIA (medidor trifásico).
 *
 * Métricas pré-calculadas no contexto:
 *   fp_composto     média das magnitudes dos FPs das 3 fases (0..1)
 *   fp_negativo     true se alguma fase tem FP < 0 (fluxo reverso)
 *   correntes[]     [Ia, Ib, Ic] do último ponto
 *   tensoes[]       [Va, Vb, Vc] do último ponto
 *   cub_pct         % desequilíbrio de corrente (NEMA)
 *   vub_pct         % desequilíbrio de tensão (NEMA)
 *   fases_ausentes  ['a','b','c'] que estão com V ≈ 0
 *   pico_corrente   maior pico observado / média = X vezes
 *   potencia_kw     potência ativa total atual (kW)
 *   consumo_dia     kWh estimado em horário comercial vs madrugada
 */
class AgenteEnergia extends AgenteBase {

  contexto(pontos) {
    const ctx = super.contexto(pontos);
    const ult = ctx.ultimo;
    if (!ult) return ctx;

    // Magnitudes FP
    const fpa = ult.fator_potencia_a || 0, fpb = ult.fator_potencia_b || 0, fpc = ult.fator_potencia_c || 0;
    ctx.fp_composto  = (Math.abs(fpa) + Math.abs(fpb) + Math.abs(fpc)) / 3;
    ctx.fp_negativo  = fpa < 0 || fpb < 0 || fpc < 0;
    ctx.fps          = [fpa, fpb, fpc];

    // Correntes e tensões do último ponto
    ctx.correntes = [ult.corrente_fase_a || 0, ult.corrente_fase_b || 0, ult.corrente_fase_c || 0];
    ctx.tensoes   = [ult.tensao_fase_a   || 0, ult.tensao_fase_b   || 0, ult.tensao_fase_c   || 0];

    // %CUB e %VUB
    ctx.cub_pct = AgenteEnergia._desequilibrio(ctx.correntes);
    ctx.vub_pct = AgenteEnergia._desequilibrio(ctx.tensoes);

    // Fases ausentes (tensão próxima de zero)
    ctx.fases_ausentes = [];
    if (ctx.tensoes[0] < 10) ctx.fases_ausentes.push("A");
    if (ctx.tensoes[1] < 10) ctx.fases_ausentes.push("B");
    if (ctx.tensoes[2] < 10) ctx.fases_ausentes.push("C");

    // Pico máximo da corrente vs média (na janela)
    const todasCorrentes = pontos.flatMap(p => [p.corrente_fase_a, p.corrente_fase_b, p.corrente_fase_c].filter(v => v != null && v > 0));
    if (todasCorrentes.length) {
      const media = todasCorrentes.reduce((s, x) => s + x, 0) / todasCorrentes.length;
      const max   = Math.max(...todasCorrentes);
      ctx.pico_corrente_x = media > 0 ? max / media : 0;
    } else {
      ctx.pico_corrente_x = 0;
    }

    // Potência ativa atual (kW)
    ctx.potencia_kw = (
      (ult.tensao_fase_a || 0) * (ult.corrente_fase_a || 0) * (ult.fator_potencia_a || 0) +
      (ult.tensao_fase_b || 0) * (ult.corrente_fase_b || 0) * (ult.fator_potencia_b || 0) +
      (ult.tensao_fase_c || 0) * (ult.corrente_fase_c || 0) * (ult.fator_potencia_c || 0)
    ) / 1000;

    // Phantom load: consumo madrugada (00h-05h local UTC-3) vs comercial (08h-18h)
    const mad = pontos.filter(p => {
      const h = (new Date(p.time).getUTCHours() - 3 + 24) % 24;
      return h >= 0 && h < 5;
    });
    const com = pontos.filter(p => {
      const h = (new Date(p.time).getUTCHours() - 3 + 24) % 24;
      return h >= 8 && h < 18;
    });
    const corrMed = arr => {
      if (!arr.length) return 0;
      const c = arr.flatMap(p => [p.corrente_fase_a, p.corrente_fase_b, p.corrente_fase_c]).filter(v => v != null);
      return c.length ? c.reduce((s, x) => s + Math.abs(x), 0) / c.length : 0;
    };
    ctx.consumo_madrugada = corrMed(mad);
    ctx.consumo_comercial = corrMed(com);

    return ctx;
  }

  static _desequilibrio(valores) {
    const v = valores.filter(x => x > 0);
    if (v.length < 2) return 0;
    const media = v.reduce((s, x) => s + x, 0) / v.length;
    if (media === 0) return 0;
    const maxDesvio = Math.max(...v.map(x => Math.abs(x - media)));
    return (maxDesvio / media) * 100;
  }
}

// ===================================================================
//  REGRAS
// ===================================================================

AgenteEnergia.REGRAS = [

  new Regra({
    id: "fp-baixo",
    categoria: "FP",
    label: "O fator de potência está acima do limite ANEEL?",
    fonte: NORMAS.ANEEL.fp_minimo.fonte,
    parametros: {
      limite_atencao: NORMAS.ANEEL.fp_minimo.valor,
      limite_critico: NORMAS.ANEEL.fp_critico.valor,
    },
    avaliar(ctx, p) {
      if (ctx.fp_negativo) return { status: "ok", resumo: "Avaliado em outra regra", detalhe: "Fluxo reverso analisado separadamente." };
      const fp = ctx.fp_composto;
      if (fp < p.limite_critico) return {
        status: "crit",
        resumo: `FP = ${fp.toFixed(2)}`,
        detalhe: `Fator de potência composto = ${fp.toFixed(2)}. Limite ANEEL = ${p.limite_atencao}, crítico < ${p.limite_critico}.`,
        diagnostico: "Banco de capacitores queimado, motor sem correção ou carga indutiva sem compensação. Concessionária multa todo mês.",
        valorMedido: fp, valorIdeal: `≥ ${p.limite_atencao}`,
      };
      if (fp < p.limite_atencao) return {
        status: "warn",
        resumo: `FP = ${fp.toFixed(2)}`,
        detalhe: `FP composto = ${fp.toFixed(2)} — abaixo do mínimo ANEEL (${p.limite_atencao}).`,
        diagnostico: "Já está em zona de multa. Corrigir antes do próximo ciclo de faturamento.",
        valorMedido: fp, valorIdeal: `≥ ${p.limite_atencao}`,
      };
      return { status: "ok", resumo: `FP = ${fp.toFixed(2)}`, detalhe: `Dentro do limite ANEEL.`, valorMedido: fp, valorIdeal: `≥ ${p.limite_atencao}` };
    },
  }),

  new Regra({
    id: "fluxo-reverso",
    categoria: "FP",
    label: "Há fluxo reverso (FP negativo)?",
    fonte: NORMAS.ANEEL.fp_minimo.fonte,
    avaliar(ctx) {
      if (!ctx.fp_negativo) return { status: "ok", resumo: "Sem fluxo reverso", detalhe: "Todos os FPs positivos." };
      return {
        status: "crit",
        resumo: "Fluxo reverso detectado",
        detalhe: `FPs: ${ctx.fps.map(x => x.toFixed(2)).join(" / ")}. Pelo menos uma fase com FP < 0.`,
        diagnostico: "Fiação dos transformadores de corrente provavelmente invertida, ou medidor instalado ao contrário. Sem geração própria, NÃO é fluxo real — é erro de leitura. Inverter os TCs.",
      };
    },
  }),

  new Regra({
    id: "desequilibrio-corrente",
    categoria: "Equilíbrio",
    label: "As fases estão balanceadas em corrente?",
    fonte: NORMAS.NEMA.cub_critico_pct.fonte,
    parametros: {
      atencao_pct: NORMAS.NEMA.cub_atencao_pct.valor,
      critico_pct: NORMAS.NEMA.cub_critico_pct.valor,
    },
    avaliar(ctx, p) {
      const cub = ctx.cub_pct;
      const fmt = `%CUB = ${cub.toFixed(1)}% · ${ctx.correntes.map(c => c.toFixed(0)).join("/")}A`;
      if (cub >= p.critico_pct) return {
        status: "crit", resumo: `%CUB ${cub.toFixed(1)}%`, detalhe: `${fmt}. NEMA crítico (>${p.critico_pct}%).`,
        diagnostico: "Curto entre espiras, conexão frouxa, barra rotórica quebrada ou cargas mal distribuídas. Cruzar com VUB pra distinguir motor vs rede.",
        valorMedido: cub, valorIdeal: `< ${p.atencao_pct}%`,
      };
      if (cub >= p.atencao_pct) return {
        status: "warn", resumo: `%CUB ${cub.toFixed(1)}%`, detalhe: `${fmt}. NEMA atenção (${p.atencao_pct}-${p.critico_pct}%).`,
        diagnostico: "Inspecionar conexões dos terminais e distribuição de cargas monofásicas antes de virar crítico.",
        valorMedido: cub, valorIdeal: `< ${p.atencao_pct}%`,
      };
      return { status: "ok", resumo: `%CUB ${cub.toFixed(1)}%`, detalhe: `${fmt}. Dentro do ideal NEMA.`, valorMedido: cub, valorIdeal: `< ${p.atencao_pct}%` };
    },
  }),

  new Regra({
    id: "desequilibrio-tensao",
    categoria: "Equilíbrio",
    label: "As fases estão balanceadas em tensão?",
    fonte: NORMAS.NEMA.vub_max_pct.fonte,
    parametros: {
      ideal_pct: NORMAS.NEMA.vub_ideal_pct.valor,
      max_pct:   NORMAS.NEMA.vub_max_pct.valor,
    },
    avaliar(ctx, p) {
      const vub = ctx.vub_pct;
      const fmt = `%VUB = ${vub.toFixed(2)}% · ${ctx.tensoes.map(v => v.toFixed(0)).join("/")}V`;
      if (vub > p.max_pct) return {
        status: "warn", resumo: `%VUB ${vub.toFixed(2)}%`, detalhe: `${fmt}. Acima do máx NEMA (${p.max_pct}%).`,
        diagnostico: "Cargas monofásicas mal distribuídas, conexão frouxa no QGBT ou transformador com problema. Acima de 2% reduz vida do motor (Arrhenius).",
        valorMedido: vub, valorIdeal: `< ${p.ideal_pct}%`,
      };
      if (vub > p.ideal_pct) return { status: "info", resumo: `%VUB ${vub.toFixed(2)}%`, detalhe: `${fmt}. Acima do ideal mas ainda tolerável.`, valorMedido: vub, valorIdeal: `< ${p.ideal_pct}%` };
      return { status: "ok", resumo: `%VUB ${vub.toFixed(2)}%`, detalhe: `${fmt}. Equilíbrio bom.`, valorMedido: vub, valorIdeal: `< ${p.ideal_pct}%` };
    },
  }),

  new Regra({
    id: "fase-ausente",
    categoria: "Fase",
    label: "Alguma fase está sem tensão?",
    fonte: "Convenção elétrica",
    parametros: { limite_v: 10 },
    avaliar(ctx, p) {
      if (!ctx.fases_ausentes.length) return { status: "ok", resumo: "Todas as fases OK", detalhe: "Tensão presente nas 3 fases." };
      return {
        status: "crit",
        resumo: `Fase ${ctx.fases_ausentes.join(", ")} ausente`,
        detalhe: `Tensão < ${p.limite_v}V em ${ctx.fases_ausentes.length} fase(s). Equipamento operando incompleto.`,
        diagnostico: "Fusível queimado, disjuntor desarmado, condutor rompido ou defeito no canal do medidor. Risco de queima do motor.",
      };
    },
  }),

  new Regra({
    id: "pico-corrente",
    categoria: "Picos",
    label: "Há picos de corrente acima do esperado?",
    fonte: NORMAS.NEMA.partida_max_x.fonte,
    parametros: {
      partida_min_x: NORMAS.NEMA.partida_min_x.valor,
      partida_max_x: NORMAS.NEMA.partida_max_x.valor,
    },
    avaliar(ctx, p) {
      const x = ctx.pico_corrente_x;
      if (x >= p.partida_max_x + 2) return {
        status: "warn", resumo: `Pico ${x.toFixed(1)}× a média`, detalhe: `Pico ${x.toFixed(1)}× a média — acima do esperado (5-7×).`,
        diagnostico: "Rolamento desgastado, contator com arco, ou partidas em travamento mecânico. Falhas catastróficas começam assim.",
        valorMedido: x, valorIdeal: `${p.partida_min_x}–${p.partida_max_x}×`,
      };
      if (x >= p.partida_min_x) return { status: "info", resumo: `Pico ${x.toFixed(1)}× a média`, detalhe: "Pico dentro da faixa de partida normal (5-7×).", valorMedido: x, valorIdeal: `${p.partida_min_x}–${p.partida_max_x}×` };
      return { status: "ok", resumo: `Pico ${x.toFixed(1)}× a média`, detalhe: "Sem picos significativos.", valorMedido: x };
    },
  }),

  new Regra({
    id: "corrente-fora-nominal",
    categoria: "Carga",
    label: "A corrente está dentro da faixa nominal do equipamento?",
    fonte: "Folha de dados do equipamento (corrente_nominal_a no perfil)",
    avaliar(ctx) {
      const nominal = Number(ctx.sensor?.parametros?.corrente_nominal_a) || 0;
      if (!nominal) {
        return { status: "info", resumo: "Sem corrente nominal cadastrada", detalhe: "Defina `corrente_nominal_a` no perfil pra ativar esta regra." };
      }
      const Im = (ctx.correntes[0] + ctx.correntes[1] + ctx.correntes[2]) / 3;
      const pct = (Im / nominal) * 100;
      if (Im < nominal * 0.20) return {
        status: "crit",
        resumo: `Corrente = ${Im.toFixed(0)} A (${pct.toFixed(0)}% do nominal)`,
        detalhe: `Corrente média de ${Im.toFixed(1)} A é apenas ${pct.toFixed(0)}% da nominal (${nominal} A). Equipamento pode estar caindo ou desligado.`,
        diagnostico: "Queda anormal de carga: contator desarmou, motor parou, fase ausente intermitente ou medidor com defeito.",
        valorMedido: `${Im.toFixed(1)} A`, valorIdeal: `${(nominal*0.7).toFixed(0)}-${(nominal*1.1).toFixed(0)} A`,
      };
      if (Im > nominal * 1.30) return {
        status: "crit",
        resumo: `Corrente = ${Im.toFixed(0)} A (${pct.toFixed(0)}% do nominal)`,
        detalhe: `Corrente média de ${Im.toFixed(1)} A está ${pct.toFixed(0)}% do nominal (${nominal} A). Equipamento sobrecarregado.`,
        diagnostico: "Sobrecarga sustentada: carga acima do projeto, rolamento travando, ou ambiente quente demais. Risco de queima do motor.",
        valorMedido: `${Im.toFixed(1)} A`, valorIdeal: `${(nominal*0.7).toFixed(0)}-${(nominal*1.1).toFixed(0)} A`,
      };
      if (Im < nominal * 0.50 || Im > nominal * 1.15) return {
        status: "warn",
        resumo: `Corrente = ${Im.toFixed(0)} A (${pct.toFixed(0)}% do nominal)`,
        detalhe: `Corrente fora da faixa típica (50-115% do nominal). Atual: ${pct.toFixed(0)}%.`,
        diagnostico: Im < nominal * 0.50
          ? "Subcarga sustentada — verificar processo a montante ou abertura de contator."
          : "Sobrecarga moderada — vigiar temperatura do motor e qualidade da rede.",
        valorMedido: `${Im.toFixed(1)} A`, valorIdeal: `${(nominal*0.7).toFixed(0)}-${(nominal*1.1).toFixed(0)} A`,
      };
      return {
        status: "ok",
        resumo: `Corrente = ${Im.toFixed(0)} A (${pct.toFixed(0)}% do nominal)`,
        detalhe: `Corrente dentro da faixa típica do equipamento (50-115% do nominal).`,
        valorMedido: `${Im.toFixed(1)} A`, valorIdeal: `${(nominal*0.7).toFixed(0)}-${(nominal*1.1).toFixed(0)} A`,
      };
    },
  }),

  new Regra({
    id: "phantom-load",
    categoria: "Phantom load",
    label: "O equipamento consome em horário ocioso?",
    fonte: "Boa prática operacional",
    parametros: { razao_minima_alerta: 0.6 },
    avaliar(ctx, p) {
      if (!ctx.consumo_comercial || !ctx.consumo_madrugada) {
        return { status: "info", resumo: "Sem cobertura 24h", detalhe: "Janela insuficiente pra comparar madrugada vs comercial." };
      }
      const razao = ctx.consumo_madrugada / ctx.consumo_comercial;
      if (razao > p.razao_minima_alerta) return {
        status: "warn",
        resumo: `Madrugada ${(razao * 100).toFixed(0)}% do dia`,
        detalhe: `Corrente média de madrugada (${ctx.consumo_madrugada.toFixed(1)}A) está em ${(razao * 100).toFixed(0)}% da comercial (${ctx.consumo_comercial.toFixed(1)}A).`,
        diagnostico: "Phantom load — equipamento ligado fora do expediente. Verificar se é necessário ou desligar.",
        valorMedido: razao, valorIdeal: `< ${p.razao_minima_alerta}`,
      };
      return { status: "ok", resumo: `Madrugada ${(razao * 100).toFixed(0)}% do dia`, detalhe: "Consumo noturno coerente com operação.", valorMedido: razao };
    },
  }),

  new Regra({
    id: "tensao-fora-faixa",
    categoria: "Tensão",
    label: "A tensão está dentro da tolerância (±5% nominal)?",
    fonte: NORMAS.ANEEL.tensao_tolerancia_pct.fonte,
    parametros: { tolerancia_pct: NORMAS.ANEEL.tensao_tolerancia_pct.valor },
    avaliar(ctx, p) {
      // Tensões nominais comuns no Brasil: 127 ou 220 V por fase
      const ativas = ctx.tensoes.filter(v => v > 10);
      if (!ativas.length) return { status: "info", resumo: "Sem tensão nas fases", detalhe: "Avaliado pela regra de fase ausente." };
      const media = ativas.reduce((s, x) => s + x, 0) / ativas.length;
      const nominal = media > 180 ? 220 : 127;
      const tolMin = nominal * (1 - p.tolerancia_pct / 100);
      const tolMax = nominal * (1 + p.tolerancia_pct / 100);
      const fora = ativas.filter(v => v < tolMin || v > tolMax).length;
      if (fora > 0) return {
        status: "warn",
        resumo: `${fora} fase(s) fora ±${p.tolerancia_pct}% de ${nominal}V`,
        detalhe: `Tensões: ${ativas.map(v => v.toFixed(0)).join("/")}V · esperado ${tolMin.toFixed(0)}–${tolMax.toFixed(0)}V.`,
        diagnostico: "Subtensão pode causar travamento de motor; sobretensão queima isolação. Investigar QGBT e transformador.",
        valorMedido: media, valorIdeal: `${nominal}V ±${p.tolerancia_pct}%`,
      };
      return { status: "ok", resumo: `~${media.toFixed(0)}V (${nominal}V nominal)`, detalhe: "Tensão dentro da tolerância PRODIST." };
    },
  }),

  new Regra({
    id: "potencia-atual",
    categoria: "Potência",
    label: "Qual a potência ativa total agora?",
    fonte: "Cálculo P = V × I × FP",
    avaliar(ctx) {
      const p = ctx.potencia_kw;
      return { status: "info", resumo: `${p.toFixed(1)} kW`, detalhe: `Potência ativa total atual = ${p.toFixed(2)} kW (soma das 3 fases).`, valorMedido: p };
    },
  }),

];

if (typeof window !== "undefined") window.AgenteEnergia = AgenteEnergia;
