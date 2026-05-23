/**
 * Agente para sensores de TEMPERATURA.
 *
 * Métricas pré-calculadas no contexto:
 *   valores[]            série de temperaturas (apenas valores)
 *   atual                último valor
 *   media, desvio        estatísticos
 *   min, max, amplitude
 *   tempo_fora_pct       % das leituras fora da faixa ideal
 *   tendencia_c_h        derivada média °C por hora
 *   picos_zscore         contagem de pontos com |z| > limiar
 *   travado              true se desvio < limiar (sensor não varia)
 *   faixa                {min, max, label} baseado em sensor.grupo
 *   impossivel_count     pontos com |t| acima do envelope físico
 */
class AgenteTemperatura extends AgenteBase {

  contexto(pontos) {
    const ctx = super.contexto(pontos);
    const valores = pontos.map(p => p.temperatura).filter(v => v != null && isFinite(v));
    ctx.valores = valores;
    ctx.atual   = valores[valores.length - 1] ?? null;

    const media = valores.length ? valores.reduce((s, x) => s + x, 0) / valores.length : 0;
    ctx.media   = media;
    const variancia = valores.length ? valores.reduce((s, x) => s + (x - media) ** 2, 0) / valores.length : 0;
    ctx.desvio = Math.sqrt(variancia);

    ctx.min = valores.length ? Math.min(...valores) : null;
    ctx.max = valores.length ? Math.max(...valores) : null;
    ctx.amplitude = ctx.max != null ? ctx.max - ctx.min : 0;

    // Faixa ideal do grupo (câmara) ou null se ambiente externo
    ctx.faixa = (NORMAS.ANVISA.faixas[this.sensor?.grupo]) || null;
    if (ctx.faixa) {
      const fora = valores.filter(v => v < ctx.faixa.min || v > ctx.faixa.max).length;
      ctx.tempo_fora_pct = valores.length ? (fora / valores.length) * 100 : 0;
    } else {
      ctx.tempo_fora_pct = 0;
    }

    // Tendência: regressão simples °C / h
    if (pontos.length >= 4) {
      const t0 = new Date(pontos[0].time).getTime();
      const xs = pontos.map(p => (new Date(p.time).getTime() - t0) / 3600000); // horas
      const ys = pontos.map(p => p.temperatura);
      const n = xs.length;
      const mx = xs.reduce((s, x) => s + x, 0) / n;
      const my = ys.reduce((s, x) => s + x, 0) / n;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
      ctx.tendencia_c_h = den !== 0 ? num / den : 0;
    } else {
      ctx.tendencia_c_h = 0;
    }

    // Picos por z-score
    const zLimite = NORMAS.TEMPERATURA.z_score_pico.valor;
    if (ctx.desvio > 0) {
      ctx.picos_zscore = valores.filter(v => Math.abs((v - media) / ctx.desvio) > zLimite).length;
    } else {
      ctx.picos_zscore = 0;
    }

    // Travado
    ctx.travado = ctx.desvio < NORMAS.TEMPERATURA.sensor_travado_sigma.valor;

    // Leituras fora do envelope físico
    ctx.impossivel_count = valores.filter(v =>
      v < NORMAS.TEMPERATURA.envelope_min_c.valor ||
      v > NORMAS.TEMPERATURA.envelope_max_c.valor
    ).length;

    return ctx;
  }
}

// ===================================================================
//  REGRAS
// ===================================================================

