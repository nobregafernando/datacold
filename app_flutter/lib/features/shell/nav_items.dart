import 'package:flutter/material.dart';

/// Item de navegação do menu lateral.
class NavItem {
  const NavItem({
    required this.path,
    required this.label,
    required this.icon,
    this.adminOnly = false,
  });
  final String path;
  final String label;
  final IconData icon;
  final bool adminOnly;
}

/// Lista mestre — toda a navegação do app em ordem.
/// Compartilhada entre NavigationRail (desktop) e Drawer (mobile).
class NavItems {
  static const List<NavItem> todos = [
    NavItem(path: '/dashboard',     label: 'Dashboard',          icon: Icons.dashboard_rounded),
    NavItem(path: '/sala-controle', label: 'Sala de controle',   icon: Icons.tune_rounded, adminOnly: true),
    NavItem(path: '/sensores',      label: 'Sensores',           icon: Icons.sensors_rounded),
    NavItem(path: '/ambientes',     label: 'Ambientes',          icon: Icons.factory_rounded),
    NavItem(path: '/notificacoes',  label: 'Notificações',       icon: Icons.notifications_rounded),
    NavItem(path: '/agentes',       label: 'Agentes',            icon: Icons.smart_toy_rounded),
    NavItem(path: '/prototipo',     label: 'Protótipo',          icon: Icons.account_tree_rounded, adminOnly: true),
    NavItem(path: '/apresentacao',  label: 'Apresentação',       icon: Icons.slideshow_rounded,    adminOnly: true),
    NavItem(path: '/usuarios',      label: 'Usuários',           icon: Icons.group_rounded,        adminOnly: true),
    NavItem(path: '/conta',         label: 'Minha conta',        icon: Icons.account_circle_rounded),
  ];

  /// Filtra os itens conforme papel do usuário.
  static List<NavItem> paraPapel({required bool admin}) =>
      admin ? todos : todos.where((i) => !i.adminOnly).toList();
}
