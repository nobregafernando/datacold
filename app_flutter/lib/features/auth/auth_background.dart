import 'dart:math' as math;
import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// Fundo das telas públicas (login, recuperar senha).
///
/// Estilo: "fábrica conectada" — silhueta urbana industrial NO RODAPÉ +
/// camada de tecnologia/IoT FLUTUANDO no meio (servidores, banco de
/// dados, nuvem, wifi, nós de rede conectados por traços que pulsam) +
/// linhas de circuito de fundo + textura blueprint.
///
/// Tudo vetorial em CustomPainter — escala sem perder qualidade, sem
/// download de assets, animação leve (apenas o pulse dos nós).
class AuthBackground extends StatefulWidget {
  const AuthBackground({super.key, required this.child});
  final Widget child;

  @override
  State<AuthBackground> createState() => _AuthBackgroundState();
}

class _AuthBackgroundState extends State<AuthBackground>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 6),
    )..repeat();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFF071632),
            AppCores.azulNoite,
            AppCores.azulProfundo,
            Color(0xFF0E4FA0),
          ],
          stops: [0.0, 0.35, 0.75, 1.0],
        ),
      ),
      child: AnimatedBuilder(
        animation: _ctrl,
        builder: (_, child) => Stack(
          fit: StackFit.expand,
          children: [
            // 1 · Glows radiais (atmosfera)
            const Positioned.fill(
              child: IgnorePointer(child: CustomPaint(painter: _GlowPainter())),
            ),
            // 2 · Linhas de circuito de fundo (motherboard traces)
            const Positioned.fill(
              child: IgnorePointer(child: CustomPaint(painter: _CircuitLinesPainter())),
            ),
            // 3 · Textura blueprint (pontinhos)
            const Positioned.fill(
              child: IgnorePointer(child: CustomPaint(painter: _DotGridPainter())),
            ),
            // 4 · Constelação de nós de tecnologia conectados (zona média)
            Positioned.fill(
              child: IgnorePointer(
                child: CustomPaint(painter: _TechNodesPainter(t: _ctrl.value)),
              ),
            ),
            // 5 · Skyline industrial urbano com toques tech
            Positioned(
              left: 0, right: 0, bottom: 0, height: 240,
              child: IgnorePointer(
                child: CustomPaint(painter: _UrbanSkylinePainter(t: _ctrl.value)),
              ),
            ),
            // 6 · Conteúdo da página
            child!,
          ],
        ),
        child: widget.child,
      ),
    );
  }
}

