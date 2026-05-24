import 'dart:math' as math;
import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// Fundo elegante das telas públicas (login, recuperar senha).
///
/// 4 camadas empilhadas, todas pintadas em vetor (escalam sem perder
/// qualidade, sem download de asset):
///   1. Gradiente azul-noite → azul-profundo → azul-medio (diagonal)
///   2. Mancha radial de ciano (glow no canto superior direito)
///   3. Textura de pontinhos (estilo "blueprint")
///   4. Silhueta urbana industrial no rodapé (chaminés, prédios, antenas)
class AuthBackground extends StatelessWidget {
  const AuthBackground({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFF071632),   // mais escuro ainda que azul-noite
            AppCores.azulNoite,
            AppCores.azulProfundo,
            Color(0xFF0E4FA0),
          ],
          stops: [0.0, 0.35, 0.75, 1.0],
        ),
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          // 2 · Glow ciano flutuante (canto superior direito)
          Positioned.fill(
            child: IgnorePointer(
              child: CustomPaint(painter: _GlowPainter()),
            ),
          ),
          // 3 · Textura de pontinhos blueprint
          Positioned.fill(
            child: IgnorePointer(
              child: CustomPaint(painter: _DotGridPainter()),
            ),
          ),
          // 4 · Silhueta industrial no rodapé
          Positioned(
            left: 0, right: 0, bottom: 0,
            height: 220,
            child: IgnorePointer(
              child: CustomPaint(painter: _UrbanSkylinePainter()),
            ),
          ),
          // 5 · Conteúdo da página (form/card)
          child,
        ],
      ),
    );
  }
}

// ============================================================
// Glow ciano (mancha radial)
// ============================================================
class _GlowPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final p1 = Paint()
      ..shader = RadialGradient(
        colors: [
          AppCores.ciano.withValues(alpha: 0.35),
          AppCores.azulMedio.withValues(alpha: 0.12),
          Colors.transparent,
        ],
        stops: const [0.0, 0.4, 1.0],
      ).createShader(Rect.fromCircle(
        center: Offset(size.width * 0.85, size.height * 0.15),
        radius: size.width * 0.55,
      ));
    canvas.drawRect(Offset.zero & size, p1);

    // segundo glow mais sutil no canto inferior esquerdo
    final p2 = Paint()
      ..shader = RadialGradient(
        colors: [
          AppCores.azulMedio.withValues(alpha: 0.22),
          Colors.transparent,
        ],
      ).createShader(Rect.fromCircle(
        center: Offset(size.width * 0.1, size.height * 0.85),
        radius: size.width * 0.5,
      ));
    canvas.drawRect(Offset.zero & size, p2);
  }

  @override
  bool shouldRepaint(covariant _GlowPainter old) => false;
}

// ============================================================
// Textura de pontinhos (estilo "blueprint")
// ============================================================
class _DotGridPainter extends CustomPainter {
  static const _passo = 22.0;
  static const _raioPonto = 0.9;

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()..color = AppCores.ciano.withValues(alpha: 0.08);
    for (double y = 0; y < size.height; y += _passo) {
      for (double x = 0; x < size.width; x += _passo) {
        canvas.drawCircle(Offset(x, y), _raioPonto, p);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _DotGridPainter old) => false;
}

// ============================================================
// Skyline industrial urbano (chão de fábrica abstrato)
// ============================================================
class _UrbanSkylinePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    // Camada de fundo (mais distante, mais clara, blur visual)
    _camadaFundo(canvas, w, h);

    // Camada do meio (prédios médios)
    _camadaMeio(canvas, w, h);

    // Camada da frente (chaminés, fábrica em destaque)
    _camadaFrente(canvas, w, h);

