/// Notificação emitida pelos agentes. Espelha registros da tabela
/// `notificacoes` (RPC `listar_minhas_notificacoes`).
class Notificacao {
  Notificacao({
    required this.id,
    required this.titulo,
    required this.mensagem,
    required this.severidade,        // 'critica' | 'alta' | 'media' | 'comum'
    required this.criadaEm,
    this.lida = false,
    this.arquivada = false,
    this.sensorId,
    this.regraId,
    this.valorMedido,
    this.valorIdeal,
    this.fonte,
  });

  final String id;
  final String titulo;
  final String mensagem;
  final String severidade;
  final DateTime criadaEm;
  final bool lida;
  final bool arquivada;
  final String? sensorId;
  final String? regraId;
  final num? valorMedido;
  final num? valorIdeal;
  final String? fonte;

  factory Notificacao.fromJson(Map<String, dynamic> j) => Notificacao(
        id: j['id'].toString(),
        titulo: (j['titulo'] ?? '(sem título)') as String,
        mensagem: (j['mensagem'] ?? '') as String,
        severidade: (j['severidade'] ?? 'comum') as String,
        criadaEm: DateTime.parse(j['criada_em'] as String),
        lida: (j['lida'] ?? false) as bool,
        arquivada: (j['arquivada'] ?? false) as bool,
        sensorId: j['sensor_id'] as String?,
        regraId: j['regra_id'] as String?,
        valorMedido: j['valor_medido'] as num?,
        valorIdeal: j['valor_ideal'] as num?,
        fonte: j['fonte'] as String?,
      );
}
