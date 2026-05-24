import 'veredito.dart';

/// Função de avaliação de uma regra — recebe contexto + parâmetros
/// mesclados (defaults + overrides do sensor) e devolve um veredito.
typedef AvaliarFn = Veredito Function(
  Map<String, dynamic> ctx,
  Map<String, dynamic> p,
);

/// Regra isolada — espelha `scripts/agentes/Regra.js`.
class Regra {
  Regra({
    required this.id,
    this.categoria = 'Geral',
    String? label,
    this.fonte,
    this.parametros = const {},
    required this.avaliarFn,
  }) : label = label ?? id;

  final String id;
  final String categoria;
  final String label;
  final String? fonte;
  final Map<String, dynamic> parametros;
  final AvaliarFn avaliarFn;

  Veredito avaliar(Map<String, dynamic> ctx) {
    final p = {...parametros, ...?(ctx['parametros'] as Map<String, dynamic>?)};
    final r = avaliarFn(ctx, p);
    // Sobrescreve metadados pra garantir consistência id/categoria/label/fonte
    return Veredito(
      id: id,
      categoria: categoria,
      label: label,
      status: r.status,
      resumo: r.resumo,
      detalhe: r.detalhe,
      diagnostico: r.diagnostico,
      fonte: fonte,
      valorMedido: r.valorMedido,
      valorIdeal: r.valorIdeal,
    );
  }

  /// Para catálogos.
  Map<String, String> get descricao => {'categoria': categoria, 'label': label};
}
