/**
 * AgenteReconstrutor — preenche lacunas na série temporal usando como
 * referência o MESMO dia da semana e MESMA janela horária do gap, nas
 * últimas 4 semanas do histórico (até 30 dias).
 *
 * IMPORTANTE: a reconstrução é PUREMENTE BASEADA NO PASSADO. Quando a
 * internet/sensor volta, os pontos DEPOIS do gap são leituras REAIS —
 * o agente NÃO os usa pra calcular nada nem pra "suavizar a chegada".
 * O encaixe natural acontece pq o primeiro ponto pós-gap é dado real.
 *
 * ESTRATÉGIA PRINCIPAL: SPLC SEMANAL (lookback only)
 *  - Gap de terça 12:30 → busca amostras de terça 12:30 (±30min) nas
 *    4 terças anteriores. Pondera mais semanas recentes (1/n).
 *  - Descarta outliers (z-score > 3) antes de calcular a média.
 *  - Calibra com offset entre a média dos 5 pontos ANTES do gap e
 *    a vizinhança do horário-base na semana correspondente.
 *
 * FALLBACKS (em ordem, todos lookback-only):
 *  1. SPLC semanal (4 semanas no mesmo DOW + horário)        — confiança 0.80-0.95
 *  2. SPLC diário  (mesmo horário do dia anterior)           — confiança 0.65-0.75
 *  3. SPLC mensal  (média móvel de 30d no mesmo horário)     — confiança 0.55-0.65
 *  4. Hold-last: mantém a média dos últimos pontos antes     — confiança 0.40-0.50
 *
 * ESTRATÉGIA POR CAMPO:
 *  - tensao_*           → média estável do contexto adjacente (linear)
 *  - corrente_*         → SPLC semanal
 *  - fator_potencia_*   → média do contexto
 *  - temperatura (amb)  → SPLC semanal (ciclo dia/noite + tendência semanal)
 *  - temperatura (câm)  → SPLC semanal + correção pela tendência local
 *  - abertura_porta     → step (mantém último estado conhecido)
 *
 * META DO PONTO (ponto._meta):
 *  - confianca: 0..1 (média ponderada das confianças por campo)
 *  - janela_horaria: "12:30 – 13:30" (faixa de horário do gap)
 *  - dia_semana: "terça-feira"
 *  - estrategia_principal: "splc_semanal" | "splc_diario" | "splc_mensal" | "interpolacao"
 *  - n_semanas_usadas: 4
 *  - gap_inicio_ts / gap_fim_ts: limites do gap real
 *  - periodo_base_descricao: "média das últimas 4 terças-feiras das 12h–13h"
 *
 * Quando o sensor está offline AGORA (sem ponto-âncora depois), o agente
 * NÃO inventa: adiciona pontos com _vazio=true (linha morta no eixo zero).
 */
class AgenteReconstrutor {
  static CADENCIA_S = { energia: 30, temperatura: 60, porta: 60 };
  static GAP_MULT   = 1.6;
  static N_CONTEXTO = 5;

  /** Quantas semanas pra trás buscar no SPLC semanal. */
  static N_SEMANAS  = 4;
  /** Janela de tolerância em torno do horário-alvo, em ms. */
  static TOLERANCIA_MIN_MS = 30 * 60 * 1000;   // ±30 min

  /** Ciclos de fallback se não der pra usar SPLC semanal. */
  static CICLOS_FALLBACK = [
    { id: "24h", segundos: 86400,      peso: 0.50 },
    { id: "30d", segundos: 86400 * 30, peso: 0.20 },
  ];

  /** Z-score acima disso = outlier no histórico, descartar. */
  static Z_OUTLIER = 3;

  /** Nomes em PT-BR pra mostrar nos tooltips. */
  static DIAS_SEMANA = [
    "domingo","segunda-feira","terça-feira","quarta-feira",
    "quinta-feira","sexta-feira","sábado",
  ];

  constructor(sensor) {
    this.sensor = sensor;
    this.tipo = sensor?.tipo || "energia";
    this.cadencia = AgenteReconstrutor.CADENCIA_S[this.tipo] || 60;
  }

