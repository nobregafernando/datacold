/**
 * AnalisadorSensor — avalia em runtime os pontos recebidos da API e
 * devolve uma lista de **verificações** com status calculado.
 *
 * Substitui a base estática AchadosSensores. Cada tipo de sensor
 * (energia / temperatura / porta) tem seu catálogo próprio de verificações.
 *
 * USO:
 *   const analise = new AnalisadorSensor(sensor, pontos).avaliar();
 *   // analise = [
 *   //   { id, categoria, label, status, resumo, detalhe, diagnostico }, ...
 *   // ]
 *
 * Cada verificação:
 *   - id:        identificador estável (pra dedupe / linkagem)
 *   - categoria: rótulo curto pra agrupar no chip ("FP", "Telemetria"...)
 *   - label:     descrição da pergunta ("O FP está dentro do limite ANEEL?")
 *   - status:    'crit' | 'warn' | 'info' | 'ok'
 *   - resumo:    texto curto pra exibir no chip
 *   - detalhe:   texto longo explicando o que os dados mostram
 *   - diagnostico (opcional): possíveis causas + recomendação
 */
class AnalisadorSensor {

  /** Faixa térmica esperada por grupo de câmara. */
  static FAIXAS_TERMICAS = {
    camara_congelados:  { min: -28, max: -18, label: "câmara de congelados" },
    camara_estoque:     { min:  -4, max:   4, label: "câmara fria de estoque" },
    graxaria:           { min: -10, max:   4, label: "câmara da graxaria" },
  };

  constructor(sensor, pontos = []) {
    this.sensor = sensor;
    this.pontos = pontos;
  }

  /** Retorna a lista completa de verificações com status calculado. */
  avaliar() {
    if (!this.sensor || !this.pontos?.length) {
      return [{
        id: "sem-dados", categoria: "Telemetria",
        label: "Há dados pra analisar?",
        status: "warn",
        resumo: "Sem dados",
        detalhe: "Sem pontos retornados pela API para a janela atual.",
        diagnostico: "Tente uma janela maior. Se persistir, sensor pode estar offline.",
      }];
    }

    const verifs = [
      ...this._verifConectividade(),
      ...this._verifTelemetria(),
    ];
    if (this.sensor.tipo === "energia")     verifs.push(...this._verifEnergia());
    if (this.sensor.tipo === "temperatura") verifs.push(...this._verifTemperatura());
    if (this.sensor.tipo === "porta")       verifs.push(...this._verifPorta());
    return verifs;
  }

  /** Catálogo descritivo: o que o sensor consegue detectar. */
  static catalogo(tipo) {
    return {
      energia: [
        { categoria: "Conectividade",   label: "Desconexão" },
        { categoria: "Telemetria",      label: "Lacunas nas leituras" },
        { categoria: "FP",              label: "Fator de potência baixo" },
        { categoria: "FP",              label: "Fluxo reverso" },
        { categoria: "Equilíbrio",      label: "Desequilíbrio de corrente" },
        { categoria: "Equilíbrio",      label: "Desequilíbrio de tensão" },
        { categoria: "Fase",            label: "Fase ausente" },
        { categoria: "Picos",           label: "Pico de corrente anormal" },
        { categoria: "Tendência",       label: "Consumo crescendo no período" },
        { categoria: "Phantom load",    label: "Consumo em horário ocioso" },
      ],
      temperatura: [
        { categoria: "Conectividade",   label: "Desconexão" },
        { categoria: "Telemetria",      label: "Lacunas nas leituras" },
        { categoria: "Faixa térmica",   label: "Temperatura fora da faixa" },
        { categoria: "Superaquecimento", label: "Acima do limite por muito tempo" },
        { categoria: "Leitura",         label: "Valor fisicamente impossível" },
        { categoria: "Oscilação",       label: "Variação alta (σ)" },
        { categoria: "Tendência",       label: "Tendência de subida/queda" },
        { categoria: "Picos",           label: "Picos isolados (z-score)" },
        { categoria: "Sensor",          label: "Sensor travado" },
      ],
      porta: [
        { categoria: "Conectividade",   label: "Desconexão" },
        { categoria: "Telemetria",      label: "Lacunas nas leituras" },
        { categoria: "Tempo aberta",    label: "Porta esquecida aberta" },
        { categoria: "Tempo aberta",    label: "Tempo médio alto" },
        { categoria: "Frequência",      label: "Aberturas anormalmente frequentes" },
        { categoria: "Sinal",           label: "Sinal não-binário" },
      ],
    }[tipo] || [];
  }

