import 'dart:math' as math;
import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// Floquinho da marca DataCold desenhado com Path — vetorial, escala
/// sem perder qualidade, anima sozinho.
///
/// `progresso` (0..1)  -> quanto do floquinho já foi desenhado
/// `rotacaoRad`        -> rotação em torno do centro
/// `pulso` (0..1)      -> intensidade do glow que pulsa
class SnowflakePainter extends CustomPainter {
  SnowflakePainter({
    required this.progresso,
    required this.rotacaoRad,
    required this.pulso,
  });

  final double progresso;
  final double rotacaoRad;
  final double pulso;

  @override
  void paint(Canvas canvas, Size size) {
    final centro = size.center(Offset.zero);
    final raio = math.min(size.width, size.height) / 2;

    // ----- Glow externo pulsante -----
    final glow = Paint()
      ..shader = RadialGradient(
        colors: [
          AppCores.ciano.withOpacity(0.40 * pulso),
          AppCores.azulMedio.withOpacity(0.10 * pulso),
          Colors.transparent,
        ],
        stops: const [0.0, 0.55, 1.0],
      ).createShader(Rect.fromCircle(center: centro, radius: raio));
    canvas.drawCircle(centro, raio, glow);

    canvas.save();
    canvas.translate(centro.dx, centro.dy);
    canvas.rotate(rotacaoRad);

    // ----- 6 braços do floquinho -----
    final tracoPrincipal = Paint()
      ..color = AppCores.azulMedio
      ..strokeWidth = raio * 0.07
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;

    final tracoSecundario = Paint()
      ..color = AppCores.ciano
      ..strokeWidth = raio * 0.055
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;

    const totalBracos = 6;
    final bracosDesenhados = (progresso * totalBracos).clamp(0.0, totalBracos);

    for (var i = 0; i < totalBracos; i++) {
      final double progressoDoBraco = (bracosDesenhados - i).clamp(0.0, 1.0).toDouble();
      if (progressoDoBraco <= 0) continue;

      canvas.save();
      canvas.rotate((2 * math.pi / totalBracos) * i);
      _pintarBraco(canvas, raio, progressoDoBraco, tracoPrincipal, tracoSecundario);
      canvas.restore();
    }

    // ----- Anel central (igual ao logo) com gráfico de barras -----
    final anelOpacity = ((progresso - 0.65) / 0.35).clamp(0.0, 1.0);
    if (anelOpacity > 0) {
      final anel = Paint()
        ..color = AppCores.azulMedio.withOpacity(anelOpacity)
        ..style = PaintingStyle.stroke
        ..strokeWidth = raio * 0.06;
      canvas.drawCircle(Offset.zero, raio * 0.28, anel);

      // 3 barrinhas (representam dados/telemetria)
      final barra = Paint()..color = AppCores.azulProfundo.withOpacity(anelOpacity);
      final larguraBarra = raio * 0.07;
      final espaco = raio * 0.045;
      final alturas = [raio * 0.20, raio * 0.30, raio * 0.25];
      for (var i = 0; i < 3; i++) {
        final x = -espaco * 2 + i * (larguraBarra + espaco / 2);
        canvas.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromLTWH(x - larguraBarra / 2, -alturas[i] / 2, larguraBarra, alturas[i]),
            Radius.circular(larguraBarra * 0.3),
          ),
          barra,
        );
      }
    }

    canvas.restore();
  }

  /// Desenha um braço do floquinho (linha principal + 2 V's nas pontas).
  void _pintarBraco(
    Canvas canvas, double raio, double progresso,
    Paint principal, Paint secundario,
  ) {
    final comprimento = raio * 0.85 * progresso;
    // Linha principal (raio para fora)
    canvas.drawLine(Offset.zero, Offset(0, -comprimento), principal);

    // Dois V's nas pontas (decoração de floquinho)
    if (progresso > 0.55) {
      final intensidadeV = ((progresso - 0.55) / 0.45).clamp(0.0, 1.0);
      final aberturaV = raio * 0.18 * intensidadeV;
      final alturaV = raio * 0.16 * intensidadeV;

      // V superior (ponta)
      final pontaY = -raio * 0.85;
      canvas.drawLine(
        Offset(0, pontaY),
        Offset(-aberturaV, pontaY + alturaV),
        secundario,
      );
      canvas.drawLine(
        Offset(0, pontaY),
        Offset(aberturaV, pontaY + alturaV),
        secundario,
      );

      // V intermediário (meio do braço)
      final meioY = -raio * 0.55;
      canvas.drawLine(
        Offset(0, meioY),
        Offset(-aberturaV * 0.75, meioY + alturaV * 0.75),
        secundario,
      );
      canvas.drawLine(
        Offset(0, meioY),
        Offset(aberturaV * 0.75, meioY + alturaV * 0.75),
        secundario,
      );
    }
  }

  @override
  bool shouldRepaint(covariant SnowflakePainter old) =>
      old.progresso != progresso ||
      old.rotacaoRad != rotacaoRad ||
      old.pulso != pulso;
}
