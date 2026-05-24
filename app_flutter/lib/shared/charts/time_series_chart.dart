import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';

import '../../core/theme.dart';
import '../../data/models/ponto.dart';
import '../../data/models/ponto_meta.dart';

/// Gráfico de série temporal com 3 datasets paralelos:
///   1. REAL: linha sólida cor original
///   2. RECONSTRUÍDO: linha roxa tracejada (#7C3AED) com tooltip rico
///   3. VAZIO: linha vermelha pontilhada no zero (gap em curso)
///
/// O fl_chart segmenta automaticamente onde os valores são null.
/// As séries são geradas por _split() — pontos não pertencentes à série
/// recebem null naquele índice.
///
/// Tooltip customizado: nos pontos roxos mostra "🧩 PONTO RECONSTRUÍDO"
/// + confiança · gap · estratégia por campo.
class TimeSeriesChart extends StatelessWidget {
  const TimeSeriesChart({
    super.key,
    required this.pontos,
    required this.campo,
    required this.titulo,
    this.unidade = '',
    this.corPrincipal = AppCores.azulMedio,
    this.altura = 240,
    this.fill = true,
  });

  final List<Ponto> pontos;
  final String campo;             // nome do campo (ex: 'temperatura', 'corrente_fase_a')
  final String titulo;
  final String unidade;
  final Color corPrincipal;
  final double altura;
  final bool fill;

  static const _corReconstruido = Color(0xFF7C3AED);   // roxo
  static const _corVazio        = Color(0xFFDC2626);   // vermelho

