import '../data/models/ponto.dart';
import '../data/models/sensor.dart';
import 'agente_base.dart';
import 'normas.dart';
import 'regra.dart';
import 'veredito.dart';

class AgentePorta extends AgenteBase {
  AgentePorta(Sensor sensor) : super(sensor);

  @override
  double get cadenciaSegundos => 60;

  @override
  Map<String, dynamic> contexto(List<Ponto> pontos) {
    final base = super.contexto(pontos);
    if (pontos.isEmpty) return base;

    // Considera "aberta" se abertura_porta > 0
    int abertas = 0;
    int total = pontos.length;
    int transicoes = 0;
    bool? estadoPrev;
    double tempoMedioAbertaS = 0;
    double inicioAbertaS = -1;
    final tempos = <double>[];

    for (var i = 0; i < pontos.length; i++) {
      final v = pontos[i].lerNumero('abertura_porta') ?? 0;
      final aberta = v > 0;
      if (aberta) abertas++;
      if (estadoPrev != null && estadoPrev != aberta) {
        transicoes++;
        // calcular duração da abertura anterior
        if (estadoPrev == true && inicioAbertaS >= 0) {
          final dur = pontos[i].time.difference(pontos[i - 1].time).inSeconds.toDouble();
          tempos.add(dur);
        }
      }
      if (aberta && estadoPrev != true) inicioAbertaS = pontos[i].time.millisecondsSinceEpoch / 1000;
      estadoPrev = aberta;
    }
    if (tempos.isNotEmpty) {
      tempoMedioAbertaS = tempos.reduce((a, b) => a + b) / tempos.length;
    }
    final fracaoAbertaPct = total == 0 ? 0 : (abertas / total) * 100;
    final ultimaAberta = (pontos.last.lerNumero('abertura_porta') ?? 0) > 0;

    // Mudança evolutiva (% aberturas 1ª vs 2ª metade)
    double mudancaPct = 0;
    if (pontos.length >= 8) {
      final metade = pontos.length ~/ 2;
      int t1 = 0, t2 = 0;
      bool? prev1, prev2;
      for (var i = 0; i < metade; i++) {
        final a = (pontos[i].lerNumero('abertura_porta') ?? 0) > 0;
        if (prev1 != null && prev1 != a && a) t1++;
        prev1 = a;
      }
      for (var i = metade; i < pontos.length; i++) {
        final a = (pontos[i].lerNumero('abertura_porta') ?? 0) > 0;
        if (prev2 != null && prev2 != a && a) t2++;
        prev2 = a;
      }
      if (t1 > 0) mudancaPct = ((t2 - t1) / t1).abs() * 100;
    }

    return {
      ...base,
      'aberturas_count': transicoes ~/ 2,
      'fracao_aberta_pct': fracaoAbertaPct,
      'tempo_medio_aberta_s': tempoMedioAbertaS,
      'ultima_aberta': ultimaAberta,
      'mudanca_pct': mudancaPct,
    };
  }

  @override
  List<Regra> get regras => _regras;

  static final _regras = [
    // Porta esquecida (1 abertura muito longa)
    Regra(
      id: 'porta-esquecida', categoria: 'Operacional',
      label: 'Alguma abertura ficou esquecida?',
      fonte: Normas.portaEsquecidaS.fonte,
      parametros: {'esquecida_s': Normas.portaEsquecidaS.valor},
      avaliarFn: (ctx, p) {
        final tm = (ctx['tempo_medio_aberta_s'] as num).toDouble();
        final lim = (p['esquecida_s'] as num).toDouble();
        if (tm > lim) {
          return Veredito(id: 'porta-esquecida', categoria: 'Operacional',
            label: 'Alguma abertura ficou esquecida?',
            status: StatusVeredito.crit,
            resumo: '${(tm / 60).toStringAsFixed(1)} min',
            detalhe: 'Tempo médio de abertura acima de ${(lim/60).round()} min.',
            diagnostico: 'Porta esquecida aberta — perda massiva de frio.',
            valorMedido: tm, valorIdeal: lim);
        }
        return Veredito(id: 'porta-esquecida', categoria: 'Operacional',
          label: 'Alguma abertura ficou esquecida?',
          status: StatusVeredito.ok,
          resumo: '${(tm / 60).toStringAsFixed(1)} min',
          detalhe: 'Sem aberturas muito longas.',
          valorMedido: tm, valorIdeal: lim);
      },
    ),

    // Tempo médio por abertura
    Regra(
      id: 'tempo-medio-alto', categoria: 'Operacional',
      label: 'Tempo médio por abertura está alto?',
      fonte: Normas.portaTempoMedioWarn.fonte,
      parametros: {'warn_s': Normas.portaTempoMedioWarn.valor},
      avaliarFn: (ctx, p) {
        final tm = (ctx['tempo_medio_aberta_s'] as num).toDouble();
        final w  = (p['warn_s'] as num).toDouble();
        if (tm > w) {
          return Veredito(id: 'tempo-medio-alto', categoria: 'Operacional',
            label: 'Tempo médio por abertura está alto?',
            status: StatusVeredito.warn,
            resumo: '${tm.toStringAsFixed(0)}s',
            detalhe: 'Cada abertura dura demais — vedação ou pessoal demorando.',
            valorMedido: tm, valorIdeal: w);
        }
        return Veredito(id: 'tempo-medio-alto', categoria: 'Operacional',
          label: 'Tempo médio por abertura está alto?',
          status: StatusVeredito.ok,
          resumo: '${tm.toStringAsFixed(0)}s',
          detalhe: 'Tempo médio aceitável.',
          valorMedido: tm, valorIdeal: w);
      },
    ),

    // Estado atual (info)
    Regra(
      id: 'estado-atual', categoria: 'Estado',
      label: 'Porta está aberta ou fechada agora?',
      avaliarFn: (ctx, p) {
        final aberta = ctx['ultima_aberta'] as bool;
        return Veredito(id: 'estado-atual', categoria: 'Estado',
          label: 'Porta está aberta ou fechada agora?',
          status: aberta ? StatusVeredito.warn : StatusVeredito.ok,
          resumo: aberta ? 'ABERTA' : 'FECHADA',
          detalhe: aberta ? 'Frio escapando — fechar logo.' : 'Câmara vedada.');
      },
    ),

    // Mudança evolutiva
    Regra(
      id: 'padrao-evolutivo', categoria: 'Padrão',
      label: 'O padrão de uso mudou na janela?',
      fonte: Normas.portaMudancaPct.fonte,
      parametros: {'mudanca_pct': Normas.portaMudancaPct.valor},
      avaliarFn: (ctx, p) {
        final m = (ctx['mudanca_pct'] as num).toDouble();
        final lim = (p['mudanca_pct'] as num).toDouble();
        if (m > lim) {
          return Veredito(id: 'padrao-evolutivo', categoria: 'Padrão',
            label: 'O padrão de uso mudou na janela?',
            status: StatusVeredito.info,
            resumo: '+${m.toStringAsFixed(0)}%',
            detalhe: 'Mudança grande entre 1ª e 2ª metade — turno novo ou degradação.',
            valorMedido: m, valorIdeal: lim);
        }
        return Veredito(id: 'padrao-evolutivo', categoria: 'Padrão',
          label: 'O padrão de uso mudou na janela?',
          status: StatusVeredito.ok,
          resumo: '${m.toStringAsFixed(0)}%',
          detalhe: 'Padrão estável.',
          valorMedido: m, valorIdeal: lim);
      },
    ),
  ];
}
