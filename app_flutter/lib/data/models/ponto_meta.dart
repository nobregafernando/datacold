/// Metadados de um ponto reconstruído pelo AgenteReconstrutor.
/// Espelha o `_meta` que o JS preenche em cada ponto sintético.
class PontoMeta {
  PontoMeta({
    required this.confianca,
    required this.estrategiaPrincipal,
    this.janelaHoraria = '',
    this.diaSemana = '',
    this.nSemanasUsadas = 0,
    this.periodoBaseDescricao = '',
    this.camposEstrategia = const {},
    this.camposConfianca = const {},
    this.metasPorCampo = const {},
    this.nAntes = 0,
    this.nDepois = 0,
    this.duracaoS = 0,
    this.ciclosUsados = const [],
  });

  final double confianca;                       // 0..1
  final String estrategiaPrincipal;             // 'splc_semanal', 'splc_diario', 'interp_linear', 'media', 'step', …
  final String janelaHoraria;                   // ex: '12:30 – 13:30'
  final String diaSemana;                       // ex: 'terça'
  final int nSemanasUsadas;
  final String periodoBaseDescricao;
  final Map<String, String> camposEstrategia;   // campo → estrategia ('splc', 'media', 'step', 'linear')
  final Map<String, double> camposConfianca;    // campo → confiança 0..1
  final Map<String, Map<String, Object?>> metasPorCampo;
  final int nAntes;
  final int nDepois;
  final double duracaoS;
  final List<String> ciclosUsados;              // ['24h', '7d', '30d']

  String get rotuloConfianca {
    final p = (confianca * 100).round();
    if (p >= 75) return 'alta';
    if (p >= 50) return 'média';
    return 'baixa';
  }
}
