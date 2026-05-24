import 'package:flutter/material.dart';

/// Grade bento responsiva — calcula colunas dinamicamente pra que cada
/// célula tenha pelo menos [minLargura], distribui igual e usa [espaco]
/// como gap horizontal e vertical.
///
/// Anti-overflow: usa LayoutBuilder + Wrap; quando muito estreito (1 col),
/// cada item ocupa 100% da largura disponível.
class BentoGrid extends StatelessWidget {
  const BentoGrid({
    super.key,
    required this.itens,
    this.minLargura = 180,
    this.espaco = 10,
    this.maxColunas = 6,
  });

  final List<Widget> itens;
  final double minLargura;
  final double espaco;
  final int maxColunas;

  @override
  Widget build(BuildContext context) {
    if (itens.isEmpty) return const SizedBox.shrink();
    return LayoutBuilder(
      builder: (_, c) {
        final largura = c.maxWidth;
        var cols = (largura / minLargura).floor();
        if (cols < 1) cols = 1;
        if (cols > maxColunas) cols = maxColunas;
        final espacoTotal = espaco * (cols - 1);
        final largItem = (largura - espacoTotal) / cols;
        return Wrap(
          spacing: espaco,
          runSpacing: espaco,
          children: itens.map((w) => SizedBox(width: largItem, child: w)).toList(),
        );
      },
    );
  }
}
