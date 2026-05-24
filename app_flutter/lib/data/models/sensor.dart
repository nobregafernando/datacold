/// Modelo de sensor (espelha o JSON devolvido por `listar_catalogo`).
class Sensor {
  const Sensor({
    required this.id,
    required this.rotulo,
    required this.tipo,
    required this.grupo,
    required this.status,
    this.parametros = const {},
    this.personalidade,
  });

  final String id;
  final String rotulo;
  final String tipo;       // "energia" | "temperatura" | "porta"
  final String grupo;      // id do grupo (extrusao, camara_congelados, …)
  final String status;     // "ativo" | "historico"
  final Map<String, dynamic> parametros;
  final String? personalidade;

  bool get ativo     => status == 'ativo';
  bool get historico => status == 'historico';

  factory Sensor.fromJson(Map<String, dynamic> j) => Sensor(
        id: j['id'] as String,
        rotulo: (j['label'] ?? j['rotulo'] ?? j['id']) as String,
        tipo: (j['type'] ?? j['tipo'] ?? 'energia') as String,
        grupo: (j['group'] ?? j['grupo_id'] ?? j['grupo'] ?? '') as String,
        status: (j['status'] ?? 'ativo') as String,
        parametros: (j['parametros'] as Map?)?.cast<String, dynamic>() ?? const {},
        personalidade: j['personalidade'] as String?,
      );
}
