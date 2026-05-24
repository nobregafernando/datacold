import 'dart:math' as math;

import '../data/models/gap_resumo.dart';
import '../data/models/ponto.dart';
import '../data/models/ponto_meta.dart';
import '../data/models/sensor.dart';

/// Resultado da reconstrução.
class ResultadoReconstrucao {
  ResultadoReconstrucao({
    required this.pontos,
    required this.gaps,
    required this.offlineAgora,
    required this.segDesdeUltimo,
  });
  final List<Ponto> pontos;       // série enriquecida (real + reconstruídos + vazios)
  final List<GapResumo> gaps;     // resumo de cada gap reconstruído
  final bool offlineAgora;        // gap em curso?
  final double segDesdeUltimo;    // tempo desde último ponto real

  int get nReconstruidos => pontos.where((p) => p.reconstruido).length;
  int get nVazios        => pontos.where((p) => p.vazio).length;
  double get confianciaMedia {
    if (gaps.isEmpty) return 1.0;
    final tot = gaps.fold<double>(0, (s, g) => s + g.confianca);
    return tot / gaps.length;
  }
  String get metodoDominante {
    if (gaps.isEmpty) return '—';
    final cont = <String, int>{};
    for (final g in gaps) {
      cont[g.estrategiaPrincipal] = (cont[g.estrategiaPrincipal] ?? 0) + 1;
    }
    return cont.entries.reduce((a, b) => a.value >= b.value ? a : b).key;
  }
}

/// Agente Reconstrutor — preenche lacunas na série temporal usando:
///   1. SPLC semanal (mesmo horário, mesma semana, ciclos 24h/7d)
///   2. Interpolação linear como fallback
///   3. "Linha morta": gap em curso vira pontos com valor 0 marcados _vazio
///
/// Cadências (segundos) por tipo:
///   energia=30 · temperatura=60 · porta=60
class AgenteReconstrutor {
  AgenteReconstrutor(this.sensor);
  final Sensor sensor;

  static const _cadencias = {'energia': 30.0, 'temperatura': 60.0, 'porta': 60.0};
  static const _gapMult = 1.6;
  static const _nContexto = 5;

  /// Reconstrói uma série, opcionalmente com `historico` estendido (até 7d).
  ResultadoReconstrucao reconstruir(
    List<Ponto> pontos, {
    List<Ponto> historico = const [],
  }) {
    if (pontos.length < 2) {
      return ResultadoReconstrucao(
        pontos: pontos,
        gaps: const [],
        offlineAgora: false,
        segDesdeUltimo: 0,
      );
    }
    final cadencia = _cadencias[sensor.tipo] ?? 60.0;
    final passoMs = (cadencia * 1000).toInt();
    final limGapMs = (passoMs * _gapMult).toInt();
    final base = _unirHistorico(pontos, historico);

    final saida = <Ponto>[];
    final gaps = <GapResumo>[];

    for (var i = 0; i < pontos.length; i++) {
      saida.add(pontos[i]);
      if (i == pontos.length - 1) break;
      final delta = pontos[i + 1].time.difference(pontos[i].time).inMilliseconds;
      if (delta <= limGapMs) continue;

      final n = (delta / passoMs).floor() - 1;
      if (n < 1) continue;

      final antes  = pontos.sublist(math.max(0, i - _nContexto + 1), i + 1);
      final depois = pontos.sublist(i + 1, math.min(pontos.length, i + 1 + _nContexto));

      final res = _reconstruirGap(
        antes: antes, depois: depois, n: n,
        passoMs: passoMs, tInicioMs: pontos[i].time.millisecondsSinceEpoch,
        historicoBase: base,
      );
      saida.addAll(res.pontos);
      gaps.add(res.resumo);
    }

    // Linha morta — gap em curso
    bool offlineAgora = false;
    double segDesdeUltimo = 0;
    final ultimo = pontos.last;
    final desdeUltimo = DateTime.now().millisecondsSinceEpoch -
        ultimo.time.millisecondsSinceEpoch;
    segDesdeUltimo = desdeUltimo / 1000;

    if (desdeUltimo > limGapMs) {
      offlineAgora = true;
      final nVazios = math.min(120, (desdeUltimo / passoMs).floor());
      final agora = DateTime.now().millisecondsSinceEpoch;
      final camposBase = ultimo.campos.keys.toList();
      for (var j = 1; j <= nVazios; j++) {
        final t = ultimo.time.millisecondsSinceEpoch + passoMs * j;
        if (t > agora) break;
        final campos = <String, num?>{for (final k in camposBase) k: 0};
        saida.add(Ponto(
          time: DateTime.fromMillisecondsSinceEpoch(t),
          campos: campos,
          vazio: true,
        ));
      }
    }

    return ResultadoReconstrucao(
      pontos: saida,
      gaps: gaps,
      offlineAgora: offlineAgora,
      segDesdeUltimo: segDesdeUltimo,
    );
  }

