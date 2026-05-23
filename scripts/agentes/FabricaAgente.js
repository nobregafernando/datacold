/**
 * Fábrica de agentes — escolhe o agente certo pra um sensor.
 * Strategy + Factory pattern: o resto do código não conhece tipos.
 *
 * USO:
 *   const agente = FabricaAgente.criar(sensor);
 *   const vereditos = agente.avaliar(pontos);
 */
class FabricaAgente {
  static MAPA = {
    energia:     () => AgenteEnergia,
    temperatura: () => AgenteTemperatura,
    porta:       () => AgentePorta,
  };

  static criar(sensor) {
    const tipo = sensor?.tipo;
    const Classe = (FabricaAgente.MAPA[tipo] || (() => AgenteBase))();
    return new Classe(sensor);
  }

  /** Catálogo descritivo das regras pra um tipo (sem precisar instanciar). */
  static catalogo(tipo) {
    const Classe = (FabricaAgente.MAPA[tipo] || (() => null))();
    return Classe ? Classe.catalogo() : [];
  }
}

if (typeof window !== "undefined") window.FabricaAgente = FabricaAgente;
