/// Ponto de telemetria — leitura individual devolvida por `buscar_dados`.
///
/// Após passar pelo AgenteReconstrutor, o ponto pode ganhar flags:
///   - [reconstruido]: ponto sintético gerado por SPLC ou interpolação
///   - [vazio]: ponto sintético no gap em curso (linha morta no zero)
///   - [meta]: metadados do método de reconstrução (só quando [reconstruido])
class Ponto {
  Ponto({
    required this.time,
    required this.campos,
    this.reconstruido = false,
    this.vazio = false,
    this.meta,
  });

  final DateTime time;
  final Map<String, num?> campos;
  final bool reconstruido;
  final bool vazio;
  final Object? meta; // PontoMeta — tipo solto pra evitar import circular

  /// Lê um campo numérico (double). Devolve null se ausente/nulo.
  double? lerNumero(String chave) {
    final v = campos[chave];
    if (v == null) return null;
    return v.toDouble();
  }

  factory Ponto.fromJson(Map<String, dynamic> j) {
    final time = DateTime.parse(j['time'] as String);
    final campos = <String, num?>{};
    for (final e in j.entries) {
      if (e.key == 'time') continue;
      final v = e.value;
      if (v is num) campos[e.key] = v;
      else if (v == null) campos[e.key] = null;
    }
    return Ponto(time: time, campos: campos);
  }
}
