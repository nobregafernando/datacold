/// Perfil físico/comportamental do sensor — vem da tabela `sensores`
/// no Supabase (RPC `listar_perfis_sensores`). Define como o agente
/// fake gera os dados E também os overrides de parâmetros das regras.
class PerfilSensor {
  PerfilSensor({
    required this.id,
    this.personalidade = '',
    this.parametros = const {},
  });

  final String id;
  final String personalidade;
  final Map<String, dynamic> parametros;

  factory PerfilSensor.fromJson(Map<String, dynamic> j) => PerfilSensor(
        id: j['id'] as String,
        personalidade: (j['personalidade'] ?? '') as String,
        parametros: (j['parametros'] as Map?)?.cast<String, dynamic>() ?? const {},
      );

  double? get fpBase            => (parametros['fp_base'] as num?)?.toDouble();
  double? get correnteNominalA  => (parametros['corrente_nominal_a'] as num?)?.toDouble();
  double? get tensaoNominalV    => (parametros['tensao_nominal_v'] as num?)?.toDouble();
  double? get cubAlvoPct        => (parametros['cub_alvo_pct'] as num?)?.toDouble();
  String?  get faseAusente      => parametros['fase_ausente'] as String?;
}
