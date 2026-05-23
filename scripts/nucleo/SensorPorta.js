/**
 * Sensor de abertura de porta (sinal bruto).
 * Estima número de transições e amplitude do sinal.
 */
class SensorPorta extends Sensor {
  calcularIndicadores(pontos = []) {
    if (!pontos.length) return [];
    const valores = pontos.map(p => p.abertura_porta).filter(v => Number.isFinite(v));
    if (!valores.length) return [];

    const media = Sensor.media(valores);
    const min   = Math.min(...valores);
    const max   = Math.max(...valores);
    const limiar = (max - min) / 3;

    let transicoes = 0;
    for (let i = 1; i < valores.length; i++) {
      if (Math.abs(valores[i] - valores[i - 1]) > limiar) transicoes++;
    }

    return [
      { rotulo: "Valor médio",          valor: media.toFixed(1) },
      { rotulo: "Mínimo",               valor: min.toFixed(1) },
      { rotulo: "Máximo",               valor: max.toFixed(1) },
      { rotulo: "Amplitude",            valor: (max - min).toFixed(1) },
      { rotulo: "Transições",           valor: transicoes, sub: "mudanças bruscas" },
      { rotulo: "Aberturas estimadas",  valor: Math.floor(transicoes / 2) },
    ];
  }
}

if (typeof window !== "undefined") window.SensorPorta = SensorPorta;
