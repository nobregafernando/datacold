/**
 * Classe base para todos os sensores.
 * Subclasses (SensorEnergia, SensorTemperatura, SensorPorta) implementam
 * o cálculo de indicadores e a renderização específica.
 */
class Sensor {
  constructor({ id, label, type, group, status, fields = [] } = {}) {
    this.id = id;
    this.rotulo = label;
    this.tipo = type;
    this.grupo = group;
    this.status = status;
    this.campos = fields;
  }

  get ativo()      { return this.status === "ativo"; }
  get historico()  { return this.status === "historico"; }

  /** Cor temática do sensor (referência à paleta). */
  get cor() {
    return {
      energia:     "var(--azul-medio)",
      temperatura: "var(--ciano)",
      porta:       "var(--azul-claro)",
    }[this.tipo] ?? "var(--azul-profundo)";
  }

  /**
   * Devolve uma lista de indicadores calculados a partir dos pontos brutos.
   * Cada item: { rotulo, valor, sub?, severidade? }
   * Subclasse deve sobrescrever.
   */
  calcularIndicadores(/* pontos */) {
    return [];
  }

  /** Útil pra logs / debug. */
  toString() {
    return `[${this.tipo}] ${this.rotulo} (${this.id})`;
  }

  /** Helper: média numérica ignorando undefined. */
  static media(arr) {
    if (!arr.length) return 0;
    return arr.reduce((s, x) => s + (Number.isFinite(+x) ? +x : 0), 0) / arr.length;
  }
}

if (typeof window !== "undefined") window.Sensor = Sensor;
