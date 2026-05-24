import 'dart:math' as math;

import '../data/models/ponto.dart';
import '../data/models/sensor.dart';
import 'agente_base.dart';
import 'normas.dart';
import 'regra.dart';
import 'veredito.dart';

class AgenteTemperatura extends AgenteBase {
  AgenteTemperatura(Sensor sensor) : super(sensor);

  @override
  double get cadenciaSegundos => 60;

  @override
  Map<String, dynamic> contexto(List<Ponto> pontos) {
    final base = super.contexto(pontos);
    if (pontos.isEmpty) return base;

    final valores = pontos
        .map((p) => p.lerNumero('temperatura'))
        .whereType<double>()
        .toList();

    double media() => valores.isEmpty ? 0 : valores.reduce((a, b) => a + b) / valores.length;
    double sigma() {
      if (valores.length < 2) return 0;
      final m = media();
      final sq = valores.map((v) => (v - m) * (v - m)).reduce((a, b) => a + b);
      return math.sqrt(sq / (valores.length - 1));
    }

    double tendenciaCH() {
      if (valores.length < 4) return 0;
      final n = valores.length;
      final metade = n ~/ 2;
      final m1 = valores.sublist(0, metade).reduce((a, b) => a + b) / metade;
      final m2 = valores.sublist(metade).reduce((a, b) => a + b) / (n - metade);
      final dt = pontos.last.time.difference(pontos.first.time).inSeconds / 3600;
      if (dt <= 0) return 0;
      return (m2 - m1) / dt;
    }

    final faixa = Normas.faixasAnvisa[sensor.grupo];
    int forenseFora() {
      if (faixa == null) return 0;
      return valores.where((v) => v < faixa.min || v > faixa.max).length;
    }

    final foraPct = valores.isEmpty ? 0 : (forenseFora() / valores.length) * 100;
    final ultima = pontos.last.lerNumero('temperatura');

    return {
      ...base,
      'temperatura_atual': ultima,
      'media': media(),
      'sigma': sigma(),
      'tendencia_c_h': tendenciaCH(),
      'fora_pct': foraPct,
      'faixa': faixa,
      'valores': valores,
    };
  }

  @override
  List<Regra> get regras => _regras;

