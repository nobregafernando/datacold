import 'package:flutter/material.dart';
import '../../core/theme.dart';

/// 4 barrinhas estilo wifi/sinal. nivel 0..4.
///   4 = verde (saudável)
///   2 = âmbar (atenção/histórico)
///   1 = vermelho (crítico)
///   0 = cinza (offline/desconhecido)
class SinalBars extends StatelessWidget {
  const SinalBars({super.key, required this.nivel, this.altura = 14});
  final int nivel;
  final double altura;

  Color _cor(int n) {
    if (n >= 3) return AppCores.ok;
    if (n == 2) return AppCores.alerta;
    if (n == 1) return AppCores.erro;
    return const Color(0xFFD6DBE4);
  }

  @override
  Widget build(BuildContext context) {
    final cor = _cor(nivel);
    final inativa = const Color(0xFFD6DBE4);
    return SizedBox(
      height: altura,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        mainAxisSize: MainAxisSize.min,
        children: List.generate(4, (i) {
          final ativa = (i + 1) <= nivel;
          return Container(
            margin: EdgeInsets.only(right: i == 3 ? 0 : 2),
            width: 3,
            height: altura * (0.25 + i * 0.25),
            decoration: BoxDecoration(
              color: ativa ? cor : inativa,
              borderRadius: BorderRadius.circular(1),
            ),
          );
        }),
      ),
    );
  }
}
