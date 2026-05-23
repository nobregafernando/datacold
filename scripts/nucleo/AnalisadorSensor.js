/**
 * AnalisadorSensor — orquestrador fino sobre a hierarquia de Agentes.
 *
 * A lógica de verificação foi extraída pra `scripts/agentes/` (Strategy +
 * Rule Engine). Este arquivo só mantém a API pública que a UI já usa,
 * delegando pro AgenteBase apropriado via FabricaAgente.
 *
 * API PÚBLICA (preservada):
 *   new AnalisadorSensor(sensor, pontos).avaliar()
 *     → [{id, categoria, label, status, resumo, detalhe, diagnostico,
 *         fonte?, valorMedido?, valorIdeal?}, ...]
 *
 *   AnalisadorSensor.catalogo(tipo)
 *     → [{categoria, label}, ...]
 *
 *   AnalisadorSensor.FAIXAS_TERMICAS
 *     → mantém o objeto antigo, agora apontando pra NORMAS.ANVISA.faixas
 *
 * Pra mudar/adicionar regras, edite `scripts/agentes/Agente<Tipo>.js`.
 * Pra mudar limites técnicos, edite `scripts/agentes/normas.js`.
 */
class AnalisadorSensor {

  /** Faixa térmica por grupo — proxy pra retrocompatibilidade. */
  static FAIXAS_TERMICAS = (typeof NORMAS !== "undefined")
    ? NORMAS.ANVISA.faixas
    : {
      camara_congelados:  { min: -28, max: -18, label: "câmara de congelados" },
      camara_estoque:     { min:  -4, max:   4, label: "câmara fria de estoque" },
      graxaria:           { min: -10, max:   4, label: "câmara da graxaria" },
    };

  constructor(sensor, pontos = []) {
    this.sensor = sensor;
    this.pontos = pontos;
  }

  /** Retorna a lista de verificações com status calculado. */
  avaliar() {
    if (!this.sensor || !this.pontos?.length) {
      return [{
        id: "sem-dados",
        categoria: "Telemetria",
        label: "Há dados pra analisar?",
        status: "warn",
        resumo: "Sem dados",
        detalhe: "Sem pontos retornados pela API para a janela atual.",
        diagnostico: "Tente uma janela maior. Se persistir, sensor pode estar offline.",
      }];
    }
    const agente = FabricaAgente.criar(this.sensor);
    return agente.avaliar(this.pontos);
  }

  /** Catálogo descritivo: o que o agente daquele tipo consegue detectar. */
  static catalogo(tipo) {
    const comuns = [
      { categoria: "Conectividade", label: "Sensor está online?" },
      { categoria: "Telemetria",    label: "A telemetria é confiável?" },
    ];
    return comuns.concat(FabricaAgente.catalogo(tipo));
  }
}

if (typeof window !== "undefined") window.AnalisadorSensor = AnalisadorSensor;
