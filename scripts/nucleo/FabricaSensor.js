/**
 * Fábrica que instancia a subclasse correta de Sensor a partir
 * do payload da API.
 */
class FabricaSensor {
  static MAPA = {
    energia:     () => SensorEnergia,
    temperatura: () => SensorTemperatura,
    porta:       () => SensorPorta,
  };

  static criar(dados) {
    const Classe = (FabricaSensor.MAPA[dados.type] || (() => Sensor))();
    return new Classe(dados);
  }

  static criarLista(lista = []) {
    return lista.map(d => FabricaSensor.criar(d));
  }
}

if (typeof window !== "undefined") window.FabricaSensor = FabricaSensor;
