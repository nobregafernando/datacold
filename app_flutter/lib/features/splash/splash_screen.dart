import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/theme.dart';
import 'snowflake_painter.dart';

/// Splash com floquinho animado (CustomPainter vetorial).
/// Decide o destino baseado na sessão atual do Supabase.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with TickerProviderStateMixin {
  late final AnimationController _entrada;   // 0..1 desenha o floquinho
  late final AnimationController _giro;      // rotação contínua
  late final AnimationController _pulso;     // glow respirando

  late final Animation<double> _progresso;
  late final Animation<double> _fadeMarca;

  @override
  void initState() {
    super.initState();
    _entrada = AnimationController(vsync: this, duration: const Duration(milliseconds: 1700));
    _giro    = AnimationController(vsync: this, duration: const Duration(seconds: 18))..repeat();
    _pulso   = AnimationController(vsync: this, duration: const Duration(milliseconds: 1800))
      ..repeat(reverse: true);

    _progresso = CurvedAnimation(parent: _entrada, curve: Curves.easeOutCubic);
    _fadeMarca = CurvedAnimation(
      parent: _entrada,
      curve: const Interval(0.55, 1.0, curve: Curves.easeOut),
    );

    _entrada.forward();
    _decidirDestino();
  }

  Future<void> _decidirDestino() async {
    // Tempo mínimo pra terminar a animação inicial.
    await Future.delayed(const Duration(milliseconds: 1900));
    if (!mounted) return;
    final sessao = Supabase.instance.client.auth.currentSession;
    final destino = sessao != null ? '/dashboard' : '/login';
    if (mounted) context.go(destino);
  }

  @override
  void dispose() {
    _entrada.dispose();
    _giro.dispose();
    _pulso.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft, end: Alignment.bottomRight,
            colors: [Color(0xFFEAF4FF), Color(0xFFFFFFFF), Color(0xFFE6F6FF)],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Spacer(flex: 2),
                SizedBox(
                  width: 220, height: 220,
                  child: AnimatedBuilder(
                    animation: Listenable.merge([_entrada, _giro, _pulso]),
                    builder: (_, __) => CustomPaint(
                      painter: SnowflakePainter(
                        progresso: _progresso.value,
                        rotacaoRad: _giro.value * 2 * 3.14159265358979,
                        pulso: 0.4 + 0.6 * _pulso.value,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 28),
                FadeTransition(
                  opacity: _fadeMarca,
                  child: Column(
                    children: [
                      Text('DataCold',
                        style: GoogleFonts.inter(
                          fontSize: 36, fontWeight: FontWeight.w800,
                          color: AppCores.azulNoite, letterSpacing: -0.8,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text('TEMPERATURE · TELEMETRY · INSIGHTS',
                        style: GoogleFonts.inter(
                          fontSize: 10, fontWeight: FontWeight.w700,
                          color: AppCores.azulMedio, letterSpacing: 3.2,
                        ),
                      ),
                    ],
                  ),
                ),
                const Spacer(flex: 3),
                FadeTransition(
                  opacity: _fadeMarca,
                  child: const _LoadingDots(),
                ),
                const SizedBox(height: 40),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// 3 pontinhos animados — feedback de "carregando" sem barra.
class _LoadingDots extends StatefulWidget {
  const _LoadingDots();
  @override
  State<_LoadingDots> createState() => _LoadingDotsState();
}

class _LoadingDotsState extends State<_LoadingDots> with SingleTickerProviderStateMixin {
  late final AnimationController _c;
  @override
  void initState() {
    super.initState();
    _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200))..repeat();
  }
  @override
  void dispose() { _c.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (_, __) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(3, (i) {
            final t = ((_c.value - i * 0.15) % 1.0).clamp(0.0, 1.0);
            final escala = 0.6 + 0.4 * (t < 0.5 ? t * 2 : (1 - t) * 2);
            return Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Transform.scale(
                scale: escala,
                child: Container(
                  width: 9, height: 9,
                  decoration: const BoxDecoration(
                    color: AppCores.azulMedio,
                    shape: BoxShape.circle,
                  ),
                ),
              ),
            );
          }),
        );
      },
    );
  }
}