  // -------------------------------------------------------------------
  //  API principal — `pontos` é a janela atual; `historico` é o cache
  //  estendido (até 7d) que o pagina.js mantém em background.
  // -------------------------------------------------------------------
  reconstruir(pontos, historico = null) {
    if (!Array.isArray(pontos) || pontos.length < 2) {
      return { pontos: pontos || [], gaps: [], offlineAgora: false };
    }
    // O histórico SPLC é a união de "pontos da janela" + "historico estendido"
    // (deduplicado por timestamp). Garante busca em qualquer ciclo.
    const baseHistorica = this._unirHistorico(pontos, historico || []);

    const passoMs = this.cadencia * 1000;
    const limiteGapMs = passoMs * AgenteReconstrutor.GAP_MULT;
    const N = AgenteReconstrutor.N_CONTEXTO;
    const saida = [];
    const gaps = [];

    for (let i = 0; i < pontos.length; i++) {
      saida.push(pontos[i]);
      if (i === pontos.length - 1) break;

      const tA = new Date(pontos[i].time).getTime();
      const tB = new Date(pontos[i + 1].time).getTime();
      const delta = tB - tA;
      if (delta <= limiteGapMs) continue;

      const n = Math.floor(delta / passoMs) - 1;
      if (n < 1) continue;

      const antesArr  = pontos.slice(Math.max(0, i - N + 1), i + 1);
      const depoisArr = pontos.slice(i + 1, Math.min(pontos.length, i + 1 + N));

      const resultado = this._reconstruirGap(
        antesArr, depoisArr, n, passoMs, tA, delta / 1000, baseHistorica
      );
      saida.push(...resultado.pontos);
      gaps.push(resultado.resumo);
    }

    // Linha morta — gap em curso
    const ultimo = pontos[pontos.length - 1];
    const ultimoMs = new Date(ultimo.time).getTime();
    const agoraMs = Date.now();
    const desdeUltimo = agoraMs - ultimoMs;
    let offlineAgora = false;
    if (desdeUltimo > limiteGapMs) {
      offlineAgora = true;
      const campos = Object.keys(ultimo).filter(k => k !== "time");
      const nNulls = Math.min(120, Math.floor(desdeUltimo / passoMs));
      for (let j = 1; j <= nNulls; j++) {
        const t = ultimoMs + passoMs * j;
        if (t > agoraMs) break;
        const ponto = { time: new Date(t).toISOString(), _vazio: true };
        // Valor = 0 (não null): a linha "morta" continua avançando no
        // eixo X, no nível zero, mostrando visualmente que o tempo está
        // passando mas o sensor não está mandando nada. No chart, esses
        // pontos vão pra uma série separada com cor/tracejado distintos.
        for (const k of campos) ponto[k] = 0;
        saida.push(ponto);
      }
    }

    return {
      pontos: saida,
      gaps,
      offlineAgora,
      segDesdeUltimo: desdeUltimo / 1000,
    };
  }

  _unirHistorico(janela, estendido) {
    // Deduplica por timestamp, garante ordenado.
    const mapa = new Map();
    for (const p of estendido) mapa.set(p.time, p);
    for (const p of janela) mapa.set(p.time, p);   // janela tem prioridade
    return [...mapa.values()].sort((a, b) =>
      new Date(a.time).getTime() - new Date(b.time).getTime()
    );
  }