AgenteTemperatura.REGRAS = [

  new Regra({
    id: "leitura-impossivel",
    categoria: "Leitura",
    label: "Existem leituras fisicamente impossíveis?",
    fonte: NORMAS.TEMPERATURA.envelope_min_c.fonte,
    parametros: {
      envelope_min: NORMAS.TEMPERATURA.envelope_min_c.valor,
      envelope_max: NORMAS.TEMPERATURA.envelope_max_c.valor,
    },
    avaliar(ctx, p) {
      if (!ctx.impossivel_count) return { status: "ok", resumo: "Sem leituras absurdas", detalhe: `Todas as leituras dentro de ${p.envelope_min}°C a ${p.envelope_max}°C.` };
      return {
        status: "crit",
        resumo: `${ctx.impossivel_count} leitura(s) impossível(eis)`,
        detalhe: `${ctx.impossivel_count} ponto(s) fora do envelope físico (${p.envelope_min} a ${p.envelope_max}°C). Min observado: ${ctx.min.toFixed(1)}°C · max: ${ctx.max.toFixed(1)}°C.`,
        diagnostico: "Sensor com defeito intermitente, cabo solto, interferência elétrica ou termopar exposto. Trocar/recalibrar.",
        valorMedido: `${ctx.min.toFixed(1)} / ${ctx.max.toFixed(1)}°C`,
        valorIdeal: `${p.envelope_min} a ${p.envelope_max}°C`,
      };
    },
  }),

  new Regra({
    id: "fora-da-faixa",
    categoria: "Faixa térmica",
    label: "A temperatura está dentro da faixa ideal?",
    fonte: NORMAS.ANVISA.rdc_275.fonte,
    parametros: {
      tempo_warn_pct: NORMAS.TEMPERATURA.tempo_fora_warn_pct.valor,
      tempo_crit_pct: NORMAS.TEMPERATURA.tempo_fora_crit_pct.valor,
    },
    avaliar(ctx, p) {
      if (!ctx.faixa) return { status: "info", resumo: "Sensor ambiente", detalhe: "Sem faixa controlada (mede o clima externo)." };
      const pct = ctx.tempo_fora_pct;
      const fmt = `${pct.toFixed(0)}% das ${ctx.n} leituras fora de ${ctx.faixa.min} a ${ctx.faixa.max}°C. Média: ${ctx.media.toFixed(1)}°C.`;
      if (pct >= p.tempo_crit_pct) return {
        status: "crit", resumo: `${pct.toFixed(0)}% fora da faixa`, detalhe: fmt,
        diagnostico: "Câmara fora da faixa controlada por tempo prolongado. Falha de refrigeração, setpoint errado ou porta esquecida. Risco direto à qualidade do produto (RDC 275).",
        valorMedido: pct, valorIdeal: `< ${p.tempo_warn_pct}%`,
      };
      if (pct >= p.tempo_warn_pct) return {
        status: "warn", resumo: `${pct.toFixed(0)}% fora da faixa`, detalhe: fmt,
        diagnostico: "Tempo fora da faixa começando a ficar relevante. Investigar setpoint e ciclo de refrigeração.",
        valorMedido: pct, valorIdeal: `< ${p.tempo_warn_pct}%`,
      };
      return { status: "ok", resumo: `${pct.toFixed(0)}% fora`, detalhe: fmt, valorMedido: pct };
    },
  }),

  new Regra({
    id: "temperatura-atual",
    categoria: "Faixa térmica",
    label: "Qual a temperatura agora?",
    fonte: NORMAS.ANVISA.rdc_275.fonte,
    avaliar(ctx) {
      if (ctx.atual == null) return { status: "info", resumo: "—", detalhe: "Sem leitura recente." };
      const t = ctx.atual;
      const f = ctx.faixa;
      if (Math.abs(t) > 100) return { status: "crit", resumo: `${t.toFixed(1)}°C`, detalhe: `Leitura fora do envelope físico (${t.toFixed(1)}°C).`, diagnostico: "Sensor com defeito.", valorMedido: t };
      if (f) {
        if (t < f.min) return { status: "warn", resumo: `${t.toFixed(1)}°C`, detalhe: `Abaixo da faixa ideal (${f.min} a ${f.max}°C).`, valorMedido: t, valorIdeal: `${f.min} a ${f.max}°C` };
        if (t > f.max) return { status: "crit", resumo: `${t.toFixed(1)}°C`, detalhe: `Acima da faixa ideal (${f.min} a ${f.max}°C) — risco ao produto.`, diagnostico: "Falha de refrigeração agora. Produto em risco — agir.", valorMedido: t, valorIdeal: `${f.min} a ${f.max}°C` };
        return { status: "ok", resumo: `${t.toFixed(1)}°C`, detalhe: `Dentro da faixa ideal (${f.min} a ${f.max}°C).`, valorMedido: t, valorIdeal: `${f.min} a ${f.max}°C` };
      }
      return { status: "info", resumo: `${t.toFixed(1)}°C`, detalhe: "Sensor de ambiente — sem faixa controlada.", valorMedido: t };
    },
  }),

  new Regra({
    id: "oscilacao",
    categoria: "Oscilação",
    label: "A temperatura está estável ou oscilando muito?",
    fonte: NORMAS.TEMPERATURA.oscilacao_warn_sigma.fonte,
    parametros: { warn_sigma: NORMAS.TEMPERATURA.oscilacao_warn_sigma.valor },
    avaliar(ctx, p) {
      const sigma = ctx.desvio;
      if (sigma > p.warn_sigma) return {
        status: "warn", resumo: `σ=${sigma.toFixed(2)}°C`, detalhe: `Desvio-padrão ${sigma.toFixed(2)}°C · amplitude ${ctx.amplitude.toFixed(1)}°C.`,
        diagnostico: "Setpoint mal ajustado, short-cycling do compressor ou interferência no sensor.",
        valorMedido: sigma, valorIdeal: `< ${p.warn_sigma}°C`,
      };
      return { status: "ok", resumo: `σ=${sigma.toFixed(2)}°C`, detalhe: `Oscilação dentro do esperado.`, valorMedido: sigma };
    },
  }),

  new Regra({
    id: "tendencia",
    categoria: "Tendência",
    label: "A temperatura tem tendência de subir ou cair?",
    fonte: NORMAS.TEMPERATURA.tendencia_warn_c_h.fonte,
    parametros: { warn_c_h: NORMAS.TEMPERATURA.tendencia_warn_c_h.valor },
    avaliar(ctx, p) {
      const t = ctx.tendencia_c_h;
      if (!isFinite(t) || ctx.n < 4) return { status: "info", resumo: "Sem tendência", detalhe: "Janela insuficiente pra calcular tendência." };
      if (Math.abs(t) > p.warn_c_h) return {
        status: "warn", resumo: `${t > 0 ? "+" : ""}${t.toFixed(2)}°C/h`,
        detalhe: `Sistema térmico ${t > 0 ? "esquentando" : "esfriando"} ${Math.abs(t).toFixed(2)}°C por hora.`,
        diagnostico: t > 0
          ? "Possível falha de refrigeração começando, vazamento de gás ou setpoint subindo."
          : "Sobrearrefecimento ou setpoint baixo demais — risco de congelar produto sensível.",
        valorMedido: t, valorIdeal: `|t| < ${p.warn_c_h}°C/h`,
      };
      return { status: "ok", resumo: `${t > 0 ? "+" : ""}${t.toFixed(2)}°C/h`, detalhe: "Tendência baixa — sistema estável.", valorMedido: t };
    },
  }),

  new Regra({
    id: "picos-zscore",
    categoria: "Picos",
    label: "Há picos isolados (z-score > limite)?",
    fonte: NORMAS.TEMPERATURA.z_score_pico.fonte,
    parametros: { z_limite: NORMAS.TEMPERATURA.z_score_pico.valor },
    avaliar(ctx, p) {
      const n = ctx.picos_zscore;
      if (n === 0) return { status: "ok", resumo: "Sem picos", detalhe: `0 pontos com |z| > ${p.z_limite}.` };
      if (n > 20) return { status: "warn", resumo: `${n} picos`, detalhe: `${n} pontos com |z-score| > ${p.z_limite}. Padrão caótico.`, diagnostico: "Sensor pode estar com defeito intermitente.", valorMedido: n };
      return { status: "info", resumo: `${n} picos`, detalhe: `${n} ponto(s) com |z-score| > ${p.z_limite}.`, valorMedido: n };
    },
  }),

  new Regra({
    id: "sensor-travado",
    categoria: "Sensor",
    label: "O sensor está vivo (não travado)?",
    fonte: NORMAS.TEMPERATURA.sensor_travado_sigma.fonte,
    parametros: { sigma_min: NORMAS.TEMPERATURA.sensor_travado_sigma.valor },
    avaliar(ctx, p) {
      if (ctx.travado) return {
        status: "crit", resumo: "Sensor travado", detalhe: `Desvio σ=${ctx.desvio.toFixed(3)}°C — leituras virtualmente idênticas.`,
        diagnostico: "Sensor congelou em um valor, cabo solto ou firmware travado. Reiniciar/trocar.",
        valorMedido: ctx.desvio, valorIdeal: `> ${p.sigma_min}°C`,
      };
      return { status: "ok", resumo: "Sensor respondendo", detalhe: `σ=${ctx.desvio.toFixed(2)}°C indica leituras dinâmicas.`, valorMedido: ctx.desvio };
    },
  }),

];

if (typeof window !== "undefined") window.AgenteTemperatura = AgenteTemperatura;
