/**
 * Verificações comuns aos 3 tipos de sensor: conectividade e telemetria.
 * Não dependem do tipo — apenas dos timestamps dos pontos.
 *
 * Funções exportadas: avaliarConectividade(ctx) e avaliarTelemetria(ctx).
 * Devolvem o mesmo formato de veredito que uma Regra.
 */
(function () {

  function tempoLeg(seg) {
    if (!isFinite(seg) || seg < 0) return "—";
    if (seg < 90)        return `${Math.round(seg)}s`;
    if (seg < 5400)      return `${Math.round(seg / 60)} min`;
    if (seg < 36 * 3600) return `${(seg / 3600).toFixed(1)}h`;
    return `${(seg / 86400).toFixed(1)} dias`;
  }

  function intervalosEntreLeituras(pontos) {
    const ints = [];
    for (let i = 1; i < pontos.length; i++) {
      const a = new Date(pontos[i - 1].time).getTime();
      const b = new Date(pontos[i].time).getTime();
      const d = (b - a) / 1000;
      if (isFinite(d) && d > 0) ints.push(d);
    }
    return ints;
  }

  /**
   * Avalia a conectividade do sensor com base no tempo desde a última
   * leitura comparado com o intervalo médio entre leituras.
   *   - offline:  tempo > offline_mult × intervalo médio
   *   - instável: tempo > instavel_mult × intervalo médio
   *   - online:   caso contrário
   */
  function avaliarConectividade(pontos, parametros = {}) {
    const offlineMult  = parametros.offline_multiplicador
      ?? NORMAS.TELEMETRIA.offline_multiplicador.valor;
    const instavelMult = parametros.instavel_multiplicador
      ?? NORMAS.TELEMETRIA.instavel_multiplicador.valor;

    const ultimo = new Date(pontos[pontos.length - 1].time);
    const diff = (Date.now() - ultimo.getTime()) / 1000;
    const ints = intervalosEntreLeituras(pontos);
    const medio = ints.length ? ints.reduce((s, x) => s + x, 0) / ints.length : 0;

    let status = "ok", resumo = "Online", detalhe = "", diagnostico = null;
    if (medio > 0 && diff > medio * offlineMult) {
      status = "crit"; resumo = "Offline";
      detalhe = `Última leitura há ${tempoLeg(diff)} (intervalo médio ~${tempoLeg(medio)}).`;
      diagnostico = "Sensor não envia há muito tempo. Verificar alimentação, link de rede e gateway.";
    } else if (medio > 0 && diff > medio * instavelMult) {
      status = "warn"; resumo = "Instável";
      detalhe = `Última leitura há ${tempoLeg(diff)} — acima do esperado (~${tempoLeg(medio)}).`;
      diagnostico = "Conexão intermitente. Link de rede oscilando ou gateway com fila.";
    } else {
      detalhe = `Sensor enviando normalmente. Última leitura há ${tempoLeg(diff)}, intervalo médio ~${tempoLeg(medio)}.`;
    }

    return {
      id: "conectividade",
      categoria: "Conectividade",
      label: "Sensor está online?",
      fonte: NORMAS.TELEMETRIA.offline_multiplicador.fonte,
      status, resumo, detalhe, diagnostico,
      valorMedido: `${tempoLeg(diff)} desde última`,
      valorIdeal:  `≤ ${tempoLeg(medio * instavelMult)}`,
    };
  }

  /**
   * Avalia se a telemetria é confiável: conta gaps (intervalos muito
   * maiores que o médio) e o maior gap.
   */
  function avaliarTelemetria(pontos, parametros = {}) {
    const gapMult     = parametros.gap_multiplicador     ?? NORMAS.TELEMETRIA.gap_multiplicador.valor;
    const lacunasWarn = parametros.lacunas_warn          ?? NORMAS.TELEMETRIA.lacunas_warn.valor;
    const lacunasCrit = parametros.lacunas_crit          ?? NORMAS.TELEMETRIA.lacunas_crit.valor;

    const ints = intervalosEntreLeituras(pontos);
    if (!ints.length) return null;
    const medio = ints.reduce((s, x) => s + x, 0) / ints.length;
    const gaps  = ints.filter(x => x > medio * gapMult).length;
    const maior = Math.max(...ints);

    let status = "ok", resumo = "Sem lacunas";
    let detalhe = `${gaps} lacuna(s) detectada(s). Intervalo médio: ${tempoLeg(medio)}.`;
    let diagnostico = null;

    if (gaps >= lacunasCrit) {
      status = "crit"; resumo = `${gaps} lacunas`;
      diagnostico = "Telemetria muito instável. Link com perda alta ou gateway com fila persistente.";
    } else if (gaps >= lacunasWarn) {
      status = "warn"; resumo = `${gaps} lacunas`;
      diagnostico = "Lacunas frequentes. Link instável, gateway com buffer cheio ou bateria fraca.";
    } else if (gaps > 0) {
      status = "info"; resumo = `${gaps} lacunas`;
    }
    if (maior > medio * 20) {
      if (status === "ok") status = "warn";
      detalhe += ` Maior gap: ${tempoLeg(maior)}.`;
    }
    return {
      id: "telemetria",
      categoria: "Telemetria",
      label: "A telemetria é confiável?",
      fonte: NORMAS.TELEMETRIA.gap_multiplicador.fonte,
      status, resumo, detalhe, diagnostico,
      valorMedido: `${gaps} gaps`,
      valorIdeal:  `< ${lacunasWarn} gaps`,
    };
  }

  if (typeof window !== "undefined") {
    window.VerificacoesComuns = {
      avaliarConectividade,
      avaliarTelemetria,
      intervalosEntreLeituras,
      tempoLeg,
    };
  }
})();
