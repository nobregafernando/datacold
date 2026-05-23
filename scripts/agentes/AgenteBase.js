/**
 * Classe-base de agente. Subclasses definem:
 *   - static REGRAS:    array de instâncias de Regra específicas do tipo
 *   - contexto(pontos): pré-calcula métricas (FP composto, CUB, faixas…)
 *
 * O fluxo de avaliação é sempre:
 *   1) verifica conectividade e telemetria (comum aos 3 tipos)
 *   2) monta o contexto via contexto(pontos)
 *   3) roda cada regra contra o contexto, junta os vereditos
 *
 * Os `parametros` injetados no contexto vêm do `sensor.parametros`
 * (jsonb do Supabase) — assim cada regra pode usar tanto os defaults
 * da norma quanto overrides por sensor.
 */
class AgenteBase {
  static REGRAS = [];

  constructor(sensor) {
    this.sensor = sensor;
    this.regras = this.constructor.REGRAS || [];
  }

  /** Contexto pré-mastigado pra todas as regras. Subclasses estendem. */
  contexto(pontos) {
    return {
      pontos,
      sensor: this.sensor,
      parametros: this.sensor?.parametros || {},
      ultimo: pontos[pontos.length - 1] || null,
      n: pontos.length,
    };
  }

  /**
   * Roda todas as verificações: conectividade, telemetria e regras
   * específicas do tipo. Devolve array de vereditos.
   */
  avaliar(pontos) {
    if (!pontos || !pontos.length) return [];

    const out = [];

    // Comuns aos 3 tipos
    const conect = VerificacoesComuns.avaliarConectividade(pontos, this.sensor?.parametros);
    if (conect) out.push(conect);
    const tele = VerificacoesComuns.avaliarTelemetria(pontos, this.sensor?.parametros);
    if (tele) out.push(tele);

    // Específicas do tipo
    const ctx = this.contexto(pontos);
    for (const regra of this.regras) {
      try {
        out.push(regra.avaliar(ctx));
      } catch (e) {
        out.push({
          id: regra.id, categoria: regra.categoria, label: regra.label,
          fonte: regra.fonte,
          status: "info", resumo: "Erro na regra",
          detalhe: `Falha ao avaliar: ${e.message}`,
        });
      }
    }
    return out;
  }

  /** Catálogo descritivo (pra catalogo() do AnalisadorSensor). */
  static catalogo() {
    return (this.REGRAS || []).map(r => r.descricao());
  }
}

if (typeof window !== "undefined") window.AgenteBase = AgenteBase;
