import 'package:flutter/material.dart';

/// Item de navegação do menu lateral. Nota: "Sensores" NÃO é um NavItem —
/// é um `SensoresExpansor` que renderizamos manualmente entre Dashboard
/// e Sala de Controle, com chips de filtro e lista agrupada por ambiente.
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

class NavItems {
  /// Itens acima do expansor "Sensores"
  static const List<NavItem> topo = [
    NavItem(path: '/dashboard', label: 'Dashboard', icon: Icons.dashboard_rounded),
  ];

  /// Itens abaixo do expansor "Sensores"
  static const List<NavItem> base = [
    NavItem(path: '/sala-controle', label: 'Sala de controle', icon: Icons.tune_rounded, adminOnly: true),
    NavItem(path: '/ambientes',     label: 'Ambientes',        icon: Icons.factory_rounded),
    NavItem(path: '/notificacoes',  label: 'Notificações',     icon: Icons.notifications_rounded),
    NavItem(path: '/agentes',       label: 'Agentes',          icon: Icons.smart_toy_rounded),
    NavItem(path: '/prototipo',     label: 'Protótipo',        icon: Icons.account_tree_rounded, adminOnly: true),
    NavItem(path: '/apresentacao',  label: 'Apresentação',     icon: Icons.slideshow_rounded,    adminOnly: true),
    NavItem(path: '/usuarios',      label: 'Usuários',         icon: Icons.group_rounded,        adminOnly: true),
    NavItem(path: '/conta',         label: 'Minha conta',      icon: Icons.account_circle_rounded),
  ];

  /// Filtra por papel (admin vê tudo, operador vê os non-admin-only)
  static List<NavItem> filtrar(List<NavItem> lista, {required bool admin}) =>
      admin ? lista : lista.where((i) => !i.adminOnly).toList();
}
