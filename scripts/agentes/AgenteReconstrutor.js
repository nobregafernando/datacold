/**
 * AgenteReconstrutor — preenche lacunas na série temporal usando o
 * algoritmo mais fiel possível pra cada tipo de campo.
 *
 * ESTRATÉGIA POR CAMPO:
 *  - tensao_*           → média do contexto adjacente (sinal estável)
 *  - corrente_*         → SPLC multi-ciclo + outlier detection
 *  - fator_potencia_*   → média do contexto
 *  - temperatura (amb)  → SPLC 24h dominante (ciclo dia/noite)
 *  - temperatura (câm)  → SPLC + correção pela tendência local
 *  - abertura_porta     → step (mantém último estado conhecido)
 *
 * MULTI-CICLO (SPLC ponderado):
 *  Pra cada ponto, o agente busca o "mesmo horário" em N ciclos passados
 *  (24h, 7d) dentro do histórico carregado, descarta outliers (z>3),
 *  e calcula uma média ponderada (24h mais peso que 7d).
 *
 * OUTLIER DETECTION:
 *  Antes de usar um valor histórico, verifica se ele é coerente com
 *  os vizinhos no próprio histórico. Z-score > 3 = descarta.
 *
 * CONFIANÇA:
 *  Calculada por campo, combinada na meta do ponto. Quanto mais
 *  ciclos contribuíram (sem outliers) e menor o gap, maior a confiança.
 *
 * Quando não há ponto-âncora DEPOIS (sensor offline AGORA), o agente
 * NÃO inventa: adiciona pontos com null (linha morta) até "agora".
 */
class AgenteReconstrutor {
  static CADENCIA_S = { energia: 30, temperatura: 60, porta: 60 };
  static GAP_MULT   = 1.6;
  static N_CONTEXTO = 5;
  /** Ciclos buscados pra SPLC, em segundos. Cada um com seu peso. */
  static CICLOS = [
    { id: "24h", segundos: 86400,      peso: 0.50 },  // padrão diário (dominante)
    { id: "7d",  segundos: 86400 * 7,  peso: 0.30 },  // dia da semana
    { id: "30d", segundos: 86400 * 30, peso: 0.20 },  // tendência mensal
  ];
  /** Z-score acima disso = outlier no histórico, descartar. */
  static Z_OUTLIER = 3;

