import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'core/theme.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/recuperar_senha_screen.dart';
import 'features/dashboard/dashboard_placeholder.dart';
import 'features/splash/splash_screen.dart';

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
        GoRoute(path: '/', builder: (_, __) => const SplashScreen()),
        GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
        GoRoute(path: '/recuperar-senha', builder: (_, __) => const RecuperarSenhaScreen()),
        GoRoute(path: '/dashboard', builder: (_, __) => const DashboardPlaceholder()),
      ],
      redirect: (context, state) {
        final loc = state.matchedLocation;
        final temSessao = Supabase.instance.client.auth.currentSession != null;
        final emPublica = loc == '/' || loc == '/login' || loc == '/recuperar-senha';

        // Sem sessão tentando acessar área protegida → manda pro login.
        if (!temSessao && !emPublica) return '/login';
        // Com sessão tentando voltar pro login → manda pro dashboard.
        if (temSessao && (loc == '/login')) return '/dashboard';
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
/// Sempre que login/logout/refresh acontece, o router reavalia redirects.
class _SupabaseRefresh extends ChangeNotifier {
  _SupabaseRefresh() {
    _sub = Supabase.instance.client.auth.onAuthStateChange.listen((_) => notifyListeners());
  }
  late final StreamSubscription _sub;

  @override
  void dispose() {
    _sub.cancel();
    super.dispose();
  }
}