  static final _regras = [
    // Leitura impossível (envelope físico)
    Regra(
      id: 'leitura-impossivel', categoria: 'Sensor',
      label: 'Leitura está fisicamente possível?',
      fonte: Normas.envelopeMin.fonte,
      parametros: {'envelope_min': Normas.envelopeMin.valor, 'envelope_max': Normas.envelopeMax.valor},
      avaliarFn: (ctx, p) {
        final t = ctx['temperatura_atual'] as double?;
        if (t == null) {
          return Veredito(id: 'leitura-impossivel', categoria: 'Sensor',
            label: 'Leitura está fisicamente possível?',
            status: StatusVeredito.info, resumo: 'Sem leitura', detalhe: '');
        }
        final mn = (p['envelope_min'] as num).toDouble();
        final mx = (p['envelope_max'] as num).toDouble();
        if (t < mn || t > mx) {
          return Veredito(id: 'leitura-impossivel', categoria: 'Sensor',
            label: 'Leitura está fisicamente possível?',
            status: StatusVeredito.crit,
            resumo: '${t.toStringAsFixed(1)}°C',
            detalhe: 'Fora do envelope físico ($mn°C – $mx°C).',
            diagnostico: 'Sensor com defeito ou desconectado.',
            valorMedido: t);
        }
        return Veredito(id: 'leitura-impossivel', categoria: 'Sensor',
          label: 'Leitura está fisicamente possível?',
          status: StatusVeredito.ok,
          resumo: '${t.toStringAsFixed(1)}°C',
          detalhe: 'Leitura dentro do envelope físico.',
          valorMedido: t);
      },
    ),

    // Fora da faixa ANVISA
    Regra(
      id: 'fora-da-faixa', categoria: 'Faixa',
      label: 'Sensor passa muito tempo fora da faixa?',
      fonte: 'ANVISA RDC 275',
      parametros: {'warn_pct': Normas.tempoForaWarnPct.valor, 'crit_pct': Normas.tempoForaCritPct.valor},
      avaliarFn: (ctx, p) {
        final faixa = ctx['faixa'];
        if (faixa == null) {
          return Veredito(id: 'fora-da-faixa', categoria: 'Faixa',
            label: 'Sensor passa muito tempo fora da faixa?',
            status: StatusVeredito.ok,
            resumo: 'Sem faixa controlada',
            detalhe: 'Sensor de ambiente — sem alvo.');
        }
        final pct = (ctx['fora_pct'] as num).toDouble();
        final w = (p['warn_pct'] as num).toDouble();
        final c = (p['crit_pct'] as num).toDouble();
        if (pct >= c) {
          return Veredito(id: 'fora-da-faixa', categoria: 'Faixa',
            label: 'Sensor passa muito tempo fora da faixa?',
            status: StatusVeredito.crit,
            resumo: '${pct.toStringAsFixed(1)}% fora',
            detalhe: '$pct% das leituras fora da faixa ANVISA.',
            valorMedido: pct, valorIdeal: w);
        }
        if (pct >= w) {
          return Veredito(id: 'fora-da-faixa', categoria: 'Faixa',
            label: 'Sensor passa muito tempo fora da faixa?',
            status: StatusVeredito.warn,
            resumo: '${pct.toStringAsFixed(1)}% fora',
            detalhe: 'Acima de $w% das leituras fora.',
            valorMedido: pct, valorIdeal: w);
        }
        return Veredito(id: 'fora-da-faixa', categoria: 'Faixa',
          label: 'Sensor passa muito tempo fora da faixa?',
          status: StatusVeredito.ok,
          resumo: '${pct.toStringAsFixed(1)}% fora',
          detalhe: 'Tempo na faixa OK.',
          valorMedido: pct, valorIdeal: w);
      },
    ),

    // Oscilação
    Regra(
      id: 'oscilacao', categoria: 'Estabilidade',
      label: 'Sensor está oscilando muito?',
      fonte: Normas.oscilacaoWarnSigma.fonte,
      parametros: {'warn_sigma': Normas.oscilacaoWarnSigma.valor},
      avaliarFn: (ctx, p) {
        final s = (ctx['sigma'] as num).toDouble();
        final w = (p['warn_sigma'] as num).toDouble();
        if (s > w) {
          return Veredito(id: 'oscilacao', categoria: 'Estabilidade',
            label: 'Sensor está oscilando muito?',
            status: StatusVeredito.warn,
            resumo: 'σ=${s.toStringAsFixed(2)}',
            detalhe: 'Oscilação acima de $w°C — compressor pode estar em short-cycling.',
            valorMedido: s, valorIdeal: w);
        }
        return Veredito(id: 'oscilacao', categoria: 'Estabilidade',
          label: 'Sensor está oscilando muito?',
          status: StatusVeredito.ok,
          resumo: 'σ=${s.toStringAsFixed(2)}',
          detalhe: 'Estabilidade ok.', valorMedido: s, valorIdeal: w);
      },
    ),

    // Tendência (drift)
    Regra(
      id: 'tendencia', categoria: 'Tendência',
      label: 'Temperatura está com drift?',
      fonte: Normas.tendenciaWarnCH.fonte,
      parametros: {'warn_c_h': Normas.tendenciaWarnCH.valor},
      avaliarFn: (ctx, p) {
        final d = (ctx['tendencia_c_h'] as num).toDouble();
        final w = (p['warn_c_h'] as num).toDouble();
        if (d.abs() > w) {
          return Veredito(id: 'tendencia', categoria: 'Tendência',
            label: 'Temperatura está com drift?',
            status: StatusVeredito.warn,
            resumo: '${d >= 0 ? '+' : ''}${d.toStringAsFixed(2)} °C/h',
            detalhe: 'Drift de ${d.toStringAsFixed(2)}°C/h — pode ser falha começando.',
            valorMedido: d, valorIdeal: w);
        }
        return Veredito(id: 'tendencia', categoria: 'Tendência',
          label: 'Temperatura está com drift?',
          status: StatusVeredito.ok,
          resumo: 'Estável',
          detalhe: 'Drift dentro do aceitável.',
          valorMedido: d, valorIdeal: w);
      },
    ),
  ];
}