  // =================================================================
  //  Verificações comuns
  // =================================================================

  _verifConectividade() {
    const pts = this.pontos;
    const ultimo = new Date(pts[pts.length - 1].time);
    const diff = (Date.now() - ultimo.getTime()) / 1000;
    const intervalos = this._intervalos();
    const medio = intervalos.length ? intervalos.reduce((s,x)=>s+x,0) / intervalos.length : 0;

    let status = "ok", resumo = "Online", detalhe = "", diagnostico = null;
    if (medio > 0 && diff > medio * 10) {
      status = "crit"; resumo = "Offline";
      detalhe = `Última leitura há ${this._tempoLeg(diff)} (intervalo médio ~${this._tempoLeg(medio)}).`;
      diagnostico = "Sensor não envia há muito tempo. Verificar alimentação, link de rede e gateway.";
    } else if (medio > 0 && diff > medio * 3) {
      status = "warn"; resumo = "Instável";
      detalhe = `Última leitura há ${this._tempoLeg(diff)} — acima do esperado (~${this._tempoLeg(medio)}).`;
      diagnostico = "Conexão intermitente. Link de rede oscilando ou gateway com fila.";
    } else {
      detalhe = `Sensor enviando normalmente. Última leitura há ${this._tempoLeg(diff)}, intervalo médio ~${this._tempoLeg(medio)}.`;
    }

    return [{ id: "conectividade", categoria: "Conectividade", label: "Sensor está online?", status, resumo, detalhe, diagnostico }];
  }

  _verifTelemetria() {
    const intervalos = this._intervalos();
    if (!intervalos.length) return [];
    const medio = intervalos.reduce((s,x)=>s+x,0) / intervalos.length;
    const gaps = intervalos.filter(x => x > medio * 2).length;
    const maior = Math.max(...intervalos);

    let status = "ok", resumo = "Sem lacunas", detalhe = `${gaps} lacuna(s) detectada(s). Intervalo médio: ${this._tempoLeg(medio)}.`;
    let diagnostico = null;
    if (gaps > 30) {
      status = "warn"; resumo = `${gaps} lacunas`;
      diagnostico = "Lacunas frequentes. Link instável, gateway com buffer cheio ou bateria fraca.";
    } else if (gaps > 10) {
      status = "warn"; resumo = `${gaps} lacunas`;
    } else if (gaps > 0) {
      status = "info"; resumo = `${gaps} lacunas`;
    }
    if (maior > medio * 20) {
      status = "warn";
      detalhe += ` Maior gap: ${this._tempoLeg(maior)}.`;
    }
    return [{ id: "telemetria", categoria: "Telemetria", label: "A telemetria é confiável?", status, resumo, detalhe, diagnostico }];
  }

  // =================================================================
  //  Verificações de ENERGIA
  // =================================================================

