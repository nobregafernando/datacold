/// Status de um veredito (severidade).
enum StatusVeredito { ok, info, warn, crit }

extension StatusVeredictoX on StatusVeredito {
  String get codigo => switch (this) {
        StatusVeredito.ok   => 'ok',
        StatusVeredito.info => 'info',
        StatusVeredito.warn => 'warn',
        StatusVeredito.crit => 'crit',
      };

  static StatusVeredito parse(String? s) => switch (s) {
        'crit' => StatusVeredito.crit,
        'warn' => StatusVeredito.warn,
        'info' => StatusVeredito.info,
        _      => StatusVeredito.ok,
      };
}

/// Resultado da avaliação de uma regra. Igual ao que `Regra.js#avaliar`
/// devolve no front web.
class Veredito {
  Veredito({
    required this.id,
    required this.categoria,
    required this.label,
    required this.status,
    this.resumo = '',
    this.detalhe = '',
    this.diagnostico,
    this.fonte,
    this.valorMedido,
    this.valorIdeal,
  });

  final String id;
  final String categoria;
  final String label;
  final StatusVeredito status;
  final String resumo;
  final String detalhe;
  final String? diagnostico;
  final String? fonte;
  final num? valorMedido;
  final num? valorIdeal;

  bool get critico => status == StatusVeredito.crit;
  bool get atencao => status == StatusVeredito.warn;
  bool get informativo => status == StatusVeredito.info;
  bool get ok => status == StatusVeredito.ok;
}
