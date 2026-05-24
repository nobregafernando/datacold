import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../core/theme.dart';

/// Estado vazio padrão (ícone + título + descrição opcional + ação opcional).
class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.titulo,
    this.descricao,
    this.icone = Icons.inbox_outlined,
    this.acao,
  });

  final String titulo;
  final String? descricao;
  final IconData icone;
  final Widget? acao;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 360),
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: AppCores.azulGelo,
                  shape: BoxShape.circle,
                ),
                child: Icon(icone, size: 36, color: AppCores.azulMedio),
              ),
              const SizedBox(height: 18),
              Text(
                titulo,
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: AppCores.azulNoite,
                ),
              ),
              if (descricao != null) ...[
                const SizedBox(height: 6),
                Text(
                  descricao!,
                  textAlign: TextAlign.center,
                  style: GoogleFonts.inter(
                    fontSize: 13, color: AppCores.textoSuave, height: 1.5,
                  ),
                ),
              ],
              if (acao != null) ...[
                const SizedBox(height: 18),
                acao!,
              ],
            ],
          ),
        ),
      ),
    );
  }
}
