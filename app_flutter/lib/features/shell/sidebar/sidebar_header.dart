import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../core/supabase_config.dart';
import '../../../core/theme.dart';

/// Topo do sidebar — logo + linha de usuário (avatar + nome + papel).
/// `compacto = true` esconde texto e mostra só o avatar (sidebar colapsado).
class SidebarHeader extends StatelessWidget {
  const SidebarHeader({super.key, this.compacto = false});
  final bool compacto;

  String _papelLabel(String? p) {
    if (p == 'admin') return 'Administrador';
    if (p == 'operador') return 'Operador';
    return p ?? '—';
  }

  String _iniciais(String s) {
    final partes = s.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (partes.isEmpty) return '?';
    if (partes.length == 1) return partes.first.substring(0, 1).toUpperCase();
    return (partes.first.substring(0, 1) + partes.last.substring(0, 1)).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final user = Supabase.instance.client.auth.currentUser;
    final meta = user?.userMetadata ?? const {};
    final nome = (meta['nome'] as String?) ?? (user?.email?.split('@').first ?? 'Usuário');
    final email = user?.email ?? '';
    final papel = _papelLabel(meta['papel'] as String?);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(
            compacto ? 14 : 18, 16, compacto ? 14 : 18, 14,
          ),
          child: compacto
              ? Center(
                  child: Image.network(
                    SupabaseConfig.brandingUrl('04-icon-standalone.png'),
                    height: 28,
                    errorBuilder: (_, __, ___) =>
                        const Icon(Icons.ac_unit, color: AppCores.azulMedio, size: 22),
                  ),
                )
              : Image.network(
                  SupabaseConfig.brandingUrl('01-primary-logo.png'),
                  height: 28,
                  errorBuilder: (_, __, ___) => Text(
                    'DataCold',
                    style: GoogleFonts.inter(
                      fontSize: 18, fontWeight: FontWeight.w800,
                      color: AppCores.azulNoite, letterSpacing: -0.3,
                    ),
                  ),
                ),
        ),
        const Divider(height: 1, color: AppCores.borda),
        Padding(
          padding: EdgeInsets.symmetric(
            horizontal: compacto ? 8 : 14,
            vertical: 12,
          ),
          child: compacto
              ? Center(child: _Avatar(iniciais: _iniciais(nome)))
              : Row(
                  children: [
                    _Avatar(iniciais: _iniciais(nome)),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            nome,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: GoogleFonts.inter(
                              fontSize: 12.5, fontWeight: FontWeight.w700,
                              color: AppCores.azulNoite, height: 1.2,
                            ),
                          ),
                          Text(
                            email,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: GoogleFonts.jetBrainsMono(
                              fontSize: 10.5, color: AppCores.textoSuave,
                              height: 1.3,
                            ),
                          ),
                          const SizedBox(height: 3),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppCores.azulGelo,
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              papel,
                              style: GoogleFonts.inter(
                                fontSize: 9.5, fontWeight: FontWeight.w700,
                                letterSpacing: 0.4, color: AppCores.azulProfundo,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
        ),
        const Divider(height: 1, color: AppCores.borda),
      ],
    );
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.iniciais});
  final String iniciais;
  @override
  Widget build(BuildContext context) {
    return Container(
      width: 34, height: 34,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        gradient: AppCores.gradVibrante,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: AppCores.ciano.withValues(alpha: 0.30),
            blurRadius: 8, offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Text(
        iniciais,
        style: GoogleFonts.inter(
          fontSize: 13, fontWeight: FontWeight.w800, color: Colors.white,
        ),
      ),
    );
  }
}
