/**
 * Sensor trifásico de energia.
 * Calcula potência, energia estimada, fator de potência composto,
 * desequilíbrio de corrente (%CUB) e tensão (%VUB).
 */
class SensorEnergia extends Sensor {
  static LIMITE_FP_ANEEL = 0.92;
  static LIMITE_CUB_NEMA = 10;   // %
  static LIMITE_VUB_NEMA = 2;    // %

  calcularIndicadores(pontos = []) {
    if (!pontos.length) return [];
    const m = Sensor.media;

    const Ia = m(pontos.map(p => p.corrente_fase_a));
    const Ib = m(pontos.map(p => p.corrente_fase_b));
    const Ic = m(pontos.map(p => p.corrente_fase_c));
    const Va = m(pontos.map(p => p.tensao_fase_a));
    const Vb = m(pontos.map(p => p.tensao_fase_b));
    const Vc = m(pontos.map(p => p.tensao_fase_c));
    const FPa = m(pontos.map(p => p.fator_potencia_a));
    const FPb = m(pontos.map(p => p.fator_potencia_b));
    const FPc = m(pontos.map(p => p.fator_potencia_c));

    const potenciaInstantanea = pontos.map(p =>
      (p.tensao_fase_a || 0) * (p.corrente_fase_a || 0) * (p.fator_potencia_a || 0) +
      (p.tensao_fase_b || 0) * (p.corrente_fase_b || 0) * (p.fator_potencia_b || 0) +
      (p.tensao_fase_c || 0) * (p.corrente_fase_c || 0) * (p.fator_potencia_c || 0)
    );
    const potenciaMedia_kW = m(potenciaInstantanea) / 1000;

    let kWh = 0;
    for (let i = 1; i < pontos.length; i++) {
      const dt = (new Date(pontos[i].time) - new Date(pontos[i - 1].time)) / 1000;
      kWh += ((potenciaInstantanea[i] + potenciaInstantanea[i - 1]) / 2) * dt;
    }
    kWh = kWh / 3600 / 1000;

    const Imed = (Ia + Ib + Ic) / 3;
    const Vmed = (Va + Vb + Vc) / 3;
    const CUB = Imed > 0 ? Math.max(Math.abs(Ia - Imed), Math.abs(Ib - Imed), Math.abs(Ic - Imed)) / Imed * 100 : 0;
    const VUB = Vmed > 0 ? Math.max(Math.abs(Va - Vmed), Math.abs(Vb - Vmed), Math.abs(Vc - Vmed)) / Vmed * 100 : 0;
    const FPcomposto = (FPa + FPb + FPc) / 3;

    return [
      { rotulo: "Potência média",  valor: `${potenciaMedia_kW.toFixed(2)} kW` },
      { rotulo: "Energia",         valor: `${kWh.toFixed(2)} kWh`, sub: "no intervalo" },
      { rotulo: "FP composto",     valor: FPcomposto.toFixed(3),
        sub: FPcomposto < SensorEnergia.LIMITE_FP_ANEEL ? "abaixo do limite ANEEL" : "dentro do limite",
        severidade: FPcomposto < 0.85 ? "erro" : FPcomposto < SensorEnergia.LIMITE_FP_ANEEL ? "alerta" : "ok" },
      { rotulo: "%CUB corrente",   valor: `${CUB.toFixed(1)}%`,
        sub: "NEMA: alerta >10%",
        severidade: CUB > SensorEnergia.LIMITE_CUB_NEMA ? "erro" : CUB > 5 ? "alerta" : "ok" },
      { rotulo: "%VUB tensão",     valor: `${VUB.toFixed(2)}%`,
        sub: "NEMA: máx 2%",
        severidade: VUB > SensorEnergia.LIMITE_VUB_NEMA ? "erro" : VUB > 1 ? "alerta" : "ok" },
      { rotulo: "Pontos",          valor: pontos.length },
    ];
  }
}

if (typeof window !== "undefined") window.SensorEnergia = SensorEnergia;
