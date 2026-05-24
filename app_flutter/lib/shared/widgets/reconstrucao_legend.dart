import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../agentes/agente_reconstrutor.dart';
import '../../core/theme.dart';

/// Badge informativo acima do gráfico, mostrando contagem de pontos
/// reconstruídos, confiança média e método dominante.
class ReconstrucaoLegend extends StatelessWidget {
  const ReconstrucaoLegend({super.key, required this.resultado});
  final ResultadoReconstrucao resultado;

  @override
  Widget build(BuildContext context) {
    final n = resultado.nReconstruidos;
    final v = resultado.nVazios;
    if (n == 0 && v == 0) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFF7F3FF),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFFD9CFFF)),
      ),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 12, runSpacing: 4,
        children: [
          if (n > 0) ...[
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('🧩 ', style: TextStyle(fontSize: 14)),
                Text(
                  '$n pontos reconstruídos',
                  style: GoogleFonts.inter(
                    fontSize: 12, fontWeight: FontWeight.w700,
                    color: const Color(0xFF6B3EB8),
                  ),
                ),
              ],
            ),
            _separador(),
            Text(
              'método: ${resultado.metodoDominante}',
              style: GoogleFonts.inter(
                fontSize: 11.5, color: const Color(0xFF6B3EB8),
              ),
            ),
            _separador(),
            Text(
              'confiança ${(resultado.confianciaMedia * 100).round()}%',
              style: GoogleFonts.inter(
                fontSize: 11.5, fontWeight: FontWeight.w700,
                color: const Color(0xFF6B3EB8),
              ),
            ),
          ],
          if (v > 0) ...[
            if (n > 0) _separador(),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('📡 ', style: TextStyle(fontSize: 14)),
                Text(
                  '$v pontos sem sinal (ao vivo)',
                  style: GoogleFonts.inter(
                    fontSize: 12, fontWeight: FontWeight.w700,
                    color: AppCores.erro,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _separador() => Container(
        width: 1, height: 12,
        margin: const EdgeInsets.symmetric(horizontal: 2),
        color: const Color(0xFFD9CFFF),
      );
}
