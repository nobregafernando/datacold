import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/theme.dart';
import 'empty_state.dart';
import 'section_card.dart';

/// Tela placeholder estilizada — mostra título, descrição e uma lista de
/// "o que vai ter aqui" em formato de checklist. Substituível por tela
/// real conforme as features forem implementadas.
class StubScreen extends StatelessWidget {
  const StubScreen({
    super.key,
    required this.titulo,
    required this.descricao,
    required this.icone,
    this.corIcone,
    this.checklist = const [],
  });

  final String titulo;
  final String descricao;
  final IconData icone;
  final Color? corIcone;
  final List<String> checklist;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text(
          titulo,
          style: GoogleFonts.inter(
            fontSize: 22, fontWeight: FontWeight.w800,
            color: AppCores.azulNoite, letterSpacing: -0.4,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          descricao,
          style: GoogleFonts.inter(
            fontSize: 13.5, color: AppCores.textoSuave, height: 1.5,
          ),
        ),
        const SizedBox(height: 24),
        SectionCard(
          titulo: 'Tela em construção',
          icone: icone,
          corIcone: corIcone,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              EmptyState(
                icone: icone,
                titulo: 'Esta tela está sendo construída',
                descricao: 'A versão web já está completa e funcionando. '
                    'A versão mobile chega numa próxima rodada.',
              ),
              if (checklist.isNotEmpty) ...[
                const SizedBox(height: 8),
                const Divider(color: AppCores.borda),
                const SizedBox(height: 12),
                Text(
                  'O QUE VAI TER AQUI',
                  style: GoogleFonts.inter(
                    fontSize: 10.5, fontWeight: FontWeight.w800,
                    color: AppCores.textoSuave, letterSpacing: 1.4,
                  ),
                ),
                const SizedBox(height: 8),
                ...checklist.map((s) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.check_circle_outline,
                          size: 16, color: AppCores.azulMedio),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          s,
                          style: GoogleFonts.inter(
                            fontSize: 12.5, color: AppCores.texto, height: 1.5,
                          ),
                        ),
                      ),
                    ],
                  ),
                )),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
