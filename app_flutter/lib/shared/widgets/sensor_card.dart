import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../core/theme.dart';
import '../../data/models/sensor.dart';
import 'sinal_bars.dart';

/// Card resumido de sensor — usado no dashboard e na lista.
/// Layout fixo previne overflow: ícone + nome + ambiente + barras + tag.
class SensorCard extends StatelessWidget {
  const SensorCard({
    super.key,
    required this.sensor,
    required this.nivelSaude,
    this.ambienteLabel,
    this.onTap,
  });

  final Sensor sensor;
  final int nivelSaude;          // 0..4
  final String? ambienteLabel;
  final VoidCallback? onTap;

  static const _coresTipo = {
    'energia':     Color(0xFF1E6FD6),
    'temperatura': Color(0xFF0A93C4),
    'porta':       Color(0xFF2A4EA0),
  };

  IconData _icone() => switch (sensor.tipo) {
        'energia'     => Icons.bolt_rounded,
        'temperatura' => Icons.thermostat_rounded,
        'porta'       => Icons.meeting_room_rounded,
        _             => Icons.sensors_rounded,
      };

  String _rotuloTipo() => switch (sensor.tipo) {
        'energia'     => 'Energia',
        'temperatura' => 'Temperatura',
        'porta'       => 'Porta',
        _             => sensor.tipo,
      };

  String _rotuloSaude() => switch (nivelSaude) {
        4 || 3 => 'Saudável',
        2      => 'Histórico',
        1      => 'Atenção',
        _      => 'Offline',
      };

  Color _corSaude() => switch (nivelSaude) {
        4 || 3 => AppCores.ok,
        2      => AppCores.alerta,
        1      => AppCores.erro,
        _      => AppCores.textoSuave,
      };

  @override
  Widget build(BuildContext context) {
    final corTipo = _coresTipo[sensor.tipo] ?? AppCores.azulMedio;
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(14),
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
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(7),
                  decoration: BoxDecoration(
                    color: corTipo.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(_icone(), size: 16, color: corTipo),
                ),
                const Spacer(),
                SinalBars(nivel: nivelSaude),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              sensor.rotulo,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: GoogleFonts.inter(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: AppCores.azulNoite,
                height: 1.25,
              ),
            ),
            const SizedBox(height: 4),
            if (ambienteLabel != null)
              Text(
                ambienteLabel!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: GoogleFonts.inter(
                  fontSize: 11.5,
                  color: AppCores.textoSuave,
                ),
              ),
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  _rotuloTipo(),
                  style: GoogleFonts.inter(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: AppCores.textoSuave,
                  ),
                ),
                Text(
                  _rotuloSaude(),
                  style: GoogleFonts.inter(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: _corSaude(),
                    letterSpacing: 0.2,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