// ============================================================
// 1 · Glow ciano (manchas radiais)
// ============================================================
class _GlowPainter extends CustomPainter {
  const _GlowPainter();
  @override
  void paint(Canvas canvas, Size size) {
    final p1 = Paint()
      ..shader = RadialGradient(
        colors: [
          AppCores.ciano.withValues(alpha: 0.32),
          AppCores.azulMedio.withValues(alpha: 0.12),
          Colors.transparent,
        ],
        stops: const [0.0, 0.4, 1.0],
      ).createShader(Rect.fromCircle(
        center: Offset(size.width * 0.85, size.height * 0.15),
        radius: size.width * 0.55,
      ));
    canvas.drawRect(Offset.zero & size, p1);

    final p2 = Paint()
      ..shader = RadialGradient(
        colors: [
          AppCores.azulMedio.withValues(alpha: 0.20),
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
// 2 · Circuit traces (motherboard linhas)
// ============================================================
class _CircuitLinesPainter extends CustomPainter {
  const _CircuitLinesPainter();
  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = AppCores.ciano.withValues(alpha: 0.10)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final pad = Paint()..color = AppCores.ciano.withValues(alpha: 0.16);

    final w = size.width, h = size.height;

    // Helper: desenha um trace em L com pads nas pontas.
    void trace(List<Offset> pontos) {
      final path = Path()..moveTo(pontos.first.dx, pontos.first.dy);
      for (var i = 1; i < pontos.length; i++) {
        path.lineTo(pontos[i].dx, pontos[i].dy);
      }
      canvas.drawPath(path, p);
      canvas.drawCircle(pontos.first, 2.2, pad);
      canvas.drawCircle(pontos.last, 2.2, pad);
    }

    // Algumas trilhas posicionadas relativamente (não atrapalham o card central)
    trace([
      Offset(w * 0.02, h * 0.18),
      Offset(w * 0.15, h * 0.18),
      Offset(w * 0.15, h * 0.06),
      Offset(w * 0.30, h * 0.06),
    ]);
    trace([
      Offset(w * 0.04, h * 0.42),
      Offset(w * 0.04, h * 0.50),
      Offset(w * 0.18, h * 0.50),
    ]);
    trace([
      Offset(w * 0.98, h * 0.28),
      Offset(w * 0.86, h * 0.28),
      Offset(w * 0.86, h * 0.40),
      Offset(w * 0.96, h * 0.40),
    ]);
    trace([
      Offset(w * 0.98, h * 0.55),
      Offset(w * 0.78, h * 0.55),
      Offset(w * 0.78, h * 0.62),
    ]);
    trace([
      Offset(w * 0.02, h * 0.70),
      Offset(w * 0.14, h * 0.70),
    ]);
  }

  @override
  bool shouldRepaint(covariant _CircuitLinesPainter old) => false;
}

// ============================================================
// 3 · Textura blueprint (pontinhos)
// ============================================================
class _DotGridPainter extends CustomPainter {
  const _DotGridPainter();
  static const _passo = 22.0;
  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()..color = AppCores.ciano.withValues(alpha: 0.07);
    for (double y = 0; y < size.height; y += _passo) {
      for (double x = 0; x < size.width; x += _passo) {
        canvas.drawCircle(Offset(x, y), 0.9, p);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _DotGridPainter old) => false;
}

// ============================================================
// 4 · Nós de tecnologia (constelação) + linhas pulsantes
// ============================================================
class _TechNodesPainter extends CustomPainter {
  _TechNodesPainter({required this.t});
  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width, h = size.height;

    // Define os nós: posição relativa + tipo + label
    final nos = <_Node>[
      _Node(0.10, 0.32, _IconeTipo.servidor),
      _Node(0.22, 0.46, _IconeTipo.banco),
      _Node(0.08, 0.58, _IconeTipo.wifi),
      _Node(0.92, 0.20, _IconeTipo.nuvem),
      _Node(0.86, 0.36, _IconeTipo.satelite),
      _Node(0.95, 0.50, _IconeTipo.chip),
      _Node(0.90, 0.68, _IconeTipo.banco),
    ];

    // Pares de nós conectados — formam a topologia da rede
    final conexoes = <List<int>>[
      [0, 1], [1, 2], [3, 4], [4, 5], [5, 6], [3, 5],
    ];

    // ---- Linhas (com pulse de "pacote" andando) ----
    final linha = Paint()
      ..color = AppCores.ciano.withValues(alpha: 0.22)
      ..strokeWidth = 1.0;
    final pacote = Paint()..color = AppCores.ciano.withValues(alpha: 0.85);

    for (var i = 0; i < conexoes.length; i++) {
      final a = nos[conexoes[i][0]];
      final b = nos[conexoes[i][1]];
      final pa = Offset(a.x * w, a.y * h);
      final pb = Offset(b.x * w, b.y * h);
      canvas.drawLine(pa, pb, linha);

      // Pacote (bolinha luminosa) andando ao longo da linha
      final fase = (t + i * 0.15) % 1.0;
      final pos = Offset.lerp(pa, pb, fase)!;
      // Halo + ponto
      canvas.drawCircle(
        pos, 4.5,
        Paint()..color = AppCores.ciano.withValues(alpha: 0.18),
      );
      canvas.drawCircle(pos, 1.8, pacote);
    }

    // ---- Nós (desenhados por cima das linhas) ----
    for (final no in nos) {
      _pintarNo(canvas, Offset(no.x * w, no.y * h), no.tipo);
    }
  }

  void _pintarNo(Canvas canvas, Offset c, _IconeTipo tipo) {
    final fundo = Paint()..color = AppCores.azulNoite.withValues(alpha: 0.85);
    final borda = Paint()
      ..color = AppCores.ciano.withValues(alpha: 0.55)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;
    final detalhe = Paint()..color = AppCores.ciano.withValues(alpha: 0.85);
    final tracejado = Paint()
      ..color = AppCores.ciano.withValues(alpha: 0.85)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.3
      ..strokeCap = StrokeCap.round;

    // Halo discreto pra dar destaque
    canvas.drawCircle(c, 20, Paint()..color = AppCores.ciano.withValues(alpha: 0.06));

    // Caixa redonda comum a todos os nós
    canvas.drawCircle(c, 14, fundo);
    canvas.drawCircle(c, 14, borda);

    canvas.save();
    canvas.translate(c.dx, c.dy);
    switch (tipo) {
      case _IconeTipo.servidor:
        // 3 unidades de rack empilhadas com LED
        for (var i = -1; i <= 1; i++) {
          final r = Rect.fromCenter(center: Offset(0, i * 5.0), width: 16, height: 3.6);
          canvas.drawRRect(RRect.fromRectAndRadius(r, const Radius.circular(1)), detalhe);
          canvas.drawCircle(Offset(5.5, i * 5.0), 0.8, Paint()..color = Colors.greenAccent);
        }
        break;
      case _IconeTipo.banco:
        // Cilindro de DB (3 elipses empilhadas)
        for (var i = -1; i <= 1; i++) {
          canvas.drawOval(
            Rect.fromCenter(center: Offset(0, i * 4.5), width: 14, height: 3.8),
            i == -1 ? detalhe : (Paint()
              ..color = AppCores.ciano.withValues(alpha: 0.40)
              ..style = PaintingStyle.stroke
              ..strokeWidth = 1.2),
          );
        }
        // Linhas laterais do cilindro
        canvas.drawLine(const Offset(-7, -4.5), const Offset(-7, 4.5), tracejado);
        canvas.drawLine(const Offset(7, -4.5), const Offset(7, 4.5), tracejado);
        break;
      case _IconeTipo.wifi:
        // 3 arcos crescentes + ponto
        for (var i = 0; i < 3; i++) {
          final raio = 3.5 + i * 3.5;
          canvas.drawArc(
            Rect.fromCircle(center: const Offset(0, 3), radius: raio),
            math.pi * 1.15, math.pi * 0.7, false,
            Paint()
              ..color = AppCores.ciano.withValues(alpha: 0.85 - i * 0.20)
              ..style = PaintingStyle.stroke
              ..strokeWidth = 1.4
              ..strokeCap = StrokeCap.round,
          );
        }
        canvas.drawCircle(const Offset(0, 3), 1.4, detalhe);
        break;
      case _IconeTipo.nuvem:
        // Nuvem (3 círculos + base)
        final p = Path()
          ..addOval(Rect.fromCircle(center: const Offset(-4, 0), radius: 4))
          ..addOval(Rect.fromCircle(center: const Offset(4, 0), radius: 5))
          ..addOval(Rect.fromCircle(center: const Offset(0, -3), radius: 4))
          ..addRect(const Rect.fromLTWH(-7, 0, 14, 4));
        canvas.drawPath(p, detalhe);
        break;
      case _IconeTipo.satelite:
        // Antena parabólica
        canvas.drawArc(
          const Rect.fromLTWH(-9, -4, 18, 14),
          math.pi, math.pi, false,
          tracejado,
        );
        canvas.drawLine(const Offset(0, 3), const Offset(3, -6), tracejado);
        canvas.drawCircle(const Offset(3, -6), 1.5, detalhe);
        break;
      case _IconeTipo.chip:
        // Chip / CPU com 8 pinos
        canvas.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromCenter(center: Offset.zero, width: 13, height: 13),
            const Radius.circular(1.5),
          ),
          Paint()
            ..color = AppCores.ciano.withValues(alpha: 0.85)
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.3,
        );
        canvas.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromCenter(center: Offset.zero, width: 5.5, height: 5.5),
            const Radius.circular(0.8),
          ),
          detalhe,
        );
        // Pinos nos 4 lados
        for (var i = -1; i <= 1; i++) {
          canvas.drawLine(Offset(i * 3.5, -8), Offset(i * 3.5, -6.5), tracejado);
          canvas.drawLine(Offset(i * 3.5, 8), Offset(i * 3.5, 6.5), tracejado);
          canvas.drawLine(Offset(-8, i * 3.5), Offset(-6.5, i * 3.5), tracejado);
          canvas.drawLine(Offset(8, i * 3.5), Offset(6.5, i * 3.5), tracejado);
        }
        break;
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _TechNodesPainter old) => old.t != t;
}