  _verifEnergia() {
    const pts = this.pontos;
    const m = (arr) => arr.reduce((s,x) => s + (Number.isFinite(+x) ? +x : 0), 0) / (arr.length || 1);

    const Ia = m(pts.map(p => p.corrente_fase_a));
    const Ib = m(pts.map(p => p.corrente_fase_b));
    const Ic = m(pts.map(p => p.corrente_fase_c));
    const Va = m(pts.map(p => p.tensao_fase_a));
    const Vb = m(pts.map(p => p.tensao_fase_b));
    const Vc = m(pts.map(p => p.tensao_fase_c));
    const FPa = m(pts.map(p => p.fator_potencia_a));
    const FPb = m(pts.map(p => p.fator_potencia_b));
    const FPc = m(pts.map(p => p.fator_potencia_c));

    const FP = (FPa + FPb + FPc) / 3;
    const Imed = (Ia + Ib + Ic) / 3;
    const Vmed = (Va + Vb + Vc) / 3;
    const CUB = Imed > 0 ? Math.max(Math.abs(Ia - Imed), Math.abs(Ib - Imed), Math.abs(Ic - Imed)) / Imed * 100 : 0;
    const VUB = Vmed > 0 ? Math.max(Math.abs(Va - Vmed), Math.abs(Vb - Vmed), Math.abs(Vc - Vmed)) / Vmed * 100 : 0;

    const out = [];

    // FP / Fluxo reverso
    if (FP < 0) {
      out.push({
        id: "fp-reverso", categoria: "FP", label: "Está havendo fluxo reverso?",
        status: "crit", resumo: `FP=${FP.toFixed(2)} (reverso)`,
        detalhe: `FP composto negativo: ${FP.toFixed(3)} · fases: ${FPa.toFixed(2)} / ${FPb.toFixed(2)} / ${FPc.toFixed(2)}.`,
        diagnostico: "Fluxo reverso de potência — provável fiação dos transformadores de corrente invertida ou medidor instalado ao contrário. Solução: inverter os TCs.",
      });
    } else if (FP < 0.85) {
      out.push({
        id: "fp-critico", categoria: "FP", label: "O FP está dentro do limite ANEEL?",
        status: "crit", resumo: `FP=${FP.toFixed(2)}`,
        detalhe: `FP composto ${FP.toFixed(3)} — bem abaixo do limite ANEEL (0,92). Fases: ${FPa.toFixed(2)} / ${FPb.toFixed(2)} / ${FPc.toFixed(2)}.`,
        diagnostico: "FP muito baixo. Banco de capacitores queimado ou desligado, motor de indução sem correção. Multa garantida na fatura — instalar/restaurar banco de capacitores.",
      });
    } else if (FP < 0.92) {
      out.push({
        id: "fp-baixo", categoria: "FP", label: "O FP está dentro do limite ANEEL?",
        status: "warn", resumo: `FP=${FP.toFixed(2)}`,
        detalhe: `FP composto ${FP.toFixed(3)} — abaixo de 0,92. Fases: ${FPa.toFixed(2)} / ${FPb.toFixed(2)} / ${FPc.toFixed(2)}.`,
        diagnostico: "FP abaixo do mínimo regulatório. Verificar banco de capacitores e cargas indutivas.",
      });
    } else {
      out.push({
        id: "fp-ok", categoria: "FP", label: "O FP está dentro do limite ANEEL?",
        status: "ok", resumo: `FP=${FP.toFixed(2)}`,
        detalhe: `FP composto ${FP.toFixed(3)} — dentro do limite ANEEL (≥0,92).`,
      });
    }

    // %CUB
    if (CUB > 10) out.push({
      id: "cub", categoria: "Equilíbrio", label: "As fases estão balanceadas?",
      status: "crit", resumo: `%CUB=${CUB.toFixed(1)}%`,
      detalhe: `%CUB de corrente = ${CUB.toFixed(1)}%. Correntes médias: ${Ia.toFixed(0)} / ${Ib.toFixed(0)} / ${Ic.toFixed(0)} A.`,
      diagnostico: "Desequilíbrio severo de corrente (NEMA MG-1 crítico >10%). No motor: curto entre espiras, conexão frouxa. Na rede: cargas mal distribuídas.",
    });
    else if (CUB > 5) out.push({
      id: "cub", categoria: "Equilíbrio", label: "As fases estão balanceadas?",
      status: "warn", resumo: `%CUB=${CUB.toFixed(1)}%`,
      detalhe: `%CUB de corrente = ${CUB.toFixed(1)}%.`,
      diagnostico: "Desequilíbrio moderado (5-10%). Inspecionar conexões do motor e distribuição de cargas no quadro.",
    });
    else out.push({
      id: "cub", categoria: "Equilíbrio", label: "As fases estão balanceadas?",
      status: "ok", resumo: `%CUB=${CUB.toFixed(1)}%`,
      detalhe: `Equilibrio bom — %CUB de corrente = ${CUB.toFixed(1)}% (NEMA: <5% ideal).`,
    });

    // %VUB
    if (VUB > 2) out.push({
      id: "vub", categoria: "Equilíbrio", label: "A tensão está balanceada?",
      status: "crit", resumo: `%VUB=${VUB.toFixed(2)}%`,
      detalhe: `%VUB de tensão = ${VUB.toFixed(2)}%. Tensões: ${Va.toFixed(0)} / ${Vb.toFixed(0)} / ${Vc.toFixed(0)} V.`,
      diagnostico: "Desequilíbrio de tensão acima do limite NEMA (2%). Reduz vida útil do motor — verificar conexões no QGBT.",
    });
    else if (VUB > 1) out.push({
      id: "vub", categoria: "Equilíbrio", label: "A tensão está balanceada?",
      status: "info", resumo: `%VUB=${VUB.toFixed(2)}%`,
      detalhe: `%VUB de tensão = ${VUB.toFixed(2)}%. Acima do ideal (<1%), mas dentro do limite (<2%).`,
    });
    else out.push({
      id: "vub", categoria: "Equilíbrio", label: "A tensão está balanceada?",
      status: "ok", resumo: `%VUB=${VUB.toFixed(2)}%`,
      detalhe: `Tensão equilibrada — %VUB = ${VUB.toFixed(2)}%.`,
    });

    // Fase ausente
    const fasesZeradas = [["A", Va], ["B", Vb], ["C", Vc]].filter(([_,v]) => v < 10);
    if (fasesZeradas.length) out.push({
      id: "fase-ausente", categoria: "Fase", label: "Alguma fase está ausente?",
      status: "crit", resumo: `Fase ${fasesZeradas.map(f => f[0]).join("/")} sem tensão`,
      detalhe: `Tensão média próxima de zero na(s) fase(s) ${fasesZeradas.map(f => f[0]).join(", ")}.`,
      diagnostico: "Fase ausente — fusível queimado, disjuntor desarmado, condutor rompido ou defeito no medidor. Motor pode queimar.",
    });
    else out.push({
      id: "fase-ausente", categoria: "Fase", label: "Alguma fase está ausente?",
      status: "ok", resumo: "Todas presentes",
      detalhe: "Todas as três fases com tensão normal.",
    });

    // Pico de corrente
    const todasCorrentes = pts.flatMap(p => [p.corrente_fase_a, p.corrente_fase_b, p.corrente_fase_c]).filter(Number.isFinite);
    if (todasCorrentes.length) {
      const pico = Math.max(...todasCorrentes);
      const medCorr = m(todasCorrentes);
      const razao = medCorr > 0 ? pico / medCorr : 0;
      if (razao > 5) out.push({
        id: "pico-corrente", categoria: "Picos", label: "Há picos de corrente acima do esperado?",
        status: "warn", resumo: `${razao.toFixed(1)}× a média`,
        detalhe: `Pico de ${pico.toFixed(0)} A vs média de ${medCorr.toFixed(0)} A (${razao.toFixed(1)}×).`,
        diagnostico: "Picos altos podem indicar rolamento desgastado, contator com arco ou partida em travamento.",
      });
      else out.push({
        id: "pico-corrente", categoria: "Picos", label: "Há picos de corrente acima do esperado?",
        status: "ok", resumo: `${razao.toFixed(1)}× a média`,
        detalhe: `Pico máximo ${pico.toFixed(0)} A (${razao.toFixed(1)}× a média ${medCorr.toFixed(0)} A) — dentro do esperado.`,
      });
    }

    // Tendência (1ª metade x 2ª)
    const meio = Math.floor(pts.length / 2);
    const pot = pts.map(p =>
      ((p.tensao_fase_a||0)*(p.corrente_fase_a||0)*(p.fator_potencia_a||0) +
       (p.tensao_fase_b||0)*(p.corrente_fase_b||0)*(p.fator_potencia_b||0) +
       (p.tensao_fase_c||0)*(p.corrente_fase_c||0)*(p.fator_potencia_c||0)) / 1000
    );
    const p1 = m(pot.slice(0, meio)), p2 = m(pot.slice(meio));
    const variacao = p1 !== 0 ? (p2 - p1) / Math.abs(p1) * 100 : 0;
    if (Math.abs(variacao) > 20) out.push({
      id: "tendencia", categoria: "Tendência", label: "O consumo está crescendo dentro do período?",
      status: "warn", resumo: `${variacao > 0 ? "+" : ""}${variacao.toFixed(0)}%`,
      detalhe: `Primeira metade: ${p1.toFixed(2)} kW · segunda: ${p2.toFixed(2)} kW (variação ${variacao > 0 ? "+" : ""}${variacao.toFixed(1)}%).`,
      diagnostico: "Mudança grande no consumo entre as duas metades. Pode ser carga nova, falha incipiente ou alteração operacional — investigar contexto.",
    });
    else out.push({
      id: "tendencia", categoria: "Tendência", label: "O consumo está crescendo dentro do período?",
      status: "ok", resumo: `${variacao > 0 ? "+" : ""}${variacao.toFixed(0)}%`,
      detalhe: `Consumo estável entre as duas metades do período (variação ${variacao.toFixed(1)}%).`,
    });

    return out;
  }

