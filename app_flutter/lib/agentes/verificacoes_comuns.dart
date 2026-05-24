import '../data/models/ponto.dart';
import 'normas.dart';
import 'veredito.dart';

/// Verificações comuns aos 3 tipos de sensor (conectividade + telemetria).
/// Espelha `scripts/agentes/verificacoesComuns.js`.
class VerificacoesComuns {
  /// Avalia se o sensor está online (último ponto recente, dentro da cadência).
  static Veredito conectividade({
    required List<Ponto> pontos,
    required double cadenciaSegundos,
  }) {
    if (pontos.isEmpty) {
      return Veredito(
        id: 'conectividade',
        categoria: 'Conectividade',
        label: 'Sensor está online?',
        status: StatusVeredito.crit,
        resumo: 'Sem leituras',
        detalhe: 'Nenhum ponto na janela analisada.',
        diagnostico: 'Sensor offline ou rede caída.',
        fonte: Normas.offlineMultiplicador.fonte,
      );
    }
    final ultimo = pontos.last.time;
    final idadeS = DateTime.now().difference(ultimo).inSeconds.toDouble();
    final limOff      = cadenciaSegundos * Normas.offlineMultiplicador.valor;
    final limInstavel = cadenciaSegundos * Normas.instavelMultiplicador.valor;

    if (idadeS > limOff) {
      return Veredito(
        id: 'conectividade',
        categoria: 'Conectividade',
        label: 'Sensor está online?',
        status: StatusVeredito.crit,
        resumo: 'Offline há ${(idadeS / 60).round()} min',
        detalhe: 'Última leitura há ${idadeS.toStringAsFixed(0)}s · cadência típica ${cadenciaSegundos}s · limite offline = ${limOff.toStringAsFixed(0)}s',
        diagnostico: 'Verifique rede, alimentação ou ligação do sensor.',
        fonte: Normas.offlineMultiplicador.fonte,
      );
    }
    if (idadeS > limInstavel) {
      return Veredito(
        id: 'conectividade',
        categoria: 'Conectividade',
        label: 'Sensor está online?',
        status: StatusVeredito.warn,
        resumo: 'Instável',
        detalhe: 'Última leitura há ${idadeS.toStringAsFixed(0)}s — esperado ≤ ${limInstavel.toStringAsFixed(0)}s.',
        fonte: Normas.instavelMultiplicador.fonte,
      );
    }
    return Veredito(
      id: 'conectividade',
      categoria: 'Conectividade',
      label: 'Sensor está online?',
      status: StatusVeredito.ok,
      resumo: 'Online',
      detalhe: 'Última leitura há ${idadeS.toStringAsFixed(0)}s.',
    );
  }

  /// Avalia se a telemetria tem lacunas (gaps).
  static Veredito telemetria({
    required List<Ponto> pontos,
    required double cadenciaSegundos,
  }) {
    if (pontos.length < 2) {
      return Veredito(
        id: 'telemetria',
        categoria: 'Telemetria',
        label: 'A telemetria é confiável?',
        status: StatusVeredito.info,
        resumo: 'Pouco dado',
        detalhe: 'Menos de 2 pontos — sem como calcular lacunas.',
        fonte: Normas.gapMultiplicador.fonte,
      );
    }
    final limGap = cadenciaSegundos * Normas.gapMultiplicador.valor;
    var gaps = 0;
    for (var i = 1; i < pontos.length; i++) {
      final diff = pontos[i].time.difference(pontos[i - 1].time).inSeconds;
      if (diff > limGap) gaps++;
    }
    final wCrit = Normas.lacunasCrit.valor;
    final wWarn = Normas.lacunasWarn.valor;
    if (gaps >= wCrit) {
      return Veredito(
        id: 'telemetria', categoria: 'Telemetria',
        label: 'A telemetria é confiável?',
        status: StatusVeredito.crit,
        resumo: '$gaps lacunas',
        detalhe: '$gaps gaps detectados (> $wCrit). Stream muito furado.',
        fonte: Normas.lacunasCrit.fonte,
      );
    }
    if (gaps >= wWarn) {
      return Veredito(
        id: 'telemetria', categoria: 'Telemetria',
        label: 'A telemetria é confiável?',
        status: StatusVeredito.warn,
        resumo: '$gaps lacunas',
        detalhe: '$gaps gaps detectados (> $wWarn).',
        fonte: Normas.lacunasWarn.fonte,
      );
    }
    return Veredito(
      id: 'telemetria', categoria: 'Telemetria',
      label: 'A telemetria é confiável?',
      status: StatusVeredito.ok,
      resumo: gaps == 0 ? 'Sem lacunas' : '$gaps lacunas',
      detalhe: '$gaps gaps detectados — dentro do aceitável.',
    );
  }
}
