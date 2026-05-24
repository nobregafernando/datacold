import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/theme.dart';
import '../auth/auth_repository.dart';
import 'nav_items.dart';
import 'sidebar/nav_tile.dart';
import 'sidebar/sensores_expansor.dart';
import 'sidebar/sidebar_header.dart';

/// Shell principal — sidebar adaptativo (rail desktop / drawer mobile)
/// com hambúrguer flutuante que colapsa o rail no desktop (240px ⇄ 72px).
///
/// Anti-overflow: a sidebar tem largura fixa, o body é Expanded. Cada
/// página dentro do shell controla sua própria rolagem.
class MainShell extends StatefulWidget {
  const MainShell({super.key, required this.child});
  final Widget child;
  static const double _breakpoint = 900.0;

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  bool _colapsado = false;

  @override
  Widget build(BuildContext context) {
    final user = Supabase.instance.client.auth.currentUser;
    final papel = (user?.userMetadata?['papel'] ?? 'admin') as String;
    final admin = papel == 'admin';
    final loc = GoRouterState.of(context).matchedLocation;

    return LayoutBuilder(
      builder: (context, c) {
        final largo = c.maxWidth >= MainShell._breakpoint;
        final tituloAtual = _tituloPara(loc, admin: admin);

        return Scaffold(
          backgroundColor: const Color(0xFFFAFCFF),
          drawer: largo ? null : _DrawerCompleto(admin: admin, locAtual: loc),
          appBar: _TopBar(titulo: tituloAtual, mostrarHamburgerMobile: !largo),
          body: SafeArea(
            top: false,
            child: largo
                ? Stack(
                    children: [
                      Row(
                        children: [
                          AnimatedContainer(
                            duration: const Duration(milliseconds: 220),
                            curve: Curves.easeOutCubic,
                            width: _colapsado ? 72 : 248,
                            color: Colors.white,
                            child: _SidebarConteudo(
                              admin: admin,
                              locAtual: loc,
                              compacto: _colapsado,
                            ),
                          ),
                          const VerticalDivider(width: 1, thickness: 1, color: AppCores.borda),
                          Expanded(child: widget.child),
                        ],
                      ),
                      // Hambúrguer flutuante (canto sup-esq do sidebar)
                      Positioned(
                        top: 12, left: 12,
                        child: _HamburgerFAB(
                          colapsado: _colapsado,
                          onPressed: () => setState(() => _colapsado = !_colapsado),
                        ),
                      ),
                    ],
                  )
                : widget.child,
          ),
        );
      },
    );
  }

  String _tituloPara(String loc, {required bool admin}) {
    if (loc.startsWith('/dashboard')) return 'Dashboard';
    if (loc.startsWith('/sala-controle')) return 'Sala de controle';
    if (loc.startsWith('/sensores')) return 'Sensores';
    if (loc.startsWith('/ambientes')) return 'Ambientes';
    if (loc.startsWith('/notificacoes')) return 'Notificações';
    if (loc.startsWith('/agentes')) return 'Agentes';
    if (loc.startsWith('/prototipo')) return 'Protótipo';
    if (loc.startsWith('/apresentacao')) return 'Apresentação';
    if (loc.startsWith('/usuarios')) return 'Usuários';
    if (loc.startsWith('/conta')) return 'Minha conta';
    return 'DataCold';
  }
}

// =================================================================
// Conteúdo da sidebar (compartilhado entre rail desktop e drawer mobile)
// =================================================================
class _SidebarConteudo extends StatelessWidget {
  const _SidebarConteudo({
    required this.admin,
    required this.locAtual,
    this.compacto = false,
    this.onItemTap,
  });
  final bool admin;
  final String locAtual;
  final bool compacto;
  final VoidCallback? onItemTap;

