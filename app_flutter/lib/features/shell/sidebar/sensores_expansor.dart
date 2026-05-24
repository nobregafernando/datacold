import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../../core/theme.dart';
import '../../../data/api_client.dart';
import '../../../data/models/grupo.dart';
import '../../../data/models/sensor.dart';

/// Expansor "Sensores" no sidebar — quando aberto mostra 4 chips de
/// filtro (Todos/Energia/Temp/Porta) e a lista de sensores agrupada
/// por ambiente com ícone colorido. Quando há sensor ativo na rota
/// (`/sensores/:id`), abre automaticamente e destaca o item.
class SensoresExpansor extends StatefulWidget {
  const SensoresExpansor({super.key, this.onTap, required this.ativo});
  final VoidCallback? onTap;
  final bool ativo; // a rota atual está em /sensores/* ?

  @override
  State<SensoresExpansor> createState() => _SensoresExpansorState();
}

class _SensoresExpansorState extends State<SensoresExpansor> {
  bool _aberto = false;
  String _filtro = 'todos';
  List<Sensor> _sensores = [];
  List<Grupo> _grupos = [];
  bool _carregando = false;

  @override
  void initState() {
    super.initState();
    _aberto = widget.ativo;
    if (_aberto) _carregar();
  }

  Future<void> _carregar() async {
    if (_carregando || _sensores.isNotEmpty) return;
    setState(() => _carregando = true);
    final cat = await ApiClient().catalogo();
    if (!mounted) return;
    setState(() {
      _sensores = cat.sensores;
      _grupos = cat.grupos;
      _carregando = false;
    });
  }

  void _toggle() {
    setState(() => _aberto = !_aberto);
    if (_aberto) _carregar();
  }

  String _sensorIdAtual(String loc) {
    final m = RegExp(r'^/sensores/([^/]+)').firstMatch(loc);
    return m?.group(1) ?? '';
  }

