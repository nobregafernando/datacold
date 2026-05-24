import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../data/models/grupo.dart';
import '../../data/models/sensor.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/sensor_card.dart';

class ListaSensoresScreen extends StatefulWidget {
  const ListaSensoresScreen({super.key});
  @override
  State<ListaSensoresScreen> createState() => _ListaSensoresScreenState();
}

class _ListaSensoresScreenState extends State<ListaSensoresScreen> {
  final _api = ApiClient();
  final _busca = TextEditingController();
  List<Sensor> _todos = [];
  List<Grupo> _grupos = [];
  Set<String> _comIncidente = {};
  String _tipoFiltro = 'todos';
  bool _carregando = true;
  String? _erro;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  @override
  void dispose() { _busca.dispose(); super.dispose(); }

  Future<void> _carregar() async {
    setState(() { _carregando = true; _erro = null; });
    try {
      final cat = await _api.catalogo();
      final inc = await _api.incidentesAtivosResumo();
      setState(() {
        _todos = cat.sensores;
        _grupos = cat.grupos;
        _comIncidente = inc.map((i) => i.sensorId).toSet();
        _carregando = false;
      });
    } catch (e) {
      setState(() { _erro = '$e'; _carregando = false; });
    }
  }

  String _norm(String s) =>
      s.toLowerCase().trim()
       .replaceAll(RegExp('[áàâã]'), 'a')
       .replaceAll(RegExp('[éèê]'), 'e')
       .replaceAll(RegExp('[íì]'), 'i')
       .replaceAll(RegExp('[óòôõ]'), 'o')
       .replaceAll(RegExp('[úù]'), 'u')
       .replaceAll('ç', 'c')
       .replaceAll(RegExp(r'[^a-z0-9\s]'), ' ')
       .replaceAll(RegExp(r'\s+'), ' ');

  List<Sensor> _filtrados() {
    final tokens = _norm(_busca.text).split(' ').where((t) => t.isNotEmpty).toList();
    return _todos.where((s) {
      if (_tipoFiltro != 'todos' && s.tipo != _tipoFiltro) return false;
      if (tokens.isEmpty) return true;
      final grupo = _grupos.firstWhere(
        (g) => g.id == s.grupo,
        orElse: () => Grupo(id: s.grupo, rotulo: s.grupo),
      );
      final hay = _norm('${s.id} ${s.rotulo} ${s.tipo} ${grupo.rotulo} ${s.personalidade ?? ""}');
      return tokens.every(hay.contains);
    }).toList();
  }

  int _nivelSaude(Sensor s) {
    if (_comIncidente.contains(s.id)) return 1;
    if (s.historico) return 2;
    if (s.ativo) return 4;
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    if (_carregando) {
      return const Center(child: CircularProgressIndicator(strokeWidth: 2.5));
    }
    if (_erro != null) {
      return EmptyState(
        icone: Icons.cloud_off_rounded,
        titulo: 'Erro ao carregar',
        descricao: _erro,
        acao: ElevatedButton.icon(
          onPressed: _carregar,
          icon: const Icon(Icons.refresh, size: 16),
          label: const Text('Tentar de novo'),
        ),
      );
    }

    final lista = _filtrados();
    return RefreshIndicator(
      onRefresh: _carregar,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('Sensores',
            style: GoogleFonts.inter(
              fontSize: 22, fontWeight: FontWeight.w800,
              color: AppCores.azulNoite, letterSpacing: -0.4,
            ),
          ),
          const SizedBox(height: 4),
          Text('${_todos.length} sensores conectados · busca em tempo real',
            style: GoogleFonts.inter(
              fontSize: 13, color: AppCores.textoSuave,
            ),
          ),
          const SizedBox(height: 18),

          // Toolbar: busca + filtros
          TextField(
            controller: _busca,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: 'Buscar por nome, id, ambiente ou personalidade…',
              prefixIcon: const Icon(Icons.search, size: 18),
              suffixIcon: _busca.text.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.close, size: 16),
                      onPressed: () { _busca.clear(); setState(() {}); },
                    ),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 36,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                _chip('todos',       'Todos'),
                _chip('energia',     '⚡ Energia'),
                _chip('temperatura', '🌡️ Temperatura'),
                _chip('porta',       '🚪 Porta'),
              ],
            ),
          ),
          const SizedBox(height: 18),

          // Resultados
          if (lista.isEmpty)
            const EmptyState(
              icone: Icons.search_off_rounded,
              titulo: 'Nenhum sensor encontrado',
              descricao: 'Tente outro termo ou troque o filtro.',
            )
          else
            LayoutBuilder(
              builder: (_, c) {
                const minW = 240.0;
                final cols = (c.maxWidth / minW).floor().clamp(1, 4);
                const gap = 12.0;
                final cardW = (c.maxWidth - gap * (cols - 1)) / cols;
                final ordenados = [...lista]..sort((a, b) {
                  if (a.grupo != b.grupo) return a.grupo.compareTo(b.grupo);
                  return a.id.compareTo(b.id);
                });
                return Wrap(
                  spacing: gap,
                  runSpacing: gap,
                  children: ordenados.map((s) {
                    final grupo = _grupos.firstWhere(
                      (g) => g.id == s.grupo,
                      orElse: () => Grupo(id: s.grupo, rotulo: s.grupo),
                    );
                    return SizedBox(
                      width: cardW,
                      child: SensorCard(
                        sensor: s,
                        nivelSaude: _nivelSaude(s),
                        ambienteLabel: grupo.rotulo,
                        onTap: () => context.go('/sensores/${s.id}'),
                      ),
                    );
                  }).toList(),
                );
              },
            ),
        ],
      ),
    );
  }

  Widget _chip(String valor, String rotulo) {
    final ativo = _tipoFiltro == valor;
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: ChoiceChip(
        label: Text(rotulo),
        selected: ativo,
        onSelected: (_) => setState(() => _tipoFiltro = valor),
        labelStyle: GoogleFonts.inter(
          fontSize: 12, fontWeight: FontWeight.w600,
          color: ativo ? Colors.white : AppCores.textoSuave,
        ),
        selectedColor: AppCores.azulNoite,
        backgroundColor: Colors.white,
        side: const BorderSide(color: AppCores.borda),
        shape: const StadiumBorder(),
      ),
    );
  }
}
