/**
 * Agente para sensores de PORTA.
 *
 * Métricas pré-calculadas:
 *   eventos[]         lista de {inicio, fim, duracao_s} extraída do sinal
 *   abertas           qtd de aberturas
 *   duracao_total_s   tempo total aberta
 *   duracao_media_s   média (segundos)
 *   maior_evento_s    maior abertura
 *   fracao_aberta     0..1, % do tempo aberta
 *   aberta_agora      true se o último ponto é > 0
 *   binario           true se valores são essencialmente {0, X} (uniforme)
 *   metade1_abert, metade2_abert  aberturas em cada metade da janela
 */
class AgentePorta extends AgenteBase {

  contexto(pontos) {
    const ctx = super.contexto(pontos);
    if (!pontos.length) return ctx;

    // Detecta eventos por transição: porta abre quando valor > 0 e antes era 0.
    const eventos = [];
    let dentro = false, inicio = null;
    for (const p of pontos) {
      const v = p.abertura_porta || 0;
      const aberta = v > 0.01;
      if (aberta && !dentro) { inicio = new Date(p.time); dentro = true; }
      if (!aberta && dentro) {
        const fim = new Date(p.time);
        eventos.push({ inicio, fim, duracao_s: (fim - inicio) / 1000 });
        dentro = false;
      }
    }
    // evento aberto no momento atual
    if (dentro) {
      const fim = new Date(pontos[pontos.length - 1].time);
      eventos.push({ inicio, fim, duracao_s: (fim - inicio) / 1000, em_andamento: true });
    }
    ctx.eventos         = eventos;
    ctx.abertas         = eventos.length;
    ctx.duracao_total_s = eventos.reduce((s, e) => s + e.duracao_s, 0);
    ctx.duracao_media_s = eventos.length ? ctx.duracao_total_s / eventos.length : 0;
    ctx.maior_evento_s  = eventos.length ? Math.max(...eventos.map(e => e.duracao_s)) : 0;

    const periodoTotal_s = (new Date(pontos[pontos.length - 1].time) - new Date(pontos[0].time)) / 1000;
    ctx.periodo_total_s  = periodoTotal_s;
    ctx.fracao_aberta    = periodoTotal_s > 0 ? ctx.duracao_total_s / periodoTotal_s : 0;

    ctx.aberta_agora = (pontos[pontos.length - 1].abertura_porta || 0) > 0.01;

    // Sinal binário?
    const valores = pontos.map(p => p.abertura_porta);
    const unicos  = Array.from(new Set(valores.map(v => Math.round((v || 0) * 100) / 100)));
    ctx.binario = unicos.length <= 2;
    ctx.valores_unicos = unicos.length;

    // Aberturas por metade do período (padrão evolutivo)
    const meio = pontos[Math.floor(pontos.length / 2)] ? new Date(pontos[Math.floor(pontos.length / 2)].time) : null;
    if (meio) {
      ctx.metade1_abert = eventos.filter(e => e.inicio < meio).length;
      ctx.metade2_abert = eventos.filter(e => e.inicio >= meio).length;
    } else {
      ctx.metade1_abert = 0;
      ctx.metade2_abert = 0;
    }

    return ctx;
  }
}

// ===================================================================
//  REGRAS
// ===================================================================

