import 'package:supabase_flutter/supabase_flutter.dart';

import 'models/grupo.dart';
import 'models/incidente.dart';
import 'models/sensor.dart';

/// Cliente DataCold — wrapper sobre Supabase com as RPCs já moldadas
/// no contrato que o front espera. Mantém os métodos em ordem alfabética
/// pra facilitar achar.
class ApiClient {
  ApiClient({SupabaseClient? client})
      : _c = client ?? Supabase.instance.client;

  final SupabaseClient _c;

  // -----------------------------------------------------------------
  // Catálogo
  // -----------------------------------------------------------------

  /// Lista todos os sensores + grupos. Devolve cada um já parseado.
  Future<({List<Sensor> sensores, List<Grupo> grupos})> catalogo() async {
    try {
      final r = await _c.rpc('listar_catalogo');
      if (r is Map) {
        final s = ((r['sensors'] as List?) ?? const [])
            .map((j) => Sensor.fromJson((j as Map).cast<String, dynamic>()))
            .toList();
        final g = ((r['groups'] as List?) ?? const [])
            .map((j) => Grupo.fromJson((j as Map).cast<String, dynamic>()))
            .toList();
        return (sensores: s, grupos: g);
      }
      return (sensores: <Sensor>[], grupos: <Grupo>[]);
    } catch (_) {
      return (sensores: <Sensor>[], grupos: <Grupo>[]);
    }
  }

  // -----------------------------------------------------------------
  // Incidentes
  // -----------------------------------------------------------------

  Future<List<Incidente>> incidentesAtivos({String? sensorId}) async {
    try {
      final r = await _c.rpc('incidentes_ativos', params: {'p_sensor': sensorId});
      if (r is List) {
        return r
            .map((j) => Incidente.fromJson((j as Map).cast<String, dynamic>()))
            .toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  /// Resumo leve usado pelo dashboard pra colorir cards com incidente.
  Future<List<({String sensorId, String tipo})>> incidentesAtivosResumo() async {
    try {
      final r = await _c.rpc('listar_incidentes_ativos_resumo');
      if (r is List) {
        return r
            .map((j) => (
                  sensorId: (j as Map)['sensor_id'] as String,
                  tipo: j['tipo'] as String,
                ))
            .toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  // -----------------------------------------------------------------
  // Saúde do backend
  // -----------------------------------------------------------------

  Future<({bool ok, String texto})> verificarSaude() async {
    try {
      final r = await _c.rpc('verificar_saude');
      final demo = (r is Map && (r['demo_mode'] == true));
      return (ok: true, texto: demo ? 'API · modo demo' : 'API · dados reais');
    } catch (_) {
      return (ok: false, texto: 'API offline');
    }
  }
}
