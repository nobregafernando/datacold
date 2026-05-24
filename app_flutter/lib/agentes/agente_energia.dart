import 'dart:math' as math;

import '../data/models/ponto.dart';
import '../data/models/sensor.dart';
import 'agente_base.dart';
import 'normas.dart';
import 'regra.dart';
import 'veredito.dart';

/// Agente que cuida de sensores de energia trifásicos.
class AgenteEnergia extends AgenteBase {
  AgenteEnergia(Sensor sensor) : super(sensor);

  @override
  double get cadenciaSegundos => 30;

  @override
  Map<String, dynamic> contexto(List<Ponto> pontos) {
    final base = super.contexto(pontos);
    if (pontos.isEmpty) return base;
    final u = pontos.last;

    double fpComp() {
      final fa = (u.lerNumero('fator_potencia_a') ?? 0).abs();
      final fb = (u.lerNumero('fator_potencia_b') ?? 0).abs();
      final fc = (u.lerNumero('fator_potencia_c') ?? 0).abs();
      return (fa + fb + fc) / 3;
    }

    double mediaCorrente() {
      double s = 0; int n = 0;
      for (final p in pontos) {
        for (final c in const ['corrente_fase_a', 'corrente_fase_b', 'corrente_fase_c']) {
          final v = p.lerNumero(c);
          if (v != null) { s += v.abs(); n++; }
        }
      }
      return n == 0 ? 0 : s / n;
    }

    double cubPct() {
      final a = (u.lerNumero('corrente_fase_a') ?? 0).abs();
      final b = (u.lerNumero('corrente_fase_b') ?? 0).abs();
      final c = (u.lerNumero('corrente_fase_c') ?? 0).abs();
      final media = (a + b + c) / 3;
      if (media <= 0) return 0;
      final maxDesvio = [a, b, c].map((x) => (x - media).abs()).reduce(math.max);
      return (maxDesvio / media) * 100;
    }

    double vubPct() {
      final a = (u.lerNumero('tensao_fase_a') ?? 0).abs();
      final b = (u.lerNumero('tensao_fase_b') ?? 0).abs();
      final c = (u.lerNumero('tensao_fase_c') ?? 0).abs();
      final media = (a + b + c) / 3;
      if (media <= 0) return 0;
      final maxDesvio = [a, b, c].map((x) => (x - media).abs()).reduce(math.max);
      return (maxDesvio / media) * 100;
    }

    double potenciaAtual() {
      double p = 0;
      for (final f in const ['a', 'b', 'c']) {
        final t  = u.lerNumero('tensao_fase_$f')        ?? 0;
        final co = u.lerNumero('corrente_fase_$f')      ?? 0;
        final fp = u.lerNumero('fator_potencia_$f')     ?? 0;
        p += t * co * fp;
      }
      return p / 1000; // kW
    }

    return {
      ...base,
      'fp_composto':     fpComp(),
      'cub_pct':         cubPct(),
      'vub_pct':         vubPct(),
      'corrente_media':  mediaCorrente(),
      'potencia_kw':     potenciaAtual(),
      'fp_negativo':     (u.lerNumero('fator_potencia_a') ?? 0) < 0
                      || (u.lerNumero('fator_potencia_b') ?? 0) < 0
                      || (u.lerNumero('fator_potencia_c') ?? 0) < 0,
    };
  }

  @override
  List<Regra> get regras => _regras;