AgentePorta.REGRAS = [

  new Regra({
    id: "porta-esquecida",
    categoria: "Tempo aberta",
    label: "Houve abertura prolongada (porta esquecida)?",
    fonte: NORMAS.PORTA.esquecida_s.fonte,
    parametros: { esquecida_s: NORMAS.PORTA.esquecida_s.valor },
    avaliar(ctx, p) {
      if (!ctx.maior_evento_s) return { status: "ok", resumo: "Nenhuma abertura", detalhe: "Sem aberturas na janela." };
      if (ctx.maior_evento_s > p.esquecida_s * 6) return {
        status: "crit", resumo: `Maior: ${(ctx.maior_evento_s/60).toFixed(0)} min`,
        detalhe: `Maior abertura durou ${(ctx.maior_evento_s/60).toFixed(0)} min.`,
        diagnostico: "Porta ficou aberta por tempo muito longo. Esquecimento, mercadoria emperrando ou sensor travado. Câmara perdeu frio em massa.",
        valorMedido: ctx.maior_evento_s, valorIdeal: `< ${p.esquecida_s}s`,
      };
      if (ctx.maior_evento_s > p.esquecida_s) return {
        status: "warn", resumo: `Maior: ${(ctx.maior_evento_s/60).toFixed(0)} min`,
        detalhe: `Maior abertura ${(ctx.maior_evento_s/60).toFixed(1)} min, acima do limite (${(p.esquecida_s/60).toFixed(0)} min).`,
        diagnostico: "Provável esquecimento. Treinar equipe ou verificar mecanismo de fechamento automático.",
        valorMedido: ctx.maior_evento_s, valorIdeal: `< ${p.esquecida_s}s`,
      };
      return { status: "ok", resumo: `Maior: ${(ctx.maior_evento_s/60).toFixed(1)} min`, detalhe: "Maior abertura dentro do esperado.", valorMedido: ctx.maior_evento_s };
    },
  }),

  new Regra({
    id: "tempo-medio-alto",
    categoria: "Tempo aberta",
    label: "O tempo médio de abertura está aceitável?",
    fonte: NORMAS.PORTA.tempo_medio_warn_s.fonte,
    parametros: { warn_s: NORMAS.PORTA.tempo_medio_warn_s.valor },
    avaliar(ctx, p) {
      if (!ctx.abertas) return { status: "ok", resumo: "Sem aberturas", detalhe: "Nada a medir." };
      const m = ctx.duracao_media_s;
      if (m > p.warn_s) return {
        status: "warn", resumo: `Média ${(m/60).toFixed(1)} min`,
        detalhe: `Tempo médio de abertura: ${(m/60).toFixed(1)} min sobre ${ctx.abertas} eventos.`,
        diagnostico: "Padrão operacional ruim ou vedação travando a porta semi-aberta. Cada minuto extra = perda direta de frio.",
        valorMedido: m, valorIdeal: `< ${p.warn_s}s`,
      };
      return { status: "ok", resumo: `Média ${m.toFixed(0)}s`, detalhe: "Tempo médio dentro do esperado.", valorMedido: m };
    },
  }),

  new Regra({
    id: "fracao-aberta",
    categoria: "Tempo aberta",
    label: "Qual fração do período a porta passou aberta?",
    fonte: "Engenharia frigorífica",
    parametros: { warn_pct: 5, crit_pct: 25 },
    avaliar(ctx, p) {
      const pct = ctx.fracao_aberta * 100;
      if (pct >= p.crit_pct) return {
        status: "crit", resumo: `${pct.toFixed(0)}% do tempo aberta`, detalhe: `Aberta ${pct.toFixed(0)}% do período.`,
        diagnostico: "Operação anormal: vedação ruim, porta travando entreaberta ou sensor com defeito. Custo direto em kWh.",
        valorMedido: pct, valorIdeal: `< ${p.warn_pct}%`,
      };
      if (pct >= p.warn_pct) return {
        status: "warn", resumo: `${pct.toFixed(0)}% do tempo aberta`, detalhe: `Aberta ${pct.toFixed(0)}% do período.`,
        diagnostico: "Acima do esperado. Cada % significa kWh extras na fatura.",
        valorMedido: pct, valorIdeal: `< ${p.warn_pct}%`,
      };
      return { status: "ok", resumo: `${pct.toFixed(1)}% do tempo`, detalhe: "Uso normal.", valorMedido: pct };
    },
  }),

  new Regra({
    id: "padrao-evolutivo",
    categoria: "Frequência",
    label: "O padrão de aberturas mudou ao longo do período?",
    fonte: NORMAS.PORTA.mudanca_padrao_pct.fonte,
    parametros: { mudanca_pct: NORMAS.PORTA.mudanca_padrao_pct.valor },
    avaliar(ctx, p) {
      const m1 = ctx.metade1_abert, m2 = ctx.metade2_abert;
      if (m1 + m2 < 3) return { status: "info", resumo: "Poucos eventos", detalhe: `Apenas ${m1+m2} aberturas — amostra pequena.` };
      const base = Math.max(m1, 1);
      const pct = ((m2 - m1) / base) * 100;
      if (Math.abs(pct) >= p.mudanca_pct) return {
        status: "warn", resumo: `${pct > 0 ? "+" : ""}${pct.toFixed(0)}% entre metades`,
        detalhe: `Primeira metade: ${m1} · segunda: ${m2}. Variação ${pct.toFixed(0)}%.`,
        diagnostico: "Mudança operacional (novo turno, novo procedimento) ou problema mecânico evoluindo.",
        valorMedido: pct, valorIdeal: `|Δ| < ${p.mudanca_pct}%`,
      };
      return { status: "ok", resumo: `${m1}↔${m2} aberturas`, detalhe: "Padrão estável entre as metades.", valorMedido: pct };
    },
  }),

  new Regra({
    id: "rajada-aberturas",
    categoria: "Frequência",
    label: "Houve rajadas de aberturas (intervalo curto)?",
    fonte: NORMAS.PORTA.rajada_intervalo_s.fonte,
    parametros: { rajada_s: NORMAS.PORTA.rajada_intervalo_s.valor },
    avaliar(ctx, p) {
      const ev = ctx.eventos;
      if (ev.length < 2) return { status: "ok", resumo: "Sem rajadas", detalhe: "Eventos insuficientes pra avaliar." };
      let rajadas = 0;
      for (let i = 1; i < ev.length; i++) {
        const intervalo = (ev[i].inicio - ev[i - 1].fim) / 1000;
        if (intervalo > 0 && intervalo < p.rajada_s) rajadas++;
      }
      if (rajadas > 0) return {
        status: "warn", resumo: `${rajadas} rajada(s)`,
        detalhe: `${rajadas} abertura(s) com intervalo menor que ${p.rajada_s}s desde a anterior.`,
        diagnostico: "Uso intenso (turno de carga/descarga) ou sensor reagindo a falsos contatos.",
        valorMedido: rajadas, valorIdeal: `0`,
      };
      return { status: "ok", resumo: "Sem rajadas", detalhe: "Intervalos entre aberturas saudáveis.", valorMedido: 0 };
    },
  }),

  new Regra({
    id: "sinal-binario",
    categoria: "Sinal",
    label: "O sinal é coerente (binário ou perto disso)?",
    fonte: "Convenção: porta = sinal digital",
    parametros: { max_unicos: 4 },
    avaliar(ctx, p) {
      if (ctx.binario) return { status: "ok", resumo: "Sinal binário", detalhe: `${ctx.valores_unicos} valor(es) único(s) — coerente com sinal digital.` };
      if (ctx.valores_unicos > p.max_unicos * 5) return {
        status: "info", resumo: `Sinal analógico (${ctx.valores_unicos} valores)`,
        detalhe: `${ctx.valores_unicos} valores únicos — pode ser sensor analógico ou semi-analógico.`,
        diagnostico: "Confirmar a configuração do sensor (digital vs analógico).",
      };
      return { status: "info", resumo: `${ctx.valores_unicos} valores únicos`, detalhe: "Sinal intermediário entre binário e analógico." };
    },
  }),

  new Regra({
    id: "estado-atual",
    categoria: "Estado",
    label: "A porta está aberta ou fechada agora?",
    fonte: "Última leitura recebida",
    avaliar(ctx) {
      if (ctx.aberta_agora) return { status: "warn", resumo: "ABERTA", detalhe: "A porta está aberta neste momento." };
      return { status: "ok", resumo: "FECHADA", detalhe: "A porta está fechada neste momento." };
    },
  }),

];

if (typeof window !== "undefined") window.AgentePorta = AgentePorta;
