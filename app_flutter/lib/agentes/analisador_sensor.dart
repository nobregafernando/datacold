import '../data/models/ponto.dart';
import '../data/models/sensor.dart';
import 'fabrica_agente.dart';
import 'veredito.dart';

/// Orquestrador — recebe sensor + pontos, instancia o agente correto
/// e devolve a lista de vereditos. Atalho usado nas telas de sensor.
class AnalisadorSensor {
  AnalisadorSensor(this.sensor, this.pontos);
  final Sensor sensor;
  final List<Ponto> pontos;

  List<Veredito> avaliar() => FabricaAgente.criar(sensor).avaliar(pontos);

  /// Maior severidade entre todos os vereditos — atalho útil pra UI.
  StatusVeredito severidadeMaxima() {
    var max = StatusVeredito.ok;
    for (final v in avaliar()) {
      if (_peso(v.status) > _peso(max)) max = v.status;
    }
    return max;
  }

  static int _peso(StatusVeredito s) => switch (s) {
        StatusVeredito.crit => 3,
        StatusVeredito.warn => 2,
        StatusVeredito.info => 1,
        StatusVeredito.ok   => 0,
      };
}
