import 'package:supabase_flutter/supabase_flutter.dart';

import 'models/grupo.dart';
import 'models/incidente.dart';
import 'models/notificacao.dart';
import 'models/perfil_sensor.dart';
import 'models/ponto.dart';
import 'models/sensor.dart';

/// Cliente DataCold — wrapper sobre Supabase com TODAS as RPCs do projeto.
/// Mantém os métodos em ordem alfabética pra facilitar achar.
class ApiClient {
  ApiClient({SupabaseClient? client})
      : _c = client ?? Supabase.instance.client;

  final SupabaseClient _c;

  // -----------------------------------------------------------------
  // Catálogo
  // -----------------------------------------------------------------

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
  // Dados ao vivo (timeseries)
  // -----------------------------------------------------------------

  /// `inicio`/`fim` aceitam strings relativas ('-1h', '-24h', 'now') ou
  /// timestamps ISO. `limite` é o número máximo de pontos.
  Future<({List<Ponto> pontos, List<String> campos})> buscarDados(
    String sensorId, {
    String inicio = '-1h',
    String fim = 'now',
    int limite = 1000,
  }) async {
    try {
      final r = await _c.rpc('buscar_dados', params: {
        'p_sensor': sensorId,
        'p_start':  inicio,
        'p_stop':   fim,
        'p_limit':  limite,
      });
      if (r is Map) {
        final lista = (r['points'] as List?) ?? const [];
        final pontos = lista
            .map((j) => Ponto.fromJson((j as Map).cast<String, dynamic>()))
            .toList();
        final campos = ((r['fields'] as List?) ?? const [])
            .map((e) => e.toString())
            .toList();
        return (pontos: pontos, campos: campos);
      }
      return (pontos: <Ponto>[], campos: <String>[]);
    } catch (_) {
      return (pontos: <Ponto>[], campos: <String>[]);
    }
  }

  // -----------------------------------------------------------------
  // Incidentes (Sala de Controle)
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

  Future<String?> criarIncidente({
    required String sensor,
    required String tipo,
    num magnitude = 0,
    num valor = 0,
    int? duracaoS,
    String descricao = '',
  }) async {
    try {
      final r = await _c.rpc('criar_incidente', params: {
        'p_sensor':    sensor,
        'p_tipo':      tipo,
        'p_duracao_s': duracaoS,
        'p_magnitude': magnitude,
        'p_valor':     valor,
        'p_descricao': descricao,
      });
      if (r is Map) return r['id']?.toString();
      return null;
    } catch (e) {
      return null;
    }
  }

  Future<bool> cancelarIncidente(String id) async {
    try {
      await _c.rpc('cancelar_incidente', params: {'p_id': id});
      return true;
    } catch (_) {
      return false;
    }
  }

  // -----------------------------------------------------------------
  // Parâmetros por sensor (overrides editáveis na página de Agentes)
  // -----------------------------------------------------------------

  Future<Map<String, dynamic>> obterParametrosSensor(String sensorId) async {
    try {
      final r = await _c.rpc('obter_parametros_sensor', params: {'p_sensor': sensorId});
      if (r is Map) return r.cast<String, dynamic>();
      return {};
    } catch (_) {
      return {};
    }
  }

  Future<bool> atualizarParametrosSensor(String sensorId, Map<String, dynamic> parametros) async {
    try {
      await _c.rpc('atualizar_parametros_sensor', params: {
        'p_sensor':     sensorId,
        'p_parametros': parametros,
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  // -----------------------------------------------------------------
  // Perfis (personalidade + parâmetros — alimenta receita da Sala)
  // -----------------------------------------------------------------

  Future<List<PerfilSensor>> listarPerfisSensores() async {
    try {
      final r = await _c.rpc('listar_perfis_sensores');
      if (r is List) {
        return r
            .map((j) => PerfilSensor.fromJson((j as Map).cast<String, dynamic>()))
            .toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  // -----------------------------------------------------------------
  // Últimas leituras (1 ponto por sensor — pra colorir dashboard)
  // -----------------------------------------------------------------

  Future<Map<String, DateTime>> listarUltimasLeituras() async {
    try {
      final r = await _c.rpc('listar_ultimas_leituras');
      if (r is List) {
        final out = <String, DateTime>{};
        for (final item in r) {
          final m = (item as Map).cast<String, dynamic>();
          final sid = m['sensor_id'] as String?;
          final tStr = m['momento'] as String?;
          if (sid != null && tStr != null) {
            out[sid] = DateTime.tryParse(tStr) ?? DateTime.now();
          }
        }
        return out;
      }
      return {};
    } catch (_) {
      return {};
    }
  }

  // -----------------------------------------------------------------
  // Notificações
  // -----------------------------------------------------------------

  Future<List<Notificacao>> listarMinhasNotificacoes({int limite = 200}) async {
    try {
      final r = await _c.rpc('listar_minhas_notificacoes', params: {'p_limit': limite});
      if (r is List) {
        return r
            .map((j) => Notificacao.fromJson((j as Map).cast<String, dynamic>()))
            .toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  Future<int> contarNaoLidas() async {
    try {
      final r = await _c.rpc('contar_nao_lidas');
      if (r is num) return r.toInt();
      if (r is Map && r['count'] is num) return (r['count'] as num).toInt();
      return 0;
    } catch (_) {
      return 0;
    }
  }

  Future<bool> marcarNotificacaoLida(String id) async {
    try {
      await _c.rpc('marcar_notificacao_lida', params: {'p_id': id});
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<bool> marcarTodasLidas() async {
    try {
      await _c.rpc('marcar_todas_lidas');
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<bool> arquivarNotificacao(String id) async {
    try {
      await _c.rpc('arquivar_notificacao', params: {'p_id': id});
      return true;
    } catch (_) {
      return false;
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
