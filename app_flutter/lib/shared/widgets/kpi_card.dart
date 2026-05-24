import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../core/theme.dart';

/// Card de KPI compacto — número grande no topo + label embaixo.
/// Variante opcional pra colorir conforme o tipo de KPI (ok/warn/crit).
class KpiCard extends StatelessWidget {
  const KpiCard({
    super.key,
    required this.valor,
    required this.rotulo,
    this.icone,
    this.cor,
  });

  final String valor;
  final String rotulo;
  final IconData? icone;
  final Color? cor;

  @override
  Widget build(BuildContext context) {
    final corLocal = cor ?? AppCores.azulMedio;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppCores.borda),
        boxShadow: [
          BoxShadow(
            color: AppCores.azulNoite.withValues(alpha: 0.04),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icone != null) ...[
            Container(
              padding: const EdgeInsets.all(7),
              decoration: BoxDecoration(
                color: corLocal.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(icone, size: 16, color: corLocal),
            ),
            const SizedBox(height: 10),
          ],
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              valor,
              style: GoogleFonts.inter(
                fontSize: 28,
                fontWeight: FontWeight.w800,
                color: AppCores.azulNoite,
                letterSpacing: -0.5,
                height: 1.0,
              ),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            rotulo,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: GoogleFonts.inter(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.6,
              color: AppCores.textoSuave,
            ),
          ),
        ],
      ),
    );
  }
}