  static final _regras = [
    // --- FP composto ---
    Regra(
      id: 'fp-baixo', categoria: 'FP',
      label: 'O FP está dentro do limite ANEEL?',
      fonte: Normas.fpMinimo.fonte,
      parametros: {'limite_atencao': Normas.fpMinimo.valor, 'limite_critico': Normas.fpCritico.valor},
      avaliarFn: (ctx, p) {
        final fp = (ctx['fp_composto'] as num).toDouble();
        final atencao = (p['limite_atencao'] as num).toDouble();
        final critico = (p['limite_critico'] as num).toDouble();
        if (fp < critico) {
          return Veredito(id: 'fp-baixo', categoria: 'FP', label: 'O FP está dentro do limite ANEEL?',
            status: StatusVeredito.crit,
            resumo: 'FP=${fp.toStringAsFixed(2)}',
            detalhe: 'FP composto abaixo de $critico — concessionária multa.',
            diagnostico: 'Banco de capacitores queimado/desligado, motor sem correção. Multa ANEEL garantida.',
            valorMedido: fp, valorIdeal: atencao,
          );
        }
        if (fp < atencao) {
          return Veredito(id: 'fp-baixo', categoria: 'FP', label: 'O FP está dentro do limite ANEEL?',
            status: StatusVeredito.warn,
            resumo: 'FP=${fp.toStringAsFixed(2)}',
            detalhe: 'FP entre $critico e $atencao — atenção.',
            valorMedido: fp, valorIdeal: atencao,
          );
        }
        return Veredito(id: 'fp-baixo', categoria: 'FP', label: 'O FP está dentro do limite ANEEL?',
          status: StatusVeredito.ok,
          resumo: 'FP=${fp.toStringAsFixed(2)}',
          detalhe: 'Fator de potência saudável.',
          valorMedido: fp, valorIdeal: atencao,
        );
      },
    ),

    // --- Fluxo reverso ---
    Regra(
      id: 'fluxo-reverso', categoria: 'FP',
      label: 'Há fluxo reverso (FP negativo)?',
      avaliarFn: (ctx, p) {
        final neg = ctx['fp_negativo'] as bool;
        return Veredito(
          id: 'fluxo-reverso', categoria: 'FP',
          label: 'Há fluxo reverso (FP negativo)?',
          status: neg ? StatusVeredito.crit : StatusVeredito.ok,
          resumo: neg ? 'FP negativo' : 'Sem fluxo reverso',
          detalhe: neg
              ? 'Alguma fase com FP negativo — fiação do TC pode estar invertida.'
              : 'Todas as fases com FP positivo.',
          diagnostico: neg
              ? 'Verifique a polaridade dos transformadores de corrente.'
              : null,
        );
      },
    ),

    // --- Desequilíbrio de corrente (NEMA) ---
    Regra(
      id: 'desequilibrio-corrente', categoria: 'Desequilíbrio',
      label: 'As 3 fases puxam carga parecida?',
      fonte: Normas.cubCritico.fonte,
      parametros: {'atencao_pct': Normas.cubAtencao.valor, 'critico_pct': Normas.cubCritico.valor},
      avaliarFn: (ctx, p) {
        final cub = (ctx['cub_pct'] as num).toDouble();
        final at  = (p['atencao_pct'] as num).toDouble();
        final cr  = (p['critico_pct'] as num).toDouble();
        if (cub >= cr) {
          return Veredito(id: 'desequilibrio-corrente', categoria: 'Desequilíbrio',
            label: 'As 3 fases puxam carga parecida?',
            status: StatusVeredito.crit,
            resumo: '%CUB=${cub.toStringAsFixed(1)}%',
            detalhe: 'Desequilíbrio acima de $cr% — motor sofre.',
            diagnostico: 'Verifique distribuição de cargas entre as fases.',
            valorMedido: cub, valorIdeal: at,
          );
        }
        if (cub >= at) {
          return Veredito(id: 'desequilibrio-corrente', categoria: 'Desequilíbrio',
            label: 'As 3 fases puxam carga parecida?',
            status: StatusVeredito.warn,
            resumo: '%CUB=${cub.toStringAsFixed(1)}%',
            detalhe: '%CUB acima do ideal NEMA ($at%).',
            valorMedido: cub, valorIdeal: at,
          );
        }
        return Veredito(id: 'desequilibrio-corrente', categoria: 'Desequilíbrio',
          label: 'As 3 fases puxam carga parecida?',
          status: StatusVeredito.ok,
          resumo: '%CUB=${cub.toStringAsFixed(1)}%',
          detalhe: 'Fases equilibradas.',
          valorMedido: cub, valorIdeal: at,
        );
      },
    ),

    // --- Desequilíbrio de tensão ---
    Regra(
      id: 'desequilibrio-tensao', categoria: 'Tensão',
      label: '"Pressão elétrica" está balanceada?',
      fonte: Normas.vubMax.fonte,
      parametros: {'ideal_pct': Normas.vubIdeal.valor, 'max_pct': Normas.vubMax.valor},
      avaliarFn: (ctx, p) {
        final vub = (ctx['vub_pct'] as num).toDouble();
        final id  = (p['ideal_pct'] as num).toDouble();
        final mx  = (p['max_pct'] as num).toDouble();
        if (vub > mx) {
          return Veredito(id: 'desequilibrio-tensao', categoria: 'Tensão',
            label: '"Pressão elétrica" está balanceada?',
            status: StatusVeredito.crit,
            resumo: '%VUB=${vub.toStringAsFixed(2)}%',
            detalhe: 'Desequilíbrio de tensão acima de $mx%.',
            valorMedido: vub, valorIdeal: id,
          );
        }
        if (vub > id) {
          return Veredito(id: 'desequilibrio-tensao', categoria: 'Tensão',
            label: '"Pressão elétrica" está balanceada?',
            status: StatusVeredito.warn,
            resumo: '%VUB=${vub.toStringAsFixed(2)}%',
            detalhe: '%VUB entre $id% e $mx%.',
            valorMedido: vub, valorIdeal: id,
          );
        }
        return Veredito(id: 'desequilibrio-tensao', categoria: 'Tensão',
          label: '"Pressão elétrica" está balanceada?',
          status: StatusVeredito.ok,
          resumo: '%VUB=${vub.toStringAsFixed(2)}%',
          detalhe: 'Tensão balanceada.',
          valorMedido: vub, valorIdeal: id,
        );
      },
    ),

    // --- Potência atual (info) ---
    Regra(
      id: 'potencia-atual', categoria: 'Potência',
      label: 'Quanto de potência está sendo consumido agora?',
      avaliarFn: (ctx, p) {
        final kw = (ctx['potencia_kw'] as num).toDouble();
        return Veredito(
          id: 'potencia-atual', categoria: 'Potência',
          label: 'Quanto de potência está sendo consumido agora?',
          status: StatusVeredito.info,
          resumo: '${kw.toStringAsFixed(1)} kW',
          detalhe: 'Potência ativa total atual.',
          valorMedido: kw,
        );
      },
    ),
  ];
}
