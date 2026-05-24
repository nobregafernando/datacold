import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../../core/theme.dart';
import '../nav_items.dart';

/// Tile de navegação do sidebar.
/// `compacto=true` mostra só ícone (sidebar colapsado).
/// Quando ativo, ganha faixa lateral azul 3px + fundo translúcido.
class NavTile extends StatelessWidget {
  const NavTile({
    super.key,
    required this.item,
    required this.ativo,
    this.compacto = false,
    this.onTap,
  });

  final NavItem item;
  final bool ativo;
  final bool compacto;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: () {
          context.go(item.path);
          onTap?.call();
        },
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 2),
          padding: EdgeInsets.symmetric(
            horizontal: compacto ? 8 : 12,
            vertical: 10,
          ),
          decoration: BoxDecoration(
            color: ativo ? AppCores.azulMedio.withValues(alpha: 0.10) : null,
            borderRadius: BorderRadius.circular(10),
            border: Border(
              left: BorderSide(
                color: ativo ? AppCores.azulMedio : Colors.transparent,
                width: 3,
              ),
            ),
          ),
          child: compacto
              ? Tooltip(
                  message: item.label,
                  child: Icon(
                    item.icon,
                    size: 20,
                    color: ativo ? AppCores.azulMedio : AppCores.textoSuave,
                  ),
                )
              : Row(
                  children: [
                    Icon(
                      item.icon,
                      size: 18,
                      color: ativo ? AppCores.azulMedio : AppCores.textoSuave,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        item.label,
                        overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.inter(
                          fontSize: 13,
                          fontWeight: ativo ? FontWeight.w700 : FontWeight.w500,
                          color: ativo ? AppCores.azulProfundo : AppCores.texto,
                        ),
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}