  @override
  Widget build(BuildContext context) {
    final loc = GoRouterState.of(context).matchedLocation;
    final sensorIdAtivo = _sensorIdAtual(loc);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        // Header clicável "Sensores ▾"
        Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: _toggle,
            child: Container(
              margin: const EdgeInsets.symmetric(vertical: 2),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: (_aberto || widget.ativo)
                    ? AppCores.azulMedio.withValues(alpha: 0.10)
                    : null,
                borderRadius: BorderRadius.circular(10),
                border: Border(
                  left: BorderSide(
                    color: widget.ativo ? AppCores.azulMedio : Colors.transparent,
                    width: 3,
                  ),
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.sensors_rounded,
                    size: 18,
                    color: (_aberto || widget.ativo)
                        ? AppCores.azulMedio
                        : AppCores.textoSuave,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Sensores',
                      style: GoogleFonts.inter(
                        fontSize: 13,
                        fontWeight: (_aberto || widget.ativo) ? FontWeight.w700 : FontWeight.w500,
                        color: (_aberto || widget.ativo) ? AppCores.azulProfundo : AppCores.texto,
                      ),
                    ),
                  ),
                  AnimatedRotation(
                    turns: _aberto ? 0.5 : 0,
                    duration: const Duration(milliseconds: 200),
                    child: const Icon(Icons.keyboard_arrow_down_rounded, size: 18, color: AppCores.textoSuave),
                  ),
                ],
              ),
            ),
          ),
        ),

        // Sublista (chips + lista)
        AnimatedSize(
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOutCubic,
          alignment: Alignment.topCenter,
          child: !_aberto
              ? const SizedBox.shrink()
              : Container(
                  margin: const EdgeInsets.fromLTRB(20, 4, 4, 6),
                  padding: const EdgeInsets.only(left: 8),
                  decoration: const BoxDecoration(
                    border: Border(left: BorderSide(color: AppCores.borda, width: 2)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Chips de filtro
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
                        child: Wrap(
                          spacing: 4, runSpacing: 4,
                          children: [
                            _chip('todos', 'Todos'),
                            _chip('energia', 'Energia'),
                            _chip('temperatura', 'Temp'),
                            _chip('porta', 'Porta'),
                          ],
                        ),
                      ),
                      if (_carregando)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 12),
                          child: Center(child: SizedBox(
                            width: 16, height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )),
                        )
                      else
                        _construirListaAgrupada(sensorIdAtivo),
                    ],
                  ),
                ),
        ),
      ],
    );
  }

  Widget _chip(String valor, String label) {
    final ativo = _filtro == valor;
    return Material(
      color: ativo ? AppCores.azulNoite : Colors.transparent,
      borderRadius: BorderRadius.circular(99),
      child: InkWell(
        borderRadius: BorderRadius.circular(99),
        onTap: () => setState(() => _filtro = valor),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(99),
            border: Border.all(
              color: ativo ? Colors.transparent : AppCores.borda,
            ),
          ),
          child: Text(
            label,
            style: GoogleFonts.inter(
              fontSize: 10.5, fontWeight: FontWeight.w600,
              color: ativo ? Colors.white : AppCores.textoSuave,
            ),
          ),
        ),
      ),
    );
  }

  Widget _construirListaAgrupada(String sensorIdAtivo) {
    final filtradas = _sensores
        .where((s) => _filtro == 'todos' || s.tipo == _filtro)
        .toList();
    if (filtradas.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
        child: Text(
          'Nenhum sensor.',
          style: GoogleFonts.inter(fontSize: 11.5, color: AppCores.textoSuave),
        ),
      );
    }
    const ordem = [
      'extrusao', 'camara_congelados', 'camara_estoque',
      'graxaria', 'externo_campo_grande', 'externo_tres_lagoas',
    ];
    final widgets = <Widget>[];
    for (final gid in ordem) {
      final doGrupo = filtradas.where((s) => s.grupo == gid).toList();
      if (doGrupo.isEmpty) continue;
      final grupo = _grupos.firstWhere(
        (g) => g.id == gid,
        orElse: () => Grupo(id: gid, rotulo: gid),
      );
      widgets.add(_cabecalhoAmbiente(grupo));
      for (final s in doGrupo) {
        widgets.add(_itemSensor(s, ativo: s.id == sensorIdAtivo));
      }
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: widgets,
    );
  }

  IconData _iconeAmbiente(String id) => switch (id) {
        'extrusao' => Icons.factory_rounded,
        'camara_congelados' => Icons.ac_unit_rounded,
        'camara_estoque' => Icons.inventory_2_rounded,
        'graxaria' => Icons.water_drop_rounded,
        'externo_campo_grande' || 'externo_tres_lagoas' => Icons.location_on_rounded,
        _ => Icons.place_rounded,
      };

  Color _corAmbiente(String id) => switch (id) {
        'extrusao' => const Color(0xFFB25410),
        'camara_congelados' => const Color(0xFF0A83B8),
        'camara_estoque' => const Color(0xFF2A4EA0),
        'graxaria' => const Color(0xFF6B3EB8),
        'externo_campo_grande' => const Color(0xFF1F7A3A),
        'externo_tres_lagoas' => const Color(0xFF9A6A00),
        _ => AppCores.azulMedio,
      };

  Widget _cabecalhoAmbiente(Grupo g) {
    final cor = _corAmbiente(g.id);
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 10, 4, 4),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(4),
            decoration: BoxDecoration(
              color: cor.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Icon(_iconeAmbiente(g.id), size: 11, color: cor),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              g.rotulo,
              overflow: TextOverflow.ellipsis,
              style: GoogleFonts.inter(
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.4,
                color: AppCores.textoSuave,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Color _corTipo(String t) => switch (t) {
        'energia' => const Color(0xFF1E6FD6),
        'temperatura' => const Color(0xFF0A93C4),
        'porta' => const Color(0xFF2A4EA0),
        _ => AppCores.azulMedio,
      };

  IconData _iconeTipo(String t) => switch (t) {
        'energia' => Icons.bolt_rounded,
        'temperatura' => Icons.thermostat_rounded,
        'porta' => Icons.meeting_room_rounded,
        _ => Icons.sensors_rounded,
      };

  Widget _itemSensor(Sensor s, {required bool ativo}) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: () {
          context.go('/sensores/${s.id}');
          widget.onTap?.call();
        },
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
          decoration: BoxDecoration(
            color: ativo ? AppCores.azulMedio.withValues(alpha: 0.10) : null,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            children: [
              Container(
                width: 18, height: 18,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: _corTipo(s.tipo).withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(5),
                ),
                child: Icon(_iconeTipo(s.tipo), size: 11, color: _corTipo(s.tipo)),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  s.rotulo,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.inter(
                    fontSize: 11.5,
                    fontWeight: ativo ? FontWeight.w700 : FontWeight.w500,
                    color: ativo ? AppCores.azulProfundo : AppCores.texto,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
