/**
 * Regra de avaliação isolada. Cada regra é um objeto autocontido com
 * `id`, descrição, categoria, fonte técnica e uma função `avaliar(ctx)`
 * que devolve um veredito.
 *
 * USO:
 *   const r = new Regra({
 *     id: "fp-baixo",
 *     categoria: "FP",
 *     label: "O FP está dentro do limite ANEEL?",
 *     fonte: NORMAS.ANEEL.fp_minimo.fonte,
 *     parametros: { limite_atencao: 0.92, limite_critico: 0.85 },
 *     avaliar(ctx, p) {
 *       const fp = ctx.fp_composto;
 *       if (fp < p.limite_critico) return { status: "crit", ... };
 *       ...
 *     }
 *   });
 *
 * Os `parametros` ficam acessíveis em `r.parametros` e podem ser
 * sobrescritos por sensor (via `sensor.parametros` da tabela `sensores`).
 *
 * O veredito completo retornado em runtime sempre tem:
 *   id, categoria, label, status ('ok'|'info'|'warn'|'crit'),
 *   resumo (curto), detalhe (longo), diagnostico (opcional),
 *   fonte, valorMedido (opcional), valorIdeal (opcional)
 */
class Regra {
  constructor({ id, categoria, label, fonte, parametros = {}, avaliar }) {
    if (!id || !avaliar) {
      throw new Error("Regra: 'id' e 'avaliar' são obrigatórios.");
    }
    this.id = id;
    this.categoria = categoria || "Geral";
    this.label = label || id;
    this.fonte = fonte || null;
    this.parametros = parametros;
    this._avaliar = avaliar;
  }

  /**
   * Avalia a regra contra o contexto. Mistura os parâmetros default da
   * regra com overrides do sensor (passados em ctx.parametros).
   */
  avaliar(ctx) {
    const p = Object.assign({}, this.parametros, ctx.parametros || {});
    const r = this._avaliar(ctx, p) || {};
    return {
      id: this.id,
      categoria: this.categoria,
      label: this.label,
      fonte: this.fonte,
      status: r.status || "ok",
      resumo: r.resumo || "",
      detalhe: r.detalhe || "",
      diagnostico: r.diagnostico || null,
      valorMedido: r.valorMedido,
      valorIdeal: r.valorIdeal,
    };
  }

  /** Descrição compacta pra montar catálogos (`{categoria, label}`). */
  descricao() {
    return { categoria: this.categoria, label: this.label };
  }
}

if (typeof window !== "undefined") window.Regra = Regra;
