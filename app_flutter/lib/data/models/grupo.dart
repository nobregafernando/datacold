/// Modelo de grupo (ambiente da fábrica): extrusão, câmara de congelados,
/// estoque, graxaria, externos…
class Grupo {
  const Grupo({
    required this.id,
    required this.rotulo,
    this.descricao,
    this.sensorIds = const [],
  });

  final String id;
  final String rotulo;
  final String? descricao;
  final List<String> sensorIds;

  factory Grupo.fromJson(Map<String, dynamic> j) => Grupo(
        id: j['id'] as String,
        rotulo: (j['label'] ?? j['rotulo'] ?? j['id']) as String,
        descricao: j['description'] as String?,
        sensorIds: ((j['sensors'] as List?) ?? const [])
            .map((e) => e.toString())
            .toList(growable: false),
      );
}