  // -------------------------------------------------------------------
  //  Reconstrói UM gap inteiro com janelas semanais (mesmo DOW + horário).
  // -------------------------------------------------------------------
  _reconstruirGap(antesArr, depoisArr, n, passoMs, tInicialMs, duracao_s, historico) {
    const camposNumericos = Object.keys(antesArr[antesArr.length - 1])
      .filter(k => k !== "time" && typeof antesArr[antesArr.length - 1][k] === "number");

    const estrategiaDe = (campo) => {
      if (this.tipo === "porta")                          return "step";
      if (campo.startsWith("tensao_"))                    return "media";
      if (campo.startsWith("fator_potencia_"))            return "media";
      if (campo.startsWith("corrente_"))                  return "splc";
      if (campo === "temperatura")                        return "splc";
      if (campo === "abertura_porta")                     return "step";
      return "splc";
    };

    // Média-âncora APENAS dos pontos ANTES do gap. Os pontos depois são
    // leituras reais — não usamos pra calcular nada (lookback-only).
    const mediaAntes = {};
    for (const k of camposNumericos) {
      mediaAntes[k] = _media(antesArr.map(p => p[k]));
    }

    // Limites do gap (usados na descrição da janela horária)
    const janelaInicio = this._formatarHora(new Date(antesArr[antesArr.length - 1].time));
    const janelaFim    = this._formatarHora(new Date(depoisArr[0].time));

    const out = [];
    const estrategiasNoGap = new Set();   // só pro `resumo`, não pro meta de cada ponto

    for (let i = 1; i <= n; i++) {
      const t = tInicialMs + passoMs * i;
      const frac = i / (n + 1);
      const ponto = { time: new Date(t).toISOString(), _reconstruido: true };
      const metasCampo = {};

      // ⚠ Bug fix: cada ponto tem o seu próprio estado. Antes o estado
      // era compartilhado entre todos os pontos do gap.
      const camposEstrategiaPonto = {};
      const camposConfiancaPonto  = {};
      const estrategiasNoPonto = new Set();
      let nSemanasPonto = 0;

      // Dia da semana CORRETO pra ESSE timestamp (em gaps longos que
      // cruzam meia-noite, cada ponto pode ter dia diferente).
      const diaSemanaPonto = AgenteReconstrutor.DIAS_SEMANA[new Date(t).getDay()];

      for (const k of camposNumericos) {
        const estr = estrategiaDe(k);
        const a = mediaAntes[k];   // só usamos o ANTES — lookback-only
        let valor = null, confCampo = 0, estrUsada = estr, fonte = "";

        if (estr === "step") {
          // Mantém último valor conhecido antes do gap.
          valor = a;
          confCampo = a != null ? 0.6 : 0;
          fonte = "Step — mantém o último estado conhecido antes do gap";
          estrUsada = "step";
        }
        else if (estr === "media") {
          // Campo estável (tensão, FP): mantém a média dos últimos pontos antes.
          if (a != null) {
            valor = +a.toFixed(3);
            confCampo = 0.80;
            fonte = "Hold da média dos últimos pontos antes do gap";
            estrUsada = "media";
          }
        }
        else if (estr === "splc") {
          // 1ª tentativa: SPLC semanal (mesmo DOW + mesmo horário, últimas N semanas)
          let splc = this._buscarSplcSemanal(t, k, historico, passoMs);
          if (splc) {
            estrUsada = "splc_semanal";
            nSemanasPonto = Math.max(nSemanasPonto, splc.nAmostras);
            fonte = `SPLC semanal (${splc.nAmostras} ${diaSemanaPonto}${splc.nAmostras > 1 ? "s" : ""} anteriores no mesmo horário)`;
          } else {
            // 2ª/3ª tentativa: ciclo 24h, depois 30d
            splc = this._buscarSplcFallback(t, k, historico, passoMs);
            if (splc) {
              estrUsada = splc.ciclo === "24h" ? "splc_diario" : "splc_mensal";
              fonte = `SPLC ${splc.ciclo} — fallback (sem ${diaSemanaPonto}s suficientes no histórico)`;
            }
          }

          if (splc) {
            // Calibração: offset fixo entre a média ANTES do gap e o
            // contexto da semana histórica. Sem termo "depois" — só
            // passado. Resultado: o valor estimado segue o nível atual.
            const offset = (a != null && splc.valorAntesContexto != null)
              ? (a - splc.valorAntesContexto)
              : 0;
            valor = +(splc.valor + offset).toFixed(3);
            confCampo = +(splc.confianca).toFixed(2);
          } else if (a != null) {
            // Fallback final: hold-last (mantém média anterior)
            valor = +a.toFixed(3);
            confCampo = 0.45;
            fonte = "Hold-last — sem histórico utilizável, mantém a média anterior ao gap";
            estrUsada = "hold_last";
          }
        }

        ponto[k] = valor;
        metasCampo[k] = { fonte, confianca: confCampo, estrategia: estrUsada };
        camposEstrategiaPonto[k] = estrUsada;
        camposConfiancaPonto[k]  = confCampo;
        estrategiasNoPonto.add(estrUsada);
        estrategiasNoGap.add(estrUsada);
      }

      const confs = Object.values(camposConfiancaPonto);
      const confAgregada = confs.length ? confs.reduce((s, x) => s + x, 0) / confs.length : 0;

      // Estratégia principal = a mais "forte" usada NESSE ponto
      const ordem = ["splc_semanal","splc_diario","splc_mensal","media","step","hold_last"];
      const principal = ordem.find(e => estrategiasNoPonto.has(e)) || "hold_last";

      ponto._meta = {
        reconstruido: true,
        confianca: +confAgregada.toFixed(2),

        // Janela e dia da semana (calculado por ponto)
        janela_horaria: `${janelaInicio} – ${janelaFim}`,
        dia_semana: diaSemanaPonto,
        gap_inicio_ts: antesArr[antesArr.length - 1].time,
        gap_fim_ts:    depoisArr[0].time,
        duracao_s,

        // Estratégia usada NESSE ponto
        estrategia_principal: principal,
        n_semanas_usadas: nSemanasPonto,
        periodo_base_descricao: this._descreverBase(principal, diaSemanaPonto, janelaInicio, janelaFim, nSemanasPonto),

        // Detalhe por campo
        camposEstrategia: camposEstrategiaPonto,
        camposConfianca: camposConfiancaPonto,
        metasPorCampo: metasCampo,

        nAntes: antesArr.length,
        nDepois: depoisArr.length,
      };
      out.push(ponto);
    }

    return {
      pontos: out,
      resumo: {
        inicio_ts: antesArr[antesArr.length - 1].time,
        fim_ts: depoisArr[0].time,
        duracao_s,
        n_reconstruidos: out.length,
        estrategias: [...estrategiasNoGap],
        confianca: out.length ? out[out.length - 1]._meta.confianca : 0,
      },
    };
  }

