import '../data/models/sensor.dart';
import 'agente_base.dart';
import 'agente_energia.dart';
import 'agente_porta.dart';
import 'agente_temperatura.dart';
import 'regra.dart';

/// Strategy — instancia o agente correto pelo tipo do sensor.
class FabricaAgente {
  static AgenteBase criar(Sensor sensor) => switch (sensor.tipo) {
        'energia'     => AgenteEnergia(sensor),
        'temperatura' => AgenteTemperatura(sensor),
        'porta'       => AgentePorta(sensor),
        _             => _AgenteVazio(sensor),
      };

  /// Catálogo de regras por tipo (sem dependência de sensor específico).
  static List<Regra> catalogo(String tipo) => switch (tipo) {
        'energia'     => AgenteEnergia(Sensor(id: '_', rotulo: '_', tipo: 'energia', grupo: '_', status: 'ativo')).regras,
        'temperatura' => AgenteTemperatura(Sensor(id: '_', rotulo: '_', tipo: 'temperatura', grupo: '_', status: 'ativo')).regras,
        'porta'       => AgentePorta(Sensor(id: '_', rotulo: '_', tipo: 'porta', grupo: '_', status: 'ativo')).regras,
        _             => const [],
      };
}

class _AgenteVazio extends AgenteBase {
  _AgenteVazio(Sensor sensor) : super(sensor);
  @override double get cadenciaSegundos => 60;
  @override List<Regra> get regras => const [];
}