enum _IconeTipo { servidor, banco, wifi, nuvem, satelite, chip }

class _Node {
  const _Node(this.x, this.y, this.tipo);
  final double x, y;
  final _IconeTipo tipo;
}

// ============================================================
// 5 · Skyline industrial + toques tech (rack server, satellite, dutos)
// ============================================================
class _UrbanSkylinePainter extends CustomPainter {
  _UrbanSkylinePainter({required this.t});
  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    _camadaFundo(canvas, w, h);
    _camadaMeio(canvas, w, h);
    _camadaFrente(canvas, w, h);
    _luzesPiscantes(canvas, w, h, t);
  }

  void _camadaFundo(Canvas canvas, double w, double h) {
    final p = Paint()..color = AppCores.azulNoite.withValues(alpha: 0.55);
    final path = Path()..moveTo(0, h);
    const preds = [
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

  void _camadaMeio(Canvas canvas, double w, double h) {
    final p = Paint()..color = const Color(0xFF051028).withValues(alpha: 0.75);
    final path = Path()..moveTo(0, h);
    const preds = [
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

    // Janelinhas — agora maioria ciana (data centers ativos)
    final janela = Paint()..color = AppCores.ciano.withValues(alpha: 0.60);
    final janelaFraca = Paint()..color = AppCores.alerta.withValues(alpha: 0.35);
    final rng = math.Random(7);
    for (var i = 0; i < 50; i++) {
      final x = rng.nextDouble() * w;
      final y = (0.58 + rng.nextDouble() * 0.18) * h;
      final cor = rng.nextDouble() < 0.78 ? janela : janelaFraca;
      canvas.drawRect(Rect.fromLTWH(x, y, 2.5, 2.5), cor);
    }
  }

  void _camadaFrente(Canvas canvas, double w, double h) {
    final p = Paint()..color = const Color(0xFF030915).withValues(alpha: 0.92);
    final detalhe = Paint()
      ..color = AppCores.ciano.withValues(alpha: 0.70)
      ..strokeWidth = 1.3
      ..strokeCap = StrokeCap.round;

    // === Galpão industrial à esquerda + chaminé ===
    final galpao = Path()
      ..moveTo(w * 0.05, h)
      ..lineTo(w * 0.05, h * 0.85)
      ..lineTo(w * 0.10, h * 0.78)
      ..lineTo(w * 0.20, h * 0.78)
      ..lineTo(w * 0.25, h * 0.85)
      ..lineTo(w * 0.25, h);
    canvas.drawPath(galpao, p);

    canvas.drawRect(Rect.fromLTRB(w * 0.18, h * 0.35, w * 0.205, h * 0.78), p);
    canvas.drawRect(Rect.fromLTRB(w * 0.175, h * 0.32, w * 0.21, h * 0.36), p);

    // Fumaça
    final fumaca = Paint()..color = const Color(0xFFB7C7DB).withValues(alpha: 0.10);
    canvas.drawCircle(Offset(w * 0.19, h * 0.22), 14, fumaca);
    canvas.drawCircle(Offset(w * 0.21, h * 0.14), 10, fumaca);
    canvas.drawCircle(Offset(w * 0.19, h * 0.06), 8, fumaca);

    // === Rack de servidores no galpão (silhueta de janela com 4 racks) ===
    final racksRect = Rect.fromLTRB(w * 0.07, h * 0.86, w * 0.16, h * 0.96);
    canvas.drawRect(racksRect, Paint()..color = AppCores.azulNoite.withValues(alpha: 0.95));
    canvas.drawRect(racksRect, Paint()
      ..color = AppCores.ciano.withValues(alpha: 0.40)
      ..style = PaintingStyle.stroke);
    // 4 racks com LEDs verdes
    final ledOn = Paint()..color = Colors.greenAccent.withValues(alpha: 0.85);
    for (var i = 0; i < 4; i++) {
      final cx = w * 0.082 + i * (w * 0.024);
      for (var j = 0; j < 3; j++) {
        canvas.drawRect(
          Rect.fromLTWH(cx, h * 0.87 + j * (h * 0.024), w * 0.018, h * 0.018),
          Paint()..color = const Color(0xFF111E36),
        );
        canvas.drawCircle(
          Offset(cx + w * 0.014, h * 0.879 + j * (h * 0.024)),
          1.2, ledOn,
        );
      }
    }

    // === Bloco central — fábrica grande com torre de antena ===
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

    // Torre de transmissão com 3 horizontais
    final antenaX = w * 0.50;
    final antenaPaint = Paint()
      ..color = const Color(0xFF030915).withValues(alpha: 0.92)
      ..strokeWidth = 2;
    canvas.drawLine(Offset(antenaX, h * 0.62), Offset(antenaX, h * 0.18), antenaPaint);
    for (int i = 0; i < 3; i++) {
      final y = h * (0.28 + i * 0.10);
      final largura = 14.0 - i * 3;
      canvas.drawLine(
        Offset(antenaX - largura, y),
        Offset(antenaX + largura, y),
        antenaPaint,
      );
    }
    // Ondas de transmissão (2 arcos pulsantes)
    final pulse = (math.sin(t * 2 * math.pi) + 1) / 2;
    for (var i = 1; i <= 2; i++) {
      final raio = 16.0 + i * 8.0 + pulse * 4;
      canvas.drawArc(
        Rect.fromCircle(center: Offset(antenaX, h * 0.18), radius: raio),
        math.pi * 1.1, math.pi * 0.8, false,
        Paint()
          ..color = AppCores.ciano.withValues(alpha: 0.40 - i * 0.12)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.4,
      );
    }

    // === Antena parabólica no telhado da fábrica ===
    final pX = w * 0.40;
    final pY = h * 0.70;
    canvas.drawArc(
      Rect.fromCenter(center: Offset(pX, pY - 4), width: 18, height: 14),
      math.pi, math.pi, false,
      Paint()
        ..color = const Color(0xFF030915)
        ..style = PaintingStyle.fill,
    );
    canvas.drawArc(
      Rect.fromCenter(center: Offset(pX, pY - 4), width: 18, height: 14),
      math.pi, math.pi, false,
      detalhe..style = PaintingStyle.stroke,
    );
    canvas.drawLine(Offset(pX, pY + 1), Offset(pX + 4, pY - 8), detalhe);
    canvas.drawCircle(Offset(pX + 4, pY - 8), 1.5, Paint()..color = AppCores.ciano);

    // === Dutos / pipes conectando galpão e fábrica ===
    final duto = Paint()
      ..color = AppCores.ciano.withValues(alpha: 0.25)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5;
    canvas.drawLine(Offset(w * 0.25, h * 0.92), Offset(w * 0.30, h * 0.92), duto);
    canvas.drawLine(Offset(w * 0.25, h * 0.96), Offset(w * 0.30, h * 0.96), duto);
    canvas.drawLine(Offset(w * 0.62, h * 0.92), Offset(w * 0.68, h * 0.92), duto);

    // === Tanque cilíndrico (DataCenter "tanque de dados") ===
    canvas.drawRect(Rect.fromLTRB(w * 0.68, h * 0.65, w * 0.80, h), p);
    canvas.drawArc(
      Rect.fromLTRB(w * 0.68, h * 0.60, w * 0.80, h * 0.72),
      math.pi, math.pi, true, p,
    );
    // 3 anéis horizontais (dão impressão de cilindro de DB)
    final anelTanque = Paint()
      ..color = AppCores.ciano.withValues(alpha: 0.35)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;
    for (var i = 0; i < 3; i++) {
      canvas.drawLine(
        Offset(w * 0.68, h * (0.75 + i * 0.08)),
        Offset(w * 0.80, h * (0.75 + i * 0.08)),
        anelTanque,
      );
    }

    // === Galpão final à direita com 2 antenas (sat + omni) ===
    final galpaoFim = Path()
      ..moveTo(w * 0.85, h)
      ..lineTo(w * 0.85, h * 0.80)
      ..lineTo(w * 0.92, h * 0.74)
      ..lineTo(w * 1.00, h * 0.74)
      ..lineTo(w * 1.00, h);
    canvas.drawPath(galpaoFim, p);

    // Antena omni
    canvas.drawLine(Offset(w * 0.95, h * 0.74), Offset(w * 0.95, h * 0.50), antenaPaint);
    canvas.drawCircle(Offset(w * 0.95, h * 0.50), 2.5, antenaPaint);
    // Antena parabólica menor
    canvas.drawArc(
      Rect.fromCenter(center: Offset(w * 0.88, h * 0.70), width: 14, height: 10),
      math.pi, math.pi, false,
      detalhe..style = PaintingStyle.stroke,
    );
  }

  void _luzesPiscantes(Canvas canvas, double w, double h, double t) {
    // Luz vermelha topo da antena central (piscante)
    final pulse = (math.sin(t * 2 * math.pi * 1.5) + 1) / 2;
    canvas.drawCircle(
      Offset(w * 0.50, h * 0.18), 2.8 + pulse * 1.2,
      Paint()..color = AppCores.erro.withValues(alpha: 0.65 + pulse * 0.30),
    );
    canvas.drawCircle(
      Offset(w * 0.50, h * 0.18), 8 + pulse * 4,
      Paint()..color = AppCores.erro.withValues(alpha: 0.15),
    );

    // Luz ciano antena direita
    canvas.drawCircle(
      Offset(w * 0.95, h * 0.50), 2.2,
      Paint()..color = AppCores.ciano.withValues(alpha: 0.85),
    );
  }

  @override
  bool shouldRepaint(covariant _UrbanSkylinePainter old) => old.t != t;
}