  /** Formata "12:30" pro tooltip. */
  _formatarHora(d) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  }

  /** Texto humano que vai pro tooltip ("periodo_base_descricao"). */
  _descreverBase(estrategia, diaSemana, hIni, hFim, nSemanas) {
    if (estrategia === "splc_semanal") {
      return `Média das últimas ${nSemanas} ${diaSemana}${nSemanas > 1 ? "s" : ""}, entre ${hIni} e ${hFim} (calibrada com o nível dos últimos pontos antes do gap)`;
    }
    if (estrategia === "splc_diario")  return `Média do mesmo horário (${hIni}–${hFim}) do dia anterior, calibrada com a média anterior ao gap`;
    if (estrategia === "splc_mensal")  return `Média móvel de 30 dias no horário ${hIni}–${hFim}, calibrada com a média anterior ao gap`;
    if (estrategia === "media")        return `Mantém a média estável dos últimos pontos antes do gap`;
    if (estrategia === "step")         return `Mantém o último valor conhecido antes do gap (sinal de estado)`;
    return `Hold-last — mantém a média anterior ao gap (sem histórico utilizável)`;
  }

  // -------------------------------------------------------------------
  //  SPLC SEMANAL: mesma janela horária + mesmo dia da semana, nas
  //  últimas N semanas. Pondera semanas mais recentes.
  // -------------------------------------------------------------------
  _buscarSplcSemanal(tAlvoMs, campo, historico, passoMs) {
    const N = AgenteReconstrutor.N_SEMANAS;
    const tol = AgenteReconstrutor.TOLERANCIA_MIN_MS;
    const amostras = [];

    for (let semana = 1; semana <= N; semana++) {
      const tBase = tAlvoMs - semana * 7 * 86400 * 1000;
      // Vizinhança do horário-alvo (±30min) no MESMO dia da semana
      const viz = this._vizinhanca(historico, tBase, tol, campo);
      if (viz.length === 0) continue;

      // Z-score: descarta outliers DENTRO da própria vizinhança semanal
      const med = _media(viz);
      const dp  = _desvioPadrao(viz, med);
      const valoresLimpos = (dp > 0)
        ? viz.filter(v => Math.abs((v - med) / dp) <= AgenteReconstrutor.Z_OUTLIER)
        : viz;
      const valorSemana = _media(valoresLimpos);
      if (valorSemana == null) continue;

      // Contexto antes/depois daquele horário, na mesma semana — pra suavização
      const vAntes  = _media(this._vizinhanca(historico, tBase - passoMs * 3, passoMs * 2, campo));
      const vDepois = _media(this._vizinhanca(historico, tBase + passoMs * 3, passoMs * 2, campo));

      // Peso decrescente: 1ª semana atrás pesa mais que 4ª
      const peso = 1 / semana;
      amostras.push({
        valor: valorSemana,
        valorAntesContexto: vAntes ?? valorSemana,
        valorDepoisContexto: vDepois ?? valorSemana,
        peso,
        semana,
      });
    }

    if (!amostras.length) return null;

    const somaPeso = amostras.reduce((s, a) => s + a.peso, 0);
    const valor = amostras.reduce((s, a) => s + a.valor * a.peso, 0) / somaPeso;
    const vAntesC  = amostras.reduce((s, a) => s + a.valorAntesContexto * a.peso, 0) / somaPeso;
    const vDepoisC = amostras.reduce((s, a) => s + a.valorDepoisContexto * a.peso, 0) / somaPeso;

    // Confiança: 0.80 com 1 semana, +0.05 por semana adicional, máx 0.95
    const confianca = Math.min(0.95, 0.80 + (amostras.length - 1) * 0.05);

    return {
      valor: +valor.toFixed(3),
      valorAntesContexto: vAntesC,
      valorDepoisContexto: vDepoisC,
      nAmostras: amostras.length,
      confianca,
    };
  }

  // -------------------------------------------------------------------
  //  Fallback: se não há semanas suficientes, tenta ciclo 24h ou 30d.
  // -------------------------------------------------------------------
  _buscarSplcFallback(tAlvoMs, campo, historico, passoMs) {
    for (const ciclo of AgenteReconstrutor.CICLOS_FALLBACK) {
      const tBase = tAlvoMs - ciclo.segundos * 1000;
      const viz = this._vizinhanca(historico, tBase, passoMs * 6, campo);
      if (viz.length < 2) continue;

      const med = _media(viz);
      const dp  = _desvioPadrao(viz, med);
      const limpos = (dp > 0)
        ? viz.filter(v => Math.abs((v - med) / dp) <= AgenteReconstrutor.Z_OUTLIER)
        : viz;
      const valor = _media(limpos);
      if (valor == null) continue;

      const vAntes  = _media(this._vizinhanca(historico, tBase - passoMs * 3, passoMs * 2, campo));
      const vDepois = _media(this._vizinhanca(historico, tBase + passoMs * 3, passoMs * 2, campo));

      return {
        valor: +valor.toFixed(3),
        valorAntesContexto: vAntes ?? valor,
        valorDepoisContexto: vDepois ?? valor,
        nAmostras: limpos.length,
        ciclo: ciclo.id,
        confianca: ciclo.id === "24h" ? 0.70 : 0.55,
      };
    }
    return null;
  }

  _vizinhanca(pontos, tCentroMs, raioMs, campo) {
    const out = [];
    for (const p of pontos) {
      const t = new Date(p.time).getTime();
      if (Math.abs(t - tCentroMs) > raioMs) continue;
      if (typeof p[campo] === "number" && !p._reconstruido) out.push(p[campo]);
    }
    return out;
  }

  static segundosDesde(ultimoIso) {
    if (!ultimoIso) return Infinity;
    return (Date.now() - new Date(ultimoIso).getTime()) / 1000;
  }
}

function _media(arr) {
  const v = (arr || []).filter(x => typeof x === "number" && isFinite(x));
  if (!v.length) return null;
  return v.reduce((s, x) => s + x, 0) / v.length;
}
function _desvioPadrao(arr, media) {
  const v = arr.filter(x => typeof x === "number" && isFinite(x));
  if (v.length < 2) return 0;
  const m = media ?? _media(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
}

if (typeof window !== "undefined") window.AgenteReconstrutor = AgenteReconstrutor;