  constructor(sensor) {
    this.sensor = sensor;
    this.tipo = sensor?.tipo || "energia";
    this.cadencia = AgenteReconstrutor.CADENCIA_S[this.tipo] || 60;
    // True quando o sensor é ambiente externo (ciclo dia/noite dominante)
    this.eAmbienteExterno = !!sensor?.grupo?.startsWith("externo");
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
  //  Reconstrói UM gap inteiro: pra cada ponto sintético, escolhe a
  //  estratégia por campo e produz um valor com confiança.
  // -------------------------------------------------------------------
  _reconstruirGap(antesArr, depoisArr, n, passoMs, tInicialMs, duracao_s, historico) {
    const camposNumericos = Object.keys(antesArr[antesArr.length - 1])
      .filter(k => k !== "time" && typeof antesArr[antesArr.length - 1][k] === "number");

    // Estratégia por campo
    const estrategiaDe = (campo) => {
      if (this.tipo === "porta")                          return "step";
      if (this.tipo === "temperatura" && this.eAmbienteExterno) return "splc";
      if (campo.startsWith("tensao_"))                    return "media";
      if (campo.startsWith("fator_potencia_"))            return "media";
      if (campo.startsWith("corrente_"))                  return "splc";
      if (campo === "temperatura")                        return "splc";
      if (campo === "abertura_porta")                     return "step";
      return "splc";
    };

    // Médias de âncora (sempre úteis pra corrigir continuidade)
    const mediaAntes = {}, mediaDepois = {};
    for (const k of camposNumericos) {
      mediaAntes[k]  = _media(antesArr.map(p => p[k]));
      mediaDepois[k] = _media(depoisArr.map(p => p[k]));
    }

    const out = [];
    const metaResumo = {
      duracao_s,
      nAntes: antesArr.length,
      nDepois: depoisArr.length,
      camposEstrategia: {},        // {campo: "splc"/"media"/"step"}
      camposConfianca: {},         // {campo: 0..1}
      ciclosUsados: new Set(),     // {"24h", "7d", ...}
    };

    for (let i = 1; i <= n; i++) {
      const t = tInicialMs + passoMs * i;
      const frac = i / (n + 1);
      const ponto = { time: new Date(t).toISOString(), _reconstruido: true };
      const metasCampo = {};       // por campo: {valor, fonte, confianca}

      for (const k of camposNumericos) {
        const estr = estrategiaDe(k);
        const a = mediaAntes[k], b = mediaDepois[k];
        let valor = null, confCampo = 0, fonte = estr;

        if (estr === "step") {
          valor = frac < 0.5 ? (a ?? b) : (b ?? a);
          confCampo = (a != null || b != null) ? 0.6 : 0;
          fonte = "step (mantém último estado conhecido)";
        }
        else if (estr === "media") {
          if (a != null && b != null) {
            // Interpolação linear suave entre as médias (campo estável)
            valor = +((a + (b - a) * frac).toFixed(3));
            confCampo = 0.85;
            fonte = "média do contexto adjacente";
          } else if (a != null || b != null) {
            valor = a ?? b;
            confCampo = 0.55;
            fonte = "média de um lado só";
          }
        }
        else if (estr === "splc") {
          const splc = this._buscarMultiCiclo(t, k, historico, passoMs);
          if (splc) {
            // Corrige nas pontas pra evitar salto
            const offIni = (a ?? splc.valor) - splc.valorAntesContexto;
            const offFim = (b ?? splc.valor) - splc.valorDepoisContexto;
            const offset = offIni + (offFim - offIni) * frac;
            valor = +(splc.valor + offset).toFixed(3);
            confCampo = +(splc.confianca).toFixed(2);
            fonte = `SPLC ${splc.ciclosUsados.map(c => c.id).join("+")} (${splc.nAmostras} amostras, sem outliers)`;
            splc.ciclosUsados.forEach(c => metaResumo.ciclosUsados.add(c.id));
          } else if (a != null && b != null) {
            // Fallback: interpolação
            valor = +((a + (b - a) * frac).toFixed(3));
            confCampo = 0.55;
            fonte = "fallback — sem ciclo histórico, interpolação entre âncoras";
          }
        }

        ponto[k] = valor;
        metasCampo[k] = { fonte, confianca: confCampo };
        metaResumo.camposEstrategia[k] = estr;
        metaResumo.camposConfianca[k] = confCampo;
      }

      // Confiança agregada do ponto = média das confiances dos campos
      const confs = Object.values(metaResumo.camposConfianca);
      const confAgregada = confs.length ? confs.reduce((s, x) => s + x, 0) / confs.length : 0;

      ponto._meta = {
        reconstruido: true,
        confianca: +confAgregada.toFixed(2),
        duracao_s,
        camposEstrategia: metaResumo.camposEstrategia,
        camposConfianca: metaResumo.camposConfianca,
        ciclosUsados: [...metaResumo.ciclosUsados],
        baseAntesFimTs: antesArr[antesArr.length - 1].time,
        baseDepoisTs: depoisArr[0].time,
        nAntes: antesArr.length,
        nDepois: depoisArr.length,
        metasPorCampo: metasCampo,
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
        ciclosUsados: [...metaResumo.ciclosUsados],
        confianca: out.length ? out[out.length - 1]._meta.confianca : 0,
      },
    };
  }

  // -------------------------------------------------------------------
  //  SPLC multi-ciclo com outlier detection
  //  Busca o "mesmo horário" em cada ciclo configurado, calcula
  //  z-score contra os vizinhos no próprio ciclo, descarta outliers,
  //  e devolve média ponderada pelos pesos dos ciclos.
  // -------------------------------------------------------------------
  _buscarMultiCiclo(tAlvoMs, campo, historico, passoMs) {
    const contribuicoes = [];
    const ciclosUsados = [];

    for (const ciclo of AgenteReconstrutor.CICLOS) {
      const tBase = tAlvoMs - ciclo.segundos * 1000;
      const ponto = this._pontoMaisProximo(historico, tBase, passoMs / 2);
      if (!ponto || ponto._reconstruido || typeof ponto[campo] !== "number") continue;

      // Vizinhança pra calcular z-score (descartar outlier no histórico)
      const viz = this._vizinhanca(historico, tBase, passoMs * 6, campo);
      if (viz.length >= 4) {
        const med = _media(viz);
        const dp  = _desvioPadrao(viz, med);
        if (dp > 0) {
          const z = Math.abs((ponto[campo] - med) / dp);
          if (z > AgenteReconstrutor.Z_OUTLIER) continue;  // pico anômalo, ignora
        }
      }

      // Contexto-antes e contexto-depois (pra correção de drift)
      const vAntes  = _media(this._vizinhanca(historico, tBase - passoMs * 3, passoMs * 2, campo));
      const vDepois = _media(this._vizinhanca(historico, tBase + passoMs * 3, passoMs * 2, campo));

      contribuicoes.push({
        valor: ponto[campo],
        valorAntesContexto: vAntes ?? ponto[campo],
        valorDepoisContexto: vDepois ?? ponto[campo],
        peso: ciclo.peso,
        ciclo,
      });
      ciclosUsados.push(ciclo);
    }

    if (!contribuicoes.length) return null;

    const somaPeso = contribuicoes.reduce((s, c) => s + c.peso, 0);
    const valor = contribuicoes.reduce((s, c) => s + c.valor * c.peso, 0) / somaPeso;
    const valorAntesContexto = contribuicoes.reduce((s, c) => s + c.valorAntesContexto * c.peso, 0) / somaPeso;
    const valorDepoisContexto = contribuicoes.reduce((s, c) => s + c.valorDepoisContexto * c.peso, 0) / somaPeso;

    // Confiança: 0.9 base se conseguiu pelo menos 1 ciclo, +0.05 por ciclo extra
    const confianca = Math.min(0.95, 0.85 + (contribuicoes.length - 1) * 0.05);

    return {
      valor: +valor.toFixed(3),
      valorAntesContexto,
      valorDepoisContexto,
      ciclosUsados,
      nAmostras: contribuicoes.length,
      confianca,
    };
  }

  _pontoMaisProximo(pontos, tAlvoMs, tolMs) {
    let melhor = null, melhorDist = Infinity;
    for (const p of pontos) {
      const d = Math.abs(new Date(p.time).getTime() - tAlvoMs);
      if (d < melhorDist) { melhorDist = d; melhor = p; }
    }
    return melhorDist <= tolMs ? melhor : null;
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
