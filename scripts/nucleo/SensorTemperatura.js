/**
 * Sensor de temperatura.
 * Calcula média, mínimo, máximo, amplitude e desvio padrão.
 */
class SensorTemperatura extends Sensor {
  calcularIndicadores(pontos = []) {
    if (!pontos.length) return [];
    const valores = pontos.map(p => p.temperatura).filter(v => Number.isFinite(v));
    if (!valores.length) return [];

    const media = Sensor.media(valores);
    const min   = Math.min(...valores);
    const max   = Math.max(...valores);
    const desvio = Math.sqrt(Sensor.media(valores.map(v => (v - media) ** 2)));

    return [
      { rotulo: "Temperatura média", valor: `${media.toFixed(2)} °C` },
      { rotulo: "Mínima",            valor: `${min.toFixed(2)} °C` },
      { rotulo: "Máxima",            valor: `${max.toFixed(2)} °C` },
      { rotulo: "Amplitude",         valor: `${(max - min).toFixed(2)} °C`, sub: "máx − mín" },
      { rotulo: "Desvio padrão",     valor: `${desvio.toFixed(2)} °C`, sub: "estabilidade" },
      { rotulo: "Pontos",            valor: pontos.length },
    ];
  }
}

if (typeof window !== "undefined") window.SensorTemperatura = SensorTemperatura;
