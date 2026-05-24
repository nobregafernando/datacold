/// Evento de acesso (login) do usuário atual.
/// Vem da RPC `listar_meus_acessos`.
class AcessoLog {
  AcessoLog({
    required this.id,
    required this.criadoEm,
    required this.origem,
    this.ip,
    this.userAgent,
  });

  final int id;
  final DateTime criadoEm;
  final String origem;         // 'login' | 'refresh' | 'mvp' | 'manual'
  final String? ip;
  final String? userAgent;

  factory AcessoLog.fromJson(Map<String, dynamic> j) => AcessoLog(
        id:        (j['id'] as num).toInt(),
        criadoEm:  DateTime.tryParse((j['criado_em'] ?? '') as String)
                   ?? DateTime.now(),
        origem:    (j['origem'] ?? 'login') as String,
        ip:        j['ip'] as String?,
        userAgent: j['user_agent'] as String?,
      );
}
