/// Incidente injetado pela Sala de Controle (gap, offline, spike, drift,
/// valor_impossivel). Devolvido pela RPC `incidentes_ativos`.
class Incidente {
  const Incidente({
    required this.id,
    required this.sensorId,
    required this.tipo,
    this.magnitude,
    this.valor,
    this.fim,
    this.segundosRestantes,
    this.descricao,
  });

  final String id;
  final String sensorId;
  final String tipo;
  final num? magnitude;
  final num? valor;
  final DateTime? fim;
  final int? segundosRestantes;
  final String? descricao;

  factory Incidente.fromJson(Map<String, dynamic> j) => Incidente(
        id: j['id'].toString(),
        sensorId: j['sensor_id'] as String,
        tipo: j['tipo'] as String,
        magnitude: j['magnitude'] as num?,
        valor: j['valor'] as num?,
        fim: j['fim'] == null ? null : DateTime.tryParse(j['fim'] as String),
        segundosRestantes: (j['segundos_restantes'] as num?)?.toInt(),
        descricao: j['descricao'] as String?,
      );
}