  // =================================================================
  //  Verificações de TEMPERATURA
  // =================================================================

  _verifTemperatura() {
    const valores = this.pontos.map(p => p.temperatura).filter(Number.isFinite);
    if (!valores.length) return [];

    const media = valores.reduce((s,x)=>s+x,0) / valores.length;
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    const sigma = Math.sqrt(valores.reduce((s,v) => s + (v - media) ** 2, 0) / valores.length);

    const out = [];

    // Faixa térmica
    const faixa = AnalisadorSensor.FAIXAS_TERMICAS[this.sensor.grupo];
    if (faixa) {
      const foraFaixa = valores.filter(v => v < faixa.min || v > faixa.max).length;
      const pct = foraFaixa / valores.length * 100;
      if (pct > 50) out.push({
        id: "faixa", categoria: "Faixa térmica", label: "A temperatura está na faixa segura?",
        status: "crit", resumo: `${pct.toFixed(0)}% fora`,
        detalhe: `${pct.toFixed(0)}% das ${valores.length} leituras fora de ${faixa.min}°C a ${faixa.max}°C. Média: ${media.toFixed(1)}°C.`,
        diagnostico: `${faixa.label} fora da faixa segura na maior parte do tempo. Falha grave — vazamento de gás, compressor com defeito, válvula travada ou setpoint errado. Risco direto ao produto.`,
      });
      else if (pct > 10) out.push({
        id: "faixa", categoria: "Faixa térmica", label: "A temperatura está na faixa segura?",
        status: "warn", resumo: `${pct.toFixed(0)}% fora`,
        detalhe: `${pct.toFixed(0)}% das leituras fora de ${faixa.min}°C a ${faixa.max}°C. Média: ${media.toFixed(1)}°C.`,
        diagnostico: "Períodos fora da faixa. Pode ser porta aberta, defrost ou falha incipiente de refrigeração.",
      });
      else out.push({
        id: "faixa", categoria: "Faixa térmica", label: "A temperatura está na faixa segura?",
        status: "ok", resumo: `${(100-pct).toFixed(0)}% na faixa`,
        detalhe: `${(100-pct).toFixed(0)}% das leituras dentro de ${faixa.min}°C a ${faixa.max}°C. Média: ${media.toFixed(1)}°C.`,
      });

      // Superaquecimento contínuo
      const acima = valores.filter(v => v > faixa.max).length;
      const pctAcima = acima / valores.length * 100;
      if (pctAcima > 20) out.push({
        id: "superaquecimento", categoria: "Superaquecimento", label: "Está superaquecendo?",
        status: "crit", resumo: `${pctAcima.toFixed(0)}% acima`,
        detalhe: `${pctAcima.toFixed(0)}% do tempo acima do limite superior (${faixa.max}°C). Pico: ${max.toFixed(1)}°C.`,
        diagnostico: "Superaquecimento contínuo. Refrigeração não está dando conta — vazamento de gás, condensador sujo ou compressor em falha.",
      });
      else if (pctAcima > 5) out.push({
        id: "superaquecimento", categoria: "Superaquecimento", label: "Está superaquecendo?",
        status: "warn", resumo: `${pctAcima.toFixed(0)}% acima`,
        detalhe: `${pctAcima.toFixed(0)}% do tempo acima do limite (${faixa.max}°C).`,
      });
      else out.push({
        id: "superaquecimento", categoria: "Superaquecimento", label: "Está superaquecendo?",
        status: "ok", resumo: "Sem superaquecimento",
        detalhe: `Apenas ${pctAcima.toFixed(1)}% do tempo acima do limite superior.`,
      });
    }

    // Leitura impossível
    let leituraStatus = "ok", lResumo = "Plausível", lDetalhe = `Mín ${min.toFixed(1)}°C · máx ${max.toFixed(1)}°C — dentro do envelope físico.`, lDiag = null;
    if (max > 50 && faixa) { // faixa fria
      leituraStatus = "crit"; lResumo = `${max.toFixed(0)}°C impossível`;
      lDetalhe = `Máxima ${max.toFixed(1)}°C — fora do envelope físico para câmara fria.`;
      lDiag = "Sensor com defeito intermitente, cabo solto ou interferência elétrica. Trocar ou recalibrar.";
    } else if (min < -100) {
      leituraStatus = "crit"; lResumo = `${min.toFixed(0)}°C impossível`;
      lDetalhe = `Mínima ${min.toFixed(1)}°C — fisicamente impossível.`;
      lDiag = "Leitura corrompida. Sensor com defeito.";
    }
    out.push({ id: "leitura-impossivel", categoria: "Leitura", label: "Os valores são plausíveis?", status: leituraStatus, resumo: lResumo, detalhe: lDetalhe, diagnostico: lDiag });

    // Oscilação
    if (sigma > 10) out.push({
      id: "oscilacao", categoria: "Oscilação", label: "A temperatura está estável?",
      status: "crit", resumo: `σ=${sigma.toFixed(1)}°C`,
      detalhe: `Desvio padrão muito alto: ${sigma.toFixed(2)}°C. Amplitude: ${(max-min).toFixed(1)}°C.`,
      diagnostico: "Oscilação severa. Setpoint errado, short-cycling do compressor ou interferência no sensor.",
    });
    else if (sigma > 5) out.push({
      id: "oscilacao", categoria: "Oscilação", label: "A temperatura está estável?",
      status: "warn", resumo: `σ=${sigma.toFixed(1)}°C`,
      detalhe: `Desvio padrão: ${sigma.toFixed(2)}°C — acima do esperado.`,
      diagnostico: "Câmara não está em equilíbrio. Verificar setpoint e estado da refrigeração.",
    });
    else out.push({
      id: "oscilacao", categoria: "Oscilação", label: "A temperatura está estável?",
      status: "ok", resumo: `σ=${sigma.toFixed(1)}°C`,
      detalhe: `Estável — σ ${sigma.toFixed(2)}°C, amplitude ${(max-min).toFixed(1)}°C.`,
    });

    // Sensor travado
    if (sigma < 0.05 && valores.length > 30) out.push({
      id: "travado", categoria: "Sensor", label: "O sensor está vivo?",
      status: "warn", resumo: "Suspeita travado",
      detalhe: `Sigma quase zero (${sigma.toFixed(3)}°C). Sensor não varia — pode estar travado.`,
      diagnostico: "Sensor travado pode estar com cabo rompido ou eletrônica congelada.",
    });

    return out;
  }

