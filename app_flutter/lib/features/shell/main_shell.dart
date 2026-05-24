import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/supabase_config.dart';
import '../../core/theme.dart';
import '../auth/auth_repository.dart';
import 'nav_items.dart';

/// Shell principal — sidebar (NavigationRail >= 900px / Drawer < 900px),
/// AppBar fina com título da página + sino + avatar, e o conteúdo
/// rolável da rota atual.
///
/// Anti-overflow: o body usa SafeArea + a página dentro decide sua própria
/// rolagem (SingleChildScrollView etc.). O Shell nunca empurra altura
/// fixa nem força layout que estoure.
class MainShell extends StatelessWidget {
  const MainShell({super.key, required this.child});
  final Widget child;

  static const _breakpoint = 900.0;

  @override
  Widget build(BuildContext context) {
    final user = Supabase.instance.client.auth.currentUser;
    // Papel vem do metadata; por enquanto trato todo logado como "admin"
    // pra liberar tudo. Quando o seed de auth puser papel real, troco aqui.
    final ehAdmin = (user?.userMetadata?['papel'] ?? 'admin') == 'admin';
    final itens = NavItems.paraPapel(admin: ehAdmin);

    final loc = GoRouterState.of(context).matchedLocation;
    final atual = itens.indexWhere((i) => loc.startsWith(i.path));
    final indiceAtual = atual >= 0 ? atual : 0;
    final tituloAtual = atual >= 0 ? itens[atual].label : 'DataCold';

    return LayoutBuilder(
      builder: (context, c) {
        final largo = c.maxWidth >= _breakpoint;
        return Scaffold(
          backgroundColor: const Color(0xFFFAFCFF),
          drawer: largo ? null : _Drawer(itens: itens, indiceAtual: indiceAtual),
          appBar: _TopBar(titulo: tituloAtual, mostrarMenuBotao: !largo),
          body: SafeArea(
            top: false,
            child: largo
                ? Row(
                    children: [
                      _RailNav(itens: itens, indiceAtual: indiceAtual),
                      const VerticalDivider(width: 1, thickness: 1, color: AppCores.borda),
                      Expanded(child: child),
                    ],
                  )
                : child,
          ),
        );
      },
    );
  }
}

// =================================================================
// AppBar fina
// =================================================================
class _TopBar extends StatelessWidget implements PreferredSizeWidget {
  const _TopBar({required this.titulo, required this.mostrarMenuBotao});
  final String titulo;
  final bool mostrarMenuBotao;

  @override
  Size get preferredSize => const Size.fromHeight(60);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      backgroundColor: Colors.white.withValues(alpha: 0.95),
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 1,
      shape: const Border(bottom: BorderSide(color: AppCores.borda, width: 1)),
      leading: mostrarMenuBotao
          ? Builder(
              builder: (ctx) => IconButton(
                icon: const Icon(Icons.menu_rounded, color: AppCores.azulNoite),
                onPressed: () => Scaffold.of(ctx).openDrawer(),
              ),
            )
          : null,
      title: Text(
        titulo,
        style: GoogleFonts.inter(
          fontSize: 15,
          fontWeight: FontWeight.w700,
          color: AppCores.azulNoite,
          letterSpacing: -0.2,
        ),
      ),
      actions: [
        IconButton(
          tooltip: 'Notificações',
          icon: const Icon(Icons.notifications_outlined, color: AppCores.azulNoite, size: 22),
          onPressed: () => context.go('/notificacoes'),
        ),
        IconButton(
          tooltip: 'Minha conta',
          icon: const CircleAvatar(
            radius: 14,
            backgroundColor: AppCores.azulMedio,
            child: Icon(Icons.person, size: 16, color: Colors.white),
          ),
          onPressed: () => context.go('/conta'),
        ),
        const SizedBox(width: 8),
      ],
    );
  }
}

// =================================================================
// NavigationRail (desktop/tablet largo)
// =================================================================
class _RailNav extends StatelessWidget {
  const _RailNav({required this.itens, required this.indiceAtual});
  final List<NavItem> itens;
  final int indiceAtual;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 240,
      decoration: const BoxDecoration(color: Colors.white),
      child: Column(
        children: [
          // Logo (compacto)
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 12),
            child: Image.network(
              SupabaseConfig.brandingUrl('01-primary-logo.png'),
              height: 28,
              errorBuilder: (_, e, s) => Text(
                'DataCold',
                style: GoogleFonts.inter(
                  fontSize: 17, fontWeight: FontWeight.w800,
                  color: AppCores.azulNoite,
                ),
              ),
            ),
          ),
          const Divider(height: 1, color: AppCores.borda),
          // Lista de itens
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 10),
              itemCount: itens.length,
              itemBuilder: (_, i) => _NavTile(
                item: itens[i],
                ativo: i == indiceAtual,
              ),
            ),
          ),
          const Divider(height: 1, color: AppCores.borda),
          // Sair
          Padding(
            padding: const EdgeInsets.all(10),
            child: SizedBox(
              width: double.infinity,
              child: TextButton.icon(
                onPressed: () async {
                  await AuthRepository().sair();
                  if (context.mounted) context.go('/login');
                },
                style: TextButton.styleFrom(
                  foregroundColor: AppCores.erro,
                  alignment: Alignment.centerLeft,
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                ),
                icon: const Icon(Icons.logout_rounded, size: 18),
                label: const Text('Sair'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// =================================================================
// Drawer (mobile/narrow)
// =================================================================
class _Drawer extends StatelessWidget {
  const _Drawer({required this.itens, required this.indiceAtual});
  final List<NavItem> itens;
  final int indiceAtual;

  @override
  Widget build(BuildContext context) {
    return Drawer(
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(),
      child: Column(
        children: [
          DrawerHeader(
            margin: EdgeInsets.zero,
            padding: const EdgeInsets.fromLTRB(20, 32, 20, 16),
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: AppCores.borda)),
            ),
            child: Align(
              alignment: Alignment.bottomLeft,
              child: Image.network(
                SupabaseConfig.brandingUrl('01-primary-logo.png'),
                height: 30,
                errorBuilder: (_, e, s) => Text(
                  'DataCold',
                  style: GoogleFonts.inter(
                    fontSize: 18, fontWeight: FontWeight.w800,
                    color: AppCores.azulNoite,
                  ),
                ),
              ),
            ),
          ),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
              itemCount: itens.length,
              itemBuilder: (_, i) => _NavTile(
                item: itens[i],
                ativo: i == indiceAtual,
                onTap: () => Navigator.pop(context),
              ),
            ),
          ),
          const Divider(height: 1, color: AppCores.borda),
          ListTile(
            leading: const Icon(Icons.logout_rounded, color: AppCores.erro, size: 20),
            title: Text('Sair',
              style: GoogleFonts.inter(
                fontSize: 13, fontWeight: FontWeight.w700, color: AppCores.erro,
              ),
            ),
            onTap: () async {
              await AuthRepository().sair();
              if (context.mounted) context.go('/login');
            },
          ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}

// =================================================================
// Tile individual (usado em ambos os lados)
// =================================================================
class _NavTile extends StatelessWidget {
  const _NavTile({required this.item, required this.ativo, this.onTap});
  final NavItem item;
  final bool ativo;
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
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
          decoration: BoxDecoration(
            color: ativo ? AppCores.azulMedio.withValues(alpha: 0.10) : null,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(
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
