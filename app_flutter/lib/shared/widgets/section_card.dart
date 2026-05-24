import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../core/theme.dart';

/// Card padrão pra agrupar conteúdo: título + opcional subtítulo + body.
/// Usa LayoutBuilder-friendly (sem altura fixa) e dá flex pro corpo.
class SectionCard extends StatelessWidget {
  const SectionCard({
    super.key,
    this.titulo,
    this.subtitulo,
    this.acao,
    this.icone,
    this.corIcone,
    required this.child,
    this.padding = const EdgeInsets.fromLTRB(20, 18, 20, 20),
  });

  final String? titulo;
  final String? subtitulo;
  final Widget? acao;
  final IconData? icone;
  final Color? corIcone;
  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppCores.borda),
        boxShadow: [
          BoxShadow(
            color: AppCores.azulNoite.withValues(alpha: 0.04),
            blurRadius: 18,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Padding(
        padding: padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (titulo != null) ...[
              Row(
                children: [
                  if (icone != null) ...[
                    Container(
                      padding: const EdgeInsets.all(7),
                      decoration: BoxDecoration(
                        color: (corIcone ?? AppCores.azulMedio).withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Icon(icone, size: 16, color: corIcone ?? AppCores.azulMedio),
                    ),
                    const SizedBox(width: 10),
                  ],
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          titulo!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: GoogleFonts.inter(
                            fontSize: 14.5,
                            fontWeight: FontWeight.w700,
                            color: AppCores.azulNoite,
                          ),
                        ),
                        if (subtitulo != null)
                          Text(
                            subtitulo!,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: GoogleFonts.inter(
                              fontSize: 11.5,
                              color: AppCores.textoSuave,
                            ),
                          ),
                      ],
                    ),
                  ),
                  if (acao != null) acao!,
                ],
              ),
              const SizedBox(height: 14),
            ],
            child,
          ],
        ),
      ),
    );
  }
}
