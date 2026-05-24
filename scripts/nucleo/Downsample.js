/**
 * Downsample · reduz pontos para visualização sem perder o "shape".
 *
 * PROBLEMA QUE RESOLVE
 *   Em janelas longas (24h, 7d), os gráficos ficam visualmente poluídos:
 *   centenas de oscilações se sobrepõem e o olho não consegue extrair
 *   a tendência. Em janelas curtas (5/15/30 min) cada amostra importa.
 *
 * ALGORITMO: LTTB (Largest Triangle Three Buckets)
 *   Sveinn Steinarsson, 2013. Padrão de Grafana, Plotly, etc.
 *   Mantém o PRIMEIRO e o ÚLTIMO ponto sempre. Divide os pontos
 *   intermediários em N buckets de tamanho igual. Em cada bucket,
 *   escolhe o ponto que MAXIMIZA a área do triângulo formado com:
 *     - o ponto selecionado no bucket anterior
 *     - o centroide (média) do próximo bucket
 *   Como picos/vales formam triângulos maiores, eles são preservados
 *   naturalmente. Pontos quase colineares (ruído) são descartados.
 *   Complexidade: O(n).
 *
 * MULTI-SÉRIE COORDENADA
 *   Quando o gráfico tem várias séries (corrente fase A/B/C), rodamos
 *   LTTB UMA VEZ usando uma "métrica representativa" do tipo do sensor
 *   e aplicamos OS MESMOS ÍNDICES em todas as séries. Assim o eixo X
 *   fica alinhado entre as linhas.
 *
 * USO
 *   // Pontos no formato {time, ...campos numéricos}
 *   Downsample.aplicarPorJanela(pontos, "energia", "-24h");
 *   // Pares no formato {x, y}
 *   Downsample.aplicarXY(pares, 300);
 */
class Downsample {

  /**
   * Quantidade-alvo de pontos por janela. Mantém detalhe nas janelas
   * curtas (onde cada amostra importa) e comprime forte nas longas
   * (onde o usuário quer ver a forma da curva, não o ruído).
   *
   * Os valores foram escolhidos pensando na resolução típica de tela:
   * um gráfico de 800px renderiza com clareza ~300-500 pontos. Mais
   * que isso vira pixel pintado em cima de pixel.
   */
  static ALVO_POR_JANELA = {
    "-5m":   5000,   // raw — 5 min * 1pt/min = ~5 pontos só
    "-15m":  5000,   // raw
    "-30m":  5000,   // raw
    "-1h":   600,    // praticamente raw (60 pts naturais)
    "-6h":   400,    // leve compressão
    "-24h":  300,    // 1 ponto a cada ~5 min
    "-72h":  300,    // 1 ponto a cada ~15 min
    "-167h": 300,    // 1 ponto a cada ~35 min
    "-15d":  350,    // 1 ponto a cada ~60 min
    "-30d":  400,    // 1 ponto a cada ~108 min
  };
  static ALVO_PADRAO = 400;

  /** Métrica representativa por tipo. É a "voz" que decide os índices. */
  static METRICA = {
    energia:     (p) => (p.corrente_fase_a || 0) + (p.corrente_fase_b || 0) + (p.corrente_fase_c || 0),
    temperatura: (p) => p.temperatura,
    porta:       (p) => p.abertura_porta,
  };

  /** Quantos pontos manter para a janela dada. */
  static alvoPorJanela(janela) {
    return Downsample.ALVO_POR_JANELA[janela] ?? Downsample.ALVO_PADRAO;
  }

  /**
   * Aplica downsample em pontos do tipo {time, ...campos}.
   * Retorna um subconjunto dos pontos ORIGINAIS (sem agregação) que
   * preserva o formato visual do gráfico para o tipo informado.
   *
   * @param {Array<Object>} pontos
   * @param {string} tipo — "energia" | "temperatura" | "porta"
   * @param {string} janela — "-5m" | "-1h" | ... (chave de ALVO_POR_JANELA)
   * @returns {Array<Object>} pontos reduzidos
   */
  static aplicarPorJanela(pontos, tipo, janela) {
    if (!Array.isArray(pontos) || pontos.length < 4) return pontos;
    const alvo = Downsample.alvoPorJanela(janela);
    if (pontos.length <= alvo) return pontos;

    const getY = Downsample.METRICA[tipo] || (() => 0);
    const getX = (p) => +new Date(p.time);

    const indices = Downsample._lttbIndices(pontos, getX, getY, alvo);
    return indices.map(i => pontos[i]);
  }

  /**
   * Aplica downsample em pares {x, y} (formato usado pelos gráficos
   * de grupo). Retorna um subconjunto dos pares originais.
   */
  static aplicarXY(pares, alvoN) {
    if (!Array.isArray(pares) || pares.length < 4) return pares;
    if (pares.length <= alvoN) return pares;
    const getX = (p) => +p.x;
    const getY = (p) => p.y;
    const indices = Downsample._lttbIndices(pares, getX, getY, alvoN);
    return indices.map(i => pares[i]);
  }

  /**
   * Implementação canônica do LTTB. Retorna ÍNDICES dos pontos
   * escolhidos. Trabalhar com índices facilita aplicar o mesmo recorte
   * em séries paralelas e preservar metadados (_reconstruido, _vazio).
   */
  static _lttbIndices(pontos, getX, getY, alvoN) {
    const n = pontos.length;
    if (alvoN >= n || alvoN <= 2) return pontos.map((_, i) => i);

    const indices = [0];                       // sempre mantém o primeiro
    const tamBalde = (n - 2) / (alvoN - 2);    // tamanho médio do bucket
    let aIdx = 0;

    for (let i = 0; i < alvoN - 2; i++) {
      // 1) Centroide do PRÓXIMO bucket — é o ponto C do triângulo.
      const cIni = Math.floor((i + 1) * tamBalde) + 1;
      const cFim = Math.min(Math.floor((i + 2) * tamBalde) + 1, n);
      let cX = 0, cY = 0, cN = 0;
      for (let j = cIni; j < cFim; j++) {
        const y = getY(pontos[j]);
        if (!Number.isFinite(y)) continue;
        cX += getX(pontos[j]);
        cY += y;
        cN++;
      }
      if (cN === 0) {
        // Próximo bucket sem dados válidos — empurra o primeiro do bucket atual
        const fallback = Math.floor(i * tamBalde) + 1;
        indices.push(Math.min(fallback, n - 2));
        aIdx = indices[indices.length - 1];
        continue;
      }
      cX /= cN;
      cY /= cN;

      // 2) Varre o bucket ATUAL e escolhe o ponto que maximiza a área
      //    do triângulo (a, j, c). Esse é o "mais informativo".
      const aX = getX(pontos[aIdx]);
      const aY = Number.isFinite(getY(pontos[aIdx])) ? getY(pontos[aIdx]) : 0;
      const bIni = Math.floor(i * tamBalde) + 1;
      const bFim = Math.floor((i + 1) * tamBalde) + 1;

      let melhorArea = -1;
      let melhorIdx = bIni;
      for (let j = bIni; j < bFim; j++) {
        const y = getY(pontos[j]);
        if (!Number.isFinite(y)) continue;
        const area = Math.abs(
          (aX - cX) * (y - aY) - (aX - getX(pontos[j])) * (cY - aY)
        ) * 0.5;
        if (area > melhorArea) {
          melhorArea = area;
          melhorIdx = j;
        }
      }
      indices.push(melhorIdx);
      aIdx = melhorIdx;
    }

    indices.push(n - 1);                       // sempre mantém o último
    return indices;
  }
}

if (typeof window !== "undefined") window.Downsample = Downsample;
