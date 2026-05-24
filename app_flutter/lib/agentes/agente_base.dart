import '../data/models/ponto.dart';
import '../data/models/sensor.dart';
import 'regra.dart';
import 'verificacoes_comuns.dart';
import 'veredito.dart';

/// Classe base dos agentes — define a interface comum:
///   - `regras`: lista de Regras específicas do tipo
///   - `cadenciaSegundos`: intervalo típico entre leituras (pra
///      verificações de conectividade/telemetria)
///   - `contexto(pontos)`: pré-calcula métricas (FP composto, CUB, faixas…)
///   - `avaliar(pontos)`: roda conectividade + telemetria + regras
abstract class AgenteBase {
  AgenteBase(this.sensor);
  final Sensor sensor;

  List<Regra> get regras;
  double get cadenciaSegundos;

  /// Pré-calcula contexto pra as regras. Subclasse estende.
  Map<String, dynamic> contexto(List<Ponto> pontos) => {
        'pontos': pontos,
        'sensor': sensor,
        'parametros': sensor.parametros,
        'ultimo': pontos.isEmpty ? null : pontos.last,
        'n': pontos.length,
      };

  /// Roda comuns + específicas.
  List<Veredito> avaliar(List<Ponto> pontos) {
    final out = <Veredito>[
      VerificacoesComuns.conectividade(pontos: pontos, cadenciaSegundos: cadenciaSegundos),
      VerificacoesComuns.telemetria(pontos: pontos, cadenciaSegundos: cadenciaSegundos),
    ];
    if (pontos.isEmpty) return out;
    final ctx = contexto(pontos);
    for (final r in regras) {
      try {
        out.add(r.avaliar(ctx));
      } catch (e) {
        out.add(Veredito(
          id: r.id,
          categoria: r.categoria,
          label: r.label,
          status: StatusVeredito.info,
          resumo: 'Erro na regra',
          detalhe: 'Falha ao avaliar: $e',
          fonte: r.fonte,
        ));
      }
    }
    return out;
  }
}
