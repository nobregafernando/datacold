/// Resumo de um gap detectado e reconstruído pelo AgenteReconstrutor.
class GapResumo {
  GapResumo({
    required this.inicio,
    required this.fim,
    required this.duracaoS,
    required this.nReconstruidos,
    required this.confianca,
    required this.estrategiaPrincipal,
    this.ciclosUsados = const [],
  });

  final DateTime inicio;
  final DateTime fim;
  final double duracaoS;
  final int nReconstruidos;
  final double confianca;                 // 0..1
  final String estrategiaPrincipal;       // mesmo enum do PontoMeta
  final List<String> ciclosUsados;

  String get duracaoLegivel {
    if (duracaoS < 60) return '${duracaoS.toStringAsFixed(0)}s';
    if (duracaoS < 3600) return '${(duracaoS / 60).toStringAsFixed(0)} min';
    return '${(duracaoS / 3600).toStringAsFixed(1)}h';
  }
}