  @override
  Widget build(BuildContext context) {
    final topo = NavItems.filtrar(NavItems.topo, admin: admin);
    final base = NavItems.filtrar(NavItems.base, admin: admin);
    final sensoresAtivo = locAtual.startsWith('/sensores');

    return Column(
      children: [
        SidebarHeader(compacto: compacto),
        Expanded(
          child: ListView(
            padding: EdgeInsets.symmetric(
              vertical: 10,
              horizontal: compacto ? 8 : 10,
            ),
            children: [
              for (final it in topo)
                NavTile(
                  item: it,
                  ativo: locAtual.startsWith(it.path),
                  compacto: compacto,
                  onTap: onItemTap,
                ),
              if (!compacto)
                SensoresExpansor(ativo: sensoresAtivo, onTap: onItemTap)
              else
                NavTile(
                  item: const NavItem(
                    path: '/sensores',
                    label: 'Sensores',
                    icon: Icons.sensors_rounded,
                  ),
                  ativo: sensoresAtivo,
                  compacto: true,
                  onTap: onItemTap,
                ),
              for (final it in base)
                NavTile(
                  item: it,
                  ativo: locAtual.startsWith(it.path),
                  compacto: compacto,
                  onTap: onItemTap,
                ),
            ],
          ),
        ),
        const Divider(height: 1, color: AppCores.borda),
        Padding(
          padding: EdgeInsets.symmetric(
            horizontal: compacto ? 8 : 10,
            vertical: 10,
          ),
          child: SizedBox(
            width: double.infinity,
            child: compacto
                ? IconButton(
                    tooltip: 'Sair',
                    icon: const Icon(Icons.logout_rounded, color: AppCores.erro, size: 20),
                    onPressed: () async {
                      await AuthRepository().sair();
                      if (context.mounted) context.go('/login');
                    },
                  )
                : TextButton.icon(
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
    );
  }
}

// =================================================================
// Drawer completo pra mobile
// =================================================================
class _DrawerCompleto extends StatelessWidget {
  const _DrawerCompleto({required this.admin, required this.locAtual});
  final bool admin;
  final String locAtual;

  @override
  Widget build(BuildContext context) {
    return Drawer(
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(),
      child: _SidebarConteudo(
        admin: admin,
        locAtual: locAtual,
        onItemTap: () => Navigator.pop(context),
      ),
    );
  }
}

// =================================================================
// AppBar fina
// =================================================================
class _TopBar extends StatelessWidget implements PreferredSizeWidget {
  const _TopBar({required this.titulo, required this.mostrarHamburgerMobile});
  final String titulo;
  final bool mostrarHamburgerMobile;

  @override
  Size get preferredSize => const Size.fromHeight(58);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      backgroundColor: Colors.white.withValues(alpha: 0.95),
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 1,
      shape: const Border(bottom: BorderSide(color: AppCores.borda, width: 1)),
      leading: mostrarHamburgerMobile
          ? Builder(
              builder: (ctx) => IconButton(
                icon: const Icon(Icons.menu_rounded, color: AppCores.azulNoite),
                onPressed: () => Scaffold.of(ctx).openDrawer(),
              ),
            )
          : const SizedBox.shrink(),
      leadingWidth: mostrarHamburgerMobile ? null : 0,
      titleSpacing: mostrarHamburgerMobile ? 0 : 80,   // dá espaço pro hambúrguer flutuante
      title: Text(
        titulo,
        style: GoogleFonts.inter(
          fontSize: 15, fontWeight: FontWeight.w700,
          color: AppCores.azulNoite, letterSpacing: -0.2,
        ),
      ),
      actions: [
        IconButton(
          tooltip: 'Notificações',
          icon: const Icon(Icons.notifications_outlined,
              color: AppCores.azulNoite, size: 22),
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
// Hambúrguer flutuante (canto sup-esq do sidebar)
// =================================================================
class _HamburgerFAB extends StatelessWidget {
  const _HamburgerFAB({required this.colapsado, required this.onPressed});
  final bool colapsado;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      elevation: 1,
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onPressed,
        child: Container(
          width: 36, height: 36,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppCores.borda),
          ),
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 180),
            child: Icon(
              colapsado ? Icons.menu_rounded : Icons.menu_open_rounded,
              key: ValueKey(colapsado),
              color: AppCores.azulNoite,
              size: 18,
            ),
          ),
        ),
      ),
    );
  }
}