  // ----------------------------------------------------------------

  ({List<Ponto> pontos, GapResumo resumo}) _reconstruirGap({
    required List<Ponto> antes,
    required List<Ponto> depois,
    required int n,
    required int passoMs,
    required int tInicioMs,
    required List<Ponto> historicoBase,
  }) {
    // Campos numéricos do último ponto antes
    final ultimoAntes = antes.last;
    final camposNumericos = ultimoAntes.campos.keys.toList();

    // Estratégia por campo
    String estrategia(String c) {
      if (sensor.tipo == 'porta') return 'step';
      if (c.startsWith('tensao_'))          return 'media';
      if (c.startsWith('fator_potencia_'))  return 'media';
      if (c.startsWith('corrente_'))        return 'splc';
      if (c == 'temperatura')               return 'splc';
      if (c == 'abertura_porta')            return 'step';
      return 'splc';
    }

    // Médias âncora
    final mediaAntes = <String, double>{};
    final mediaDepois = <String, double>{};
    for (final c in camposNumericos) {
      mediaAntes[c]  = _mediaCampo(antes, c);
      mediaDepois[c] = _mediaCampo(depois, c);
    }

    final pontos = <Ponto>[];
    var confTotal = 0.0;
    final estrategiasUsadas = <String, String>{};
    final confsCampos = <String, double>{};

    for (var k = 1; k <= n; k++) {
      final t = tInicioMs + passoMs * k;
      final tDt = DateTime.fromMillisecondsSinceEpoch(t);
      final campos = <String, num?>{};
      var confPonto = 0.0;
      var nCampos = 0;

      for (final c in camposNumericos) {
        final est = estrategia(c);
        estrategiasUsadas[c] = est;
        double v; double conf;

        switch (est) {
          case 'media':
            v = (mediaAntes[c]! + mediaDepois[c]!) / 2;
            conf = 0.85;
            break;
          case 'step':
            v = ultimoAntes.lerNumero(c) ?? 0;
            conf = 0.95;
            break;
          case 'splc':
            final splc = _buscarSplc(historicoBase, tDt, c);
            if (splc != null) {
              v = splc.valor; conf = splc.confianca;
            } else {
              // fallback linear
              final frac = k / (n + 1);
              v = mediaAntes[c]! + frac * (mediaDepois[c]! - mediaAntes[c]!);
              conf = 0.55;
            }
            break;
          default:
            v = ultimoAntes.lerNumero(c) ?? 0;
            conf = 0.40;
        }

        campos[c] = v;
        confPonto += conf;
        nCampos++;
        confsCampos[c] = conf;
      }

      final confPontoFinal = nCampos == 0 ? 0.0 : confPonto / nCampos;
      pontos.add(Ponto(
        time: tDt,
        campos: campos,
        reconstruido: true,
        meta: PontoMeta(
          confianca: confPontoFinal,
          estrategiaPrincipal: estrategiasUsadas.values.first,
          camposEstrategia: estrategiasUsadas,
          camposConfianca: confsCampos,
          nAntes: antes.length,
          nDepois: depois.length,
          duracaoS: (n * passoMs / 1000),
          ciclosUsados: const ['24h', '7d'],
        ),
      ));
      confTotal += confPontoFinal;
    }

    final confiancaGap = pontos.isEmpty ? 0.0 : confTotal / pontos.length;
    final estrategiaPredominante = estrategiasUsadas.values.isEmpty
        ? '—'
        : estrategiasUsadas.values.first;
    return (
      pontos: pontos,
      resumo: GapResumo(
        inicio: pontos.first.time,
        fim: pontos.last.time,
        duracaoS: (n * passoMs) / 1000,
        nReconstruidos: pontos.length,
        confianca: confiancaGap,
        estrategiaPrincipal: estrategiaPredominante,
        ciclosUsados: const ['24h', '7d'],
      ),
    );
  }

