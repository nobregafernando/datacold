import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/theme.dart';
import '../auth/auth_repository.dart';

/// Placeholder do dashboard — confirma que o login funcionou.
/// Será substituído pela tela real no Fase 3.
class DashboardPlaceholder extends StatelessWidget {
  const DashboardPlaceholder({super.key});

  @override
  Widget build(BuildContext context) {
    final user = Supabase.instance.client.auth.currentUser;
    final nome = user?.userMetadata?['nome'] as String?
        ?? user?.email?.split('@').first
        ?? 'usuário';
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard · DataCold'),
        actions: [
          IconButton(
            tooltip: 'Sair',
            icon: const Icon(Icons.logout),
            onPressed: () async {
              await AuthRepository().sair();
              if (context.mounted) {
                // GoRouter detecta mudança de sessão e redireciona.
              }
            },
          ),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.check_circle, color: AppCores.ok, size: 64),
              const SizedBox(height: 16),
              Text('Login OK · sessão ativa',
                style: GoogleFonts.inter(
                  fontSize: 20, fontWeight: FontWeight.w700,
                  color: AppCores.azulNoite,
                ),
              ),
              const SizedBox(height: 8),
              Text('Olá, $nome',
                style: GoogleFonts.inter(
                  fontSize: 14, color: AppCores.textoSuave,
                ),
              ),
              const SizedBox(height: 24),
              Text(
                'Próximas fases: shell com drawer, dashboard com cards, '
                'sensores, sala de controle…',
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(
                  fontSize: 12, color: AppCores.textoSuave, height: 1.5,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
