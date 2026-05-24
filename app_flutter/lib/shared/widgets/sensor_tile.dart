import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/theme.dart';
import '../../data/models/sensor.dart';
import 'sinal_bars.dart';

/// Tile denso de sensor (~92 px de altura) — versão compacta do
/// SensorCard, pensada pro layout bento "Mapa da planta".
///
/// L1: ícone do tipo · bolinha de status · nome
/// L2: ambiente em ellipsis · barras de sinal · rótulo de saúde
/// Borda lateral esquerda colorida pelo ambiente (organização visual).
class SensorTile extends StatelessWidget {
  const SensorTile({
    super.key,
    required this.sensor,
    required this.nivelSaude,
    this.ambienteLabel,
    this.ambienteCor,
    this.onTap,
  });

  final Sensor sensor;
  final int nivelSaude;
  final String? ambienteLabel;
  final Color? ambienteCor;
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

  Color _corBolinha() => switch (nivelSaude) {
        4 || 3 => AppCores.ok,
        2      => AppCores.alerta,
        1      => AppCores.erro,
        _      => AppCores.textoSuave,
      };

  String _rotuloSaude() => switch (nivelSaude) {
        4 || 3 => 'Saudável',
        2      => 'Histórico',
        1      => 'Atenção',
        _      => 'Offline',
      };

  @override
  Widget build(BuildContext context) {
    final corTipo = _coresTipo[sensor.tipo] ?? AppCores.azulMedio;
    final corBolinha = _corBolinha();
    final corBordaEsq = ambienteCor ?? corTipo;

    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(11),
      child: InkWell(
        borderRadius: BorderRadius.circular(11),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.fromLTRB(11, 10, 11, 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(11),
            border: Border(
              top:    const BorderSide(color: AppCores.borda),
              right:  const BorderSide(color: AppCores.borda),
              bottom: const BorderSide(color: AppCores.borda),
              left:   BorderSide(color: corBordaEsq, width: 3),
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 24, height: 24,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: corTipo.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Icon(_icone(), size: 14, color: corTipo),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    width: 8, height: 8,
                    decoration: BoxDecoration(
                      color: corBolinha,
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: corBolinha.withValues(alpha: 0.40),
                          blurRadius: 4, spreadRadius: 0.5,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      sensor.rotulo,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: GoogleFonts.inter(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppCores.azulNoite,
                        height: 1.2,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      ambienteLabel ?? sensor.grupo,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: GoogleFonts.inter(
                        fontSize: 11, color: AppCores.textoSuave,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  SinalBars(nivel: nivelSaude, altura: 11),
                  const SizedBox(width: 8),
                  Text(
                    _rotuloSaude(),
                    style: GoogleFonts.inter(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                      color: corBolinha,
                      letterSpacing: 0.2,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