    // Sensores brilhantes pontuais (vida na cena)
    _luzesPiscantes(canvas, w, h);
  }

  // ---- Fundo: prédios distantes, opacidade baixa
  void _camadaFundo(Canvas canvas, double w, double h) {
    final p = Paint()..color = AppCores.azulNoite.withValues(alpha: 0.55);
    final path = Path()..moveTo(0, h);

    final preds = [
      [0.00, 0.60], [0.04, 0.60], [0.04, 0.45], [0.08, 0.45], [0.08, 0.55],
      [0.13, 0.55], [0.13, 0.40], [0.18, 0.40], [0.18, 0.50], [0.24, 0.50],
      [0.24, 0.42], [0.30, 0.42], [0.30, 0.55], [0.36, 0.55], [0.36, 0.48],
      [0.42, 0.48], [0.42, 0.38], [0.48, 0.38], [0.48, 0.52], [0.55, 0.52],
      [0.55, 0.45], [0.62, 0.45], [0.62, 0.55], [0.70, 0.55], [0.70, 0.42],
      [0.78, 0.42], [0.78, 0.50], [0.85, 0.50], [0.85, 0.43], [0.92, 0.43],
      [0.92, 0.55], [1.00, 0.55],
    ];
    for (final p2 in preds) {
      path.lineTo(p2[0] * w, p2[1] * h);
    }
    path.lineTo(w, h);
    path.close();
    canvas.drawPath(path, p);
  }

  // ---- Meio: prédios médios + janelas iluminadas
  void _camadaMeio(Canvas canvas, double w, double h) {
    final p = Paint()..color = const Color(0xFF051028).withValues(alpha: 0.75);
    final path = Path()..moveTo(0, h);

    final preds = [
      [0.00, 0.75], [0.06, 0.75], [0.06, 0.62], [0.12, 0.62],
      [0.12, 0.70], [0.20, 0.70], [0.20, 0.55], [0.28, 0.55],
      [0.28, 0.65], [0.36, 0.65], [0.36, 0.58], [0.45, 0.58],
      [0.45, 0.68], [0.54, 0.68], [0.54, 0.60], [0.62, 0.60],
      [0.62, 0.72], [0.72, 0.72], [0.72, 0.60], [0.80, 0.60],
      [0.80, 0.68], [0.88, 0.68], [0.88, 0.58], [0.96, 0.58],
      [0.96, 0.72], [1.00, 0.72],
    ];
    for (final p2 in preds) {
      path.lineTo(p2[0] * w, p2[1] * h);
    }
    path.lineTo(w, h);
    path.close();
    canvas.drawPath(path, p);

    // Janelinhas iluminadas (vida na cidade)
    final janela = Paint()..color = AppCores.ciano.withValues(alpha: 0.55);
    final janelaFraca = Paint()..color = AppCores.alerta.withValues(alpha: 0.35);
    final rng = math.Random(7);
    for (var i = 0; i < 36; i++) {
      final x = rng.nextDouble() * w;
      final y = (0.58 + rng.nextDouble() * 0.18) * h;
      final cor = rng.nextDouble() < 0.7 ? janela : janelaFraca;
      canvas.drawRect(Rect.fromLTWH(x, y, 2.5, 2.5), cor);
    }
  }

  // ---- Frente: fábrica em destaque (chaminés, tanques, antenas)
  void _camadaFrente(Canvas canvas, double w, double h) {
    final p = Paint()..color = const Color(0xFF030915).withValues(alpha: 0.92);

    // Galpão principal à esquerda
    final galpao = Path()
      ..moveTo(w * 0.05, h)
      ..lineTo(w * 0.05, h * 0.85)
      ..lineTo(w * 0.10, h * 0.78)
      ..lineTo(w * 0.20, h * 0.78)
      ..lineTo(w * 0.25, h * 0.85)
      ..lineTo(w * 0.25, h);
    canvas.drawPath(galpao, p);

    // Chaminé alta
    canvas.drawRect(
      Rect.fromLTRB(w * 0.18, h * 0.35, w * 0.205, h * 0.78),
      p,
    );
    // Topo da chaminé (mais largo)
    canvas.drawRect(
      Rect.fromLTRB(w * 0.175, h * 0.32, w * 0.21, h * 0.36),
      p,
    );

    // Fumaça subindo da chaminé (3 círculos translúcidos)
    final fumaca = Paint()..color = const Color(0xFFB7C7DB).withValues(alpha: 0.10);
    canvas.drawCircle(Offset(w * 0.19, h * 0.22), 14, fumaca);
    canvas.drawCircle(Offset(w * 0.21, h * 0.14), 10, fumaca);
    canvas.drawCircle(Offset(w * 0.19, h * 0.06), 8, fumaca);

    // Bloco central — fábrica grande
    final fabrica = Path()
      ..moveTo(w * 0.30, h)
      ..lineTo(w * 0.30, h * 0.70)
      ..lineTo(w * 0.45, h * 0.70)
      ..lineTo(w * 0.45, h * 0.62)
      ..lineTo(w * 0.55, h * 0.62)
      ..lineTo(w * 0.55, h * 0.70)
      ..lineTo(w * 0.62, h * 0.70)
      ..lineTo(w * 0.62, h);
    canvas.drawPath(fabrica, p);

    // Antena com 3 traços horizontais (estilo torre de transmissão)
    final antenaX = w * 0.50;
    final antenaPaint = Paint()
      ..color = const Color(0xFF030915).withValues(alpha: 0.92)
      ..strokeWidth = 2;
    canvas.drawLine(Offset(antenaX, h * 0.62), Offset(antenaX, h * 0.20), antenaPaint);
    for (int i = 0; i < 3; i++) {
      final y = h * (0.30 + i * 0.10);
      final largura = 14.0 - i * 3;
      canvas.drawLine(
        Offset(antenaX - largura, y),
        Offset(antenaX + largura, y),
        antenaPaint,
      );
    }

    // Tanque cilíndrico à direita
    canvas.drawRect(
      Rect.fromLTRB(w * 0.68, h * 0.65, w * 0.80, h),
      p,
    );
    // Topo arredondado do tanque
    canvas.drawArc(
      Rect.fromLTRB(w * 0.68, h * 0.60, w * 0.80, h * 0.72),
      math.pi, math.pi, true, p,
    );

    // Galpão final à direita
    final galpaoFim = Path()
      ..moveTo(w * 0.85, h)
      ..lineTo(w * 0.85, h * 0.80)
      ..lineTo(w * 0.92, h * 0.74)
      ..lineTo(w * 1.00, h * 0.74)
      ..lineTo(w * 1.00, h);
    canvas.drawPath(galpaoFim, p);

    // Antena curta no galpão da direita
    canvas.drawLine(
      Offset(w * 0.95, h * 0.74),
      Offset(w * 0.95, h * 0.50),
      antenaPaint,
    );
    canvas.drawCircle(Offset(w * 0.95, h * 0.50), 2.5, antenaPaint);
  }

  // ---- Luzes piscantes (efeito vida)
  void _luzesPiscantes(Canvas canvas, double w, double h) {
    // Luz vermelha topo da antena central
    final luzVermelha = Paint()
      ..color = AppCores.erro.withValues(alpha: 0.85);
    canvas.drawCircle(Offset(w * 0.50, h * 0.20), 2.8, luzVermelha);
    // Halo
    canvas.drawCircle(
      Offset(w * 0.50, h * 0.20), 6,
      Paint()..color = AppCores.erro.withValues(alpha: 0.20),
    );

    // Luz ciano topo da antena direita
    final luzCiano = Paint()..color = AppCores.ciano.withValues(alpha: 0.85);
    canvas.drawCircle(Offset(w * 0.95, h * 0.50), 2.2, luzCiano);
  }

  @override
  bool shouldRepaint(covariant _UrbanSkylinePainter old) => false;
}
