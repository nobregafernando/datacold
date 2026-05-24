/// Override de parâmetro de regra por sensor. Espelha a coluna
/// `parametros` (JSONB) da tabela `sensores` no Supabase.
class RegraParam {
  RegraParam({
    required this.chave,
    required this.valor,
    this.descricao,
    this.severidade = 'info',
    this.unidade,
  });

  final String chave;        // ex: 'limite_critico', 'envelope_min', 'esquecida_s'
  final num valor;
  final String? descricao;   // explicação leiga do que muda quando exceder
  final String severidade;   // 'critico' | 'atencao' | 'info' | 'neutro'
  final String? unidade;     // 'kW' | '°C' | '%' | 's' | 'V' | 'A' | '×'
}