  // =================================================================
  //  Verificações de PORTA
  // =================================================================

  _verifPorta() {
    const valores = this.pontos.map(p => p.abertura_porta).filter(Number.isFinite);
    if (!valores.length) return [];

    const min = Math.min(...valores);
    const max = Math.max(...valores);
    const limiar = (max - min) / 3 || 0.5;

    // Detectar eventos de abertura (transições acima do limiar) — simplificado
    let aberta = 0, totalAberta = 0, maxAberta = 0, num = 0;
    for (let i = 0; i < this.pontos.length; i++) {
      const aberto = valores[i] > (min + limiar);
      if (aberto) {
        if (aberta === 0 && i > 0) num++;
        const dt = i > 0 ? (new Date(this.pontos[i].time) - new Date(this.pontos[i-1].time)) / 1000 : 0;
        aberta += dt;
        totalAberta += dt;
        if (aberta > maxAberta) maxAberta = aberta;
      } else {
        aberta = 0;
      }
    }

    const totalSeg = (new Date(this.pontos.at(-1).time) - new Date(this.pontos[0].time)) / 1000;
    const pctAberta = totalSeg > 0 ? totalAberta / totalSeg * 100 : 0;
    const medioAberta = num > 0 ? totalAberta / num : 0;

    const out = [];

    // Porta esquecida
    if (maxAberta > 600) out.push({
      id: "esquecida", categoria: "Tempo aberta", label: "Houve porta esquecida aberta?",
      status: "crit", resumo: `${this._tempoLeg(maxAberta)} no maior evento`,
      detalhe: `Maior evento: ${this._tempoLeg(maxAberta)}. Acima de 10 min = porta esquecida.`,
      diagnostico: "Esquecimento operacional ou falha do sensor de fechamento. Toda a câmara perdeu frio nesse evento.",
    });
    else out.push({
      id: "esquecida", categoria: "Tempo aberta", label: "Houve porta esquecida aberta?",
      status: "ok", resumo: `máx ${this._tempoLeg(maxAberta)}`,
      detalhe: `Maior evento de abertura: ${this._tempoLeg(maxAberta)} — dentro do esperado.`,
    });

    // Tempo médio
    if (medioAberta > 120) out.push({
      id: "tempo-medio", categoria: "Tempo aberta", label: "Quanto tempo a porta fica aberta em média?",
      status: "warn", resumo: `média ${this._tempoLeg(medioAberta)}`,
      detalhe: `Tempo médio aberta: ${this._tempoLeg(medioAberta)}. Ideal: <60s por evento.`,
      diagnostico: "Operação demorada ou vedação travando a porta semi-aberta. Cada minuto = perda de frio em R$.",
    });
    else if (num > 0) out.push({
      id: "tempo-medio", categoria: "Tempo aberta", label: "Quanto tempo a porta fica aberta em média?",
      status: "ok", resumo: `média ${this._tempoLeg(medioAberta)}`,
      detalhe: `Tempo médio: ${this._tempoLeg(medioAberta)} — adequado.`,
    });

    // % tempo aberta
    if (pctAberta > 5) out.push({
      id: "pct-aberta", categoria: "Tempo aberta", label: "Qual fração do tempo a porta passou aberta?",
      status: "warn", resumo: `${pctAberta.toFixed(0)}% do tempo`,
      detalhe: `Porta ficou aberta ${pctAberta.toFixed(1)}% do período analisado.`,
      diagnostico: "Acima de 5% indica vedação ruim, sensor falhando ou operação intensa. Cada % é kWh extra na fatura.",
    });
    else out.push({
      id: "pct-aberta", categoria: "Tempo aberta", label: "Qual fração do tempo a porta passou aberta?",
      status: "ok", resumo: `${pctAberta.toFixed(1)}% do tempo`,
      detalhe: `Porta ficou aberta apenas ${pctAberta.toFixed(2)}% do período — ok.`,
    });

    // Frequência
    const aberturas_h = totalSeg > 0 ? num / (totalSeg / 3600) : 0;
    if (aberturas_h > 10) out.push({
      id: "freq", categoria: "Frequência", label: "Aberturas anormalmente frequentes?",
      status: "warn", resumo: `${aberturas_h.toFixed(1)}/h`,
      detalhe: `${num} aberturas em ${(totalSeg/3600).toFixed(0)}h (${aberturas_h.toFixed(1)} aberturas/hora).`,
      diagnostico: "Uso muito intenso. Pode ser legítimo ou sensor disparando ruído.",
    });
    else if (num > 0) out.push({
      id: "freq", categoria: "Frequência", label: "Frequência de aberturas",
      status: "ok", resumo: `${aberturas_h.toFixed(2)}/h`,
      detalhe: `${num} aberturas em ${(totalSeg/3600).toFixed(0)}h — frequência normal.`,
    });

    // Sinal coerente
    const unicos = new Set(valores).size;
    if (unicos > 3) out.push({
      id: "sinal", categoria: "Sinal", label: "O sinal é coerente (binário)?",
      status: "info", resumo: `${unicos} valores`,
      detalhe: `Sinal tem ${unicos} valores únicos — pode ser analógico ou intermediário.`,
    });
    else out.push({
      id: "sinal", categoria: "Sinal", label: "O sinal é coerente (binário)?",
      status: "ok", resumo: "Binário",
      detalhe: `Sinal com ${unicos} valor(es) — coerente com porta binária.`,
    });

    return out;
  }

  // =================================================================
  //  Helpers
  // =================================================================

  _intervalos() {
    const out = [];
    for (let i = 1; i < this.pontos.length; i++) {
      out.push((new Date(this.pontos[i].time) - new Date(this.pontos[i-1].time)) / 1000);
    }
    return out;
  }

  _tempoLeg(seg) {
    if (!isFinite(seg) || seg < 0) return "—";
    if (seg < 90)   return `${Math.round(seg)}s`;
    if (seg < 5400) return `${Math.round(seg / 60)} min`;
    if (seg < 36*3600) return `${(seg / 3600).toFixed(1)}h`;
    return `${(seg / 86400).toFixed(1)} dias`;
  }
}

if (typeof window !== "undefined") window.AnalisadorSensor = AnalisadorSensor;