  // ----------------------------------------------------------------

  double _mediaCampo(List<Ponto> ps, String c) {
    final vals = ps.map((p) => p.lerNumero(c)).whereType<double>().toList();
    if (vals.isEmpty) return 0;
    return vals.reduce((a, b) => a + b) / vals.length;
  }

  /// SPLC simplificado: procura pontos com o mesmo horário em ciclos
  /// 24h (D-1, D-2, …) e 7d (semana passada, etc.), pondera por proximidade.
  ({double valor, double confianca})? _buscarSplc(
    List<Ponto> historico, DateTime alvo, String campo,
  ) {
    if (historico.isEmpty) return null;
    const tolMin = 30;
    final valores = <_AmostraSplc>[];

    for (final ciclo in const [
      _Ciclo('24h', Duration(hours: 24),  0.5),
      _Ciclo('7d',  Duration(days: 7),    0.3),
      _Ciclo('30d', Duration(days: 30),   0.2),
    ]) {
      for (var multi = 1; multi <= 4; multi++) {
        final tRef = alvo.subtract(ciclo.intervalo * multi);
        Ponto? encontrado;
        var menorDiff = const Duration(minutes: 9999);
        for (final p in historico) {
          final diff = p.time.difference(tRef).abs();
          if (diff.inMinutes <= tolMin && diff < menorDiff) {
            menorDiff = diff;
            encontrado = p;
          }
        }
        if (encontrado != null) {
          final v = encontrado.lerNumero(campo);
          if (v != null) {
            valores.add(_AmostraSplc(v, ciclo.peso, ciclo.id));
          }
        }
      }
    }

    if (valores.isEmpty) return null;
    final pesoTotal = valores.fold<double>(0, (s, a) => s + a.peso);
    final vPond = valores.fold<double>(0, (s, a) => s + a.valor * a.peso) / pesoTotal;
    // Confiança = quantas amostras / max esperado (12 = 3 ciclos * 4 multi)
    final conf = (valores.length / 12.0).clamp(0.30, 0.95);
    return (valor: vPond, confianca: conf);
  }

  List<Ponto> _unirHistorico(List<Ponto> janela, List<Ponto> estendido) {
    final mapa = <int, Ponto>{};
    for (final p in estendido) mapa[p.time.millisecondsSinceEpoch] = p;
    for (final p in janela)    mapa[p.time.millisecondsSinceEpoch] = p; // janela tem prioridade
    final lista = mapa.values.toList()
      ..sort((a, b) => a.time.compareTo(b.time));
    return lista;
  }
}

class _Ciclo {
  const _Ciclo(this.id, this.intervalo, this.peso);
  final String id;
  final Duration intervalo;
  final double peso;
}

class _AmostraSplc {
  const _AmostraSplc(this.valor, this.peso, this.ciclo);
  final double valor;
  final double peso;
  final String ciclo;
}