  @override
  Widget build(BuildContext context) {
    if (pontos.isEmpty) {
      return SizedBox(
        height: altura,
        child: Center(
          child: Text('Sem dados',
            style: GoogleFonts.inter(fontSize: 12, color: AppCores.textoSuave),
          ),
        ),
      );
    }

    // Constrói os 3 datasets em paralelo
    final dsReal = <FlSpot>[];
    final dsRecon = <FlSpot>[];
    final dsVazio = <FlSpot>[];
    double minY = double.infinity, maxY = double.negativeInfinity;
    for (var i = 0; i < pontos.length; i++) {
      final p = pontos[i];
      final v = p.lerNumero(campo);
      final x = i.toDouble();
      if (v != null) {
        minY = v < minY ? v : minY;
        maxY = v > maxY ? v : maxY;
      }
      if (p.reconstruido) {
        if (v != null) dsRecon.add(FlSpot(x, v));
        // bridge: ponto vizinho real entra TAMBÉM na série roxa pra "encostar"
      } else if (p.vazio) {
        dsVazio.add(FlSpot(x, v?.toDouble() ?? 0));
      } else {
        if (v != null) dsReal.add(FlSpot(x, v));
        // Bridge nos vizinhos de reconstruído
        final temVizRec = (i > 0 && pontos[i - 1].reconstruido)
                       || (i < pontos.length - 1 && pontos[i + 1].reconstruido);
        if (temVizRec && v != null) dsRecon.add(FlSpot(x, v));
        // Bridge nos vizinhos de vazio
        final temVizVazio = (i > 0 && pontos[i - 1].vazio)
                         || (i < pontos.length - 1 && pontos[i + 1].vazio);
        if (temVizVazio && v != null) dsVazio.add(FlSpot(x, v));
      }
    }
    if (minY == double.infinity) { minY = 0; maxY = 1; }
    if (minY == maxY) { minY -= 1; maxY += 1; }
    final pad = (maxY - minY) * 0.08;
    minY -= pad; maxY += pad;
    if (dsVazio.isNotEmpty && minY > 0) minY = -pad;  // garante que zero aparece

    final bars = <LineChartBarData>[
      // 1. REAL
      LineChartBarData(
        spots: dsReal,
        color: corPrincipal,
        barWidth: 2.4,
        isCurved: true,
        curveSmoothness: 0.2,
        dotData: const FlDotData(show: false),
        belowBarData: fill
            ? BarAreaData(
                show: true,
                gradient: LinearGradient(
                  begin: Alignment.topCenter, end: Alignment.bottomCenter,
                  colors: [
                    corPrincipal.withValues(alpha: 0.32),
                    corPrincipal.withValues(alpha: 0.04),
                  ],
                ),
              )
            : BarAreaData(show: false),
      ),
      // 2. RECONSTRUÍDO (roxo tracejado)
      if (dsRecon.isNotEmpty)
        LineChartBarData(
          spots: dsRecon,
          color: _corReconstruido,
          barWidth: 2.4,
          isCurved: true,
          curveSmoothness: 0.2,
          dashArray: const [6, 4],
          dotData: FlDotData(
            show: true,
            getDotPainter: (spot, _, __, ___) => FlDotCirclePainter(
              radius: 2.6,
              color: _corReconstruido,
              strokeColor: Colors.white,
              strokeWidth: 1.2,
            ),
            checkToShowDot: (s, _) {
              // Só desenha bolinha se o ponto na série é realmente reconstruído
              final i = s.x.toInt();
              return i >= 0 && i < pontos.length && pontos[i].reconstruido;
            },
          ),
        ),
      // 3. VAZIO (vermelho pontilhado no zero, gap ao vivo)
      if (dsVazio.isNotEmpty)
        LineChartBarData(
          spots: dsVazio,
          color: _corVazio.withValues(alpha: 0.85),
          barWidth: 2,
          isCurved: false,
          dashArray: const [3, 4],
          dotData: const FlDotData(show: false),
        ),
    ];

    return SizedBox(
      height: altura,
      child: LineChart(
        LineChartData(
          minY: minY,
          maxY: maxY,
          gridData: FlGridData(
            show: true,
            drawVerticalLine: false,
            getDrawingHorizontalLine: (_) => const FlLine(
              color: Color(0xFFF1F4F9), strokeWidth: 1,
            ),
          ),
          titlesData: FlTitlesData(
            topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            leftTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true, reservedSize: 40,
                getTitlesWidget: (v, _) => Text(
                  v.toStringAsFixed(unidade == '°C' || unidade == '' ? 1 : 0),
                  style: GoogleFonts.inter(
                    fontSize: 10, color: const Color(0xFF8B95A8),
                  ),
                ),
              ),
            ),
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true, reservedSize: 26,
                interval: (pontos.length / 6).clamp(1, 1000).toDouble(),
                getTitlesWidget: (v, _) {
                  final i = v.toInt();
                  if (i < 0 || i >= pontos.length) return const SizedBox();
                  return Text(
                    DateFormat('HH:mm').format(pontos[i].time),
                    style: GoogleFonts.inter(
                      fontSize: 10, color: const Color(0xFF8B95A8),
                    ),
                  );
                },
              ),
            ),
          ),
          borderData: FlBorderData(
            show: true,
            border: const Border(
              bottom: BorderSide(color: Color(0xFFE6EBF3)),
              left:   BorderSide(color: Color(0xFFE6EBF3)),
            ),
          ),
          lineTouchData: LineTouchData(
            handleBuiltInTouches: true,
            touchTooltipData: LineTouchTooltipData(
              getTooltipColor: (_) => AppCores.azulNoite.withValues(alpha: 0.95),
              tooltipBorderRadius: BorderRadius.circular(8),
              tooltipPadding: const EdgeInsets.all(10),
              getTooltipItems: (spots) => spots.map((s) {
                final i = s.x.toInt();
                if (i < 0 || i >= pontos.length) return null;
                final p = pontos[i];
                final hora = DateFormat('HH:mm:ss').format(p.time);
                final valor = '${s.y.toStringAsFixed(2)}${unidade.isEmpty ? "" : " $unidade"}';
                if (p.reconstruido) {
                  final m = p.meta as PontoMeta?;
                  final conf = m == null ? '—' : '${(m.confianca * 100).round()}%';
                  final dur = m == null ? '—' :
                    (m.duracaoS < 60 ? '${m.duracaoS.round()}s'
                     : m.duracaoS < 3600 ? '${(m.duracaoS / 60).round()} min'
                     : '${(m.duracaoS / 3600).toStringAsFixed(1)}h');
                  return LineTooltipItem(
                    '🧩 RECONSTRUÍDO · $hora\n'
                    '$valor\n'
                    'Confiança $conf · Gap $dur\n'
                    'Estratégia: ${m?.estrategiaPrincipal ?? "—"}',
                    GoogleFonts.inter(
                      fontSize: 11, color: Colors.white,
                      fontWeight: FontWeight.w600,
                    ),
                  );
                }
                if (p.vazio) {
                  return LineTooltipItem(
                    '📡 SEM SINAL · $hora\n'
                    'Gap em curso',
                    GoogleFonts.inter(
                      fontSize: 11, color: Colors.white,
                      fontWeight: FontWeight.w600,
                    ),
                  );
                }
                return LineTooltipItem(
                  '$hora\n$valor',
                  GoogleFonts.inter(
                    fontSize: 11, color: Colors.white,
                    fontWeight: FontWeight.w600,
                  ),
                );
              }).whereType<LineTooltipItem>().toList(),
            ),
          ),
          lineBarsData: bars,
        ),
      ),
    );
  }
}
