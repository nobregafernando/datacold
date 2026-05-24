import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'core/theme.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/recuperar_senha_screen.dart';
import 'features/dashboard/dashboard_screen.dart';
import 'features/sensores/lista_sensores_screen.dart';
import 'features/shell/main_shell.dart';
import 'features/splash/splash_screen.dart';
import 'features/stubs.dart';

class DataColdApp extends StatefulWidget {
  const DataColdApp({super.key});
  @override
  State<DataColdApp> createState() => _DataColdAppState();
}

class _DataColdAppState extends State<DataColdApp> {
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();
    _router = GoRouter(
      initialLocation: '/',
      refreshListenable: _SupabaseRefresh(),
      routes: [
        // Públicas
        GoRoute(path: '/',                  builder: (_, __) => const SplashScreen()),
        GoRoute(path: '/login',             builder: (_, __) => const LoginScreen()),
        GoRoute(path: '/recuperar-senha',   builder: (_, __) => const RecuperarSenhaScreen()),

        // Autenticadas — todas dentro do shell (menu lateral + appbar)
        ShellRoute(
          builder: (_, __, child) => MainShell(child: child),
          routes: [
            GoRoute(path: '/dashboard',     builder: (_, __) => const DashboardScreen()),
            GoRoute(path: '/sala-controle', builder: (_, __) => const SalaControleStub()),
            GoRoute(path: '/sensores',      builder: (_, __) => const ListaSensoresScreen()),
            GoRoute(path: '/sensores/:id',  builder: (_, s)  => SensorDetalheStub(sensorId: s.pathParameters['id']!)),
            GoRoute(path: '/ambientes',     builder: (_, __) => const AmbientesStub()),
            GoRoute(path: '/notificacoes',  builder: (_, __) => const NotificacoesStub()),
            GoRoute(path: '/agentes',       builder: (_, __) => const AgentesStub()),
            GoRoute(path: '/prototipo',     builder: (_, __) => const PrototipoStub()),
            GoRoute(path: '/apresentacao',  builder: (_, __) => const ApresentacaoStub()),
            GoRoute(path: '/usuarios',      builder: (_, __) => const UsuariosStub()),
            GoRoute(path: '/conta',         builder: (_, __) => const ContaStub()),
          ],
        ),
      ],
      redirect: (context, state) {
        final loc = state.matchedLocation;
        final temSessao = Supabase.instance.client.auth.currentSession != null;
        final emPublica = loc == '/' || loc == '/login' || loc == '/recuperar-senha';
        if (!temSessao && !emPublica) return '/login';
        if (temSessao && loc == '/login') return '/dashboard';
        return null;
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'DataCold',
      debugShowCheckedModeBanner: false,
      theme: AppTema.claro(),
      routerConfig: _router,
    );
  }
}

/// Adapta `onAuthStateChange` (Stream) ao `Listenable` que o GoRouter espera.
class _SupabaseRefresh extends ChangeNotifier {
  _SupabaseRefresh() {
    _sub = Supabase.instance.client.auth.onAuthStateChange.listen((_) => notifyListeners());
  }
  late final StreamSubscription _sub;

  @override
  void dispose() { _sub.cancel(); super.dispose(); }
}
