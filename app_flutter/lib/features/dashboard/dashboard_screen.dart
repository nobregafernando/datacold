import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../data/models/grupo.dart';
import '../../data/models/sensor.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/kpi_card.dart';
import '../../shared/widgets/section_card.dart';
import '../../shared/widgets/sensor_card.dart';

/// Dashboard — KPIs no topo + grid de sensores agrupados por ambiente.
/// Tudo rolável e responsivo (auto-fit em qualquer largura).
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});
  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  final _api = ApiClient();
  List<Sensor> _sensores = [];
  List<Grupo> _grupos = [];
  Set<String> _comIncidente = {};
  bool _carregando = true;
  String? _erro;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() { _carregando = true; _erro = null; });
    try {
      final cat = await _api.catalogo();
      final inc = await _api.incidentesAtivosResumo();
      setState(() {
        _sensores = cat.sensores;
        _grupos   = cat.grupos;
        _comIncidente = inc.map((i) => i.sensorId).toSet();
        _carregando = false;
      });
    } catch (e) {
      setState(() { _erro = '$e'; _carregando = false; });
    }
  }

  int _nivelSaude(Sensor s) {
    if (_comIncidente.contains(s.id)) return 1;
    if (s.historico) return 2;
    if (s.ativo) return 4;
    return 0;
  }

  String _nomeUsuario() {
    final u = Supabase.instance.client.auth.currentUser;
    final nome = u?.userMetadata?['nome'] as String?
        ?? u?.email?.split('@').first
        ?? 'usuário';
    return nome.split(' ').first;
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

    final total = _sensores.length;
    final ativos = _sensores.where((s) => s.ativo).length;
    final historicos = _sensores.where((s) => s.historico).length;
    final ambientes = _grupos.length;

    return RefreshIndicator(
      onRefresh: _carregar,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          // Cabeçalho saudação
          Text('Dashboard',
            style: GoogleFonts.inter(
              fontSize: 11, fontWeight: FontWeight.w800,
              letterSpacing: 1.4, color: AppCores.azulMedio,
            ),
          ),
          const SizedBox(height: 4),
          Text('Olá, ${_nomeUsuario()} 👋',
            style: GoogleFonts.inter(
              fontSize: 24, fontWeight: FontWeight.w800,
              color: AppCores.azulNoite, letterSpacing: -0.4,
            ),
          ),
          const SizedBox(height: 4),
          Text('Visão geral da sua infraestrutura em tempo real.',
            style: GoogleFonts.inter(
              fontSize: 13, color: AppCores.textoSuave,
            ),
          ),
          const SizedBox(height: 22),

          // KPIs — Wrap pra não estourar em telas estreitas
          LayoutBuilder(
            builder: (_, c) {
              final cols = c.maxWidth >= 720 ? 4 : (c.maxWidth >= 480 ? 2 : 1);
              final largura = (c.maxWidth - 12 * (cols - 1)) / cols;
              return Wrap(
                spacing: 12, runSpacing: 12,
                children: [
                  SizedBox(width: largura, child: KpiCard(valor: '$total',       rotulo: 'SENSORES',   icone: Icons.sensors_rounded,      cor: AppCores.azulMedio)),
                  SizedBox(width: largura, child: KpiCard(valor: '$ativos',      rotulo: 'AO VIVO',    icone: Icons.bolt_rounded,         cor: AppCores.ok)),
                  SizedBox(width: largura, child: KpiCard(valor: '$historicos',  rotulo: 'HISTÓRICOS', icone: Icons.history_rounded,      cor: AppCores.alerta)),
                  SizedBox(width: largura, child: KpiCard(valor: '$ambientes',   rotulo: 'AMBIENTES',  icone: Icons.factory_rounded,      cor: AppCores.ciano)),
                ],
              );
            },
          ),

          const SizedBox(height: 24),

          // Sensores agrupados por ambiente
          ..._construirBlocosPorAmbiente(),
        ],
      ),
    );
  }

  List<Widget> _construirBlocosPorAmbiente() {
    if (_sensores.isEmpty) {
      return [
        SectionCard(
          titulo: 'Sem sensores',
          icone: Icons.sensors_off_rounded,
          child: const EmptyState(
            titulo: 'Catálogo vazio',
            descricao: 'A API não devolveu sensores.',
            icone: Icons.sensors_off_rounded,
          ),
        ),
      ];
    }

    const ordem = [
      'extrusao', 'camara_congelados', 'camara_estoque',
      'graxaria', 'externo_campo_grande', 'externo_tres_lagoas',
    ];
    final grupos = ordem
        .map((id) => _grupos.firstWhere(
              (g) => g.id == id,
              orElse: () => Grupo(id: id, rotulo: id),
            ))
        .where((g) => _sensores.any((s) => s.grupo == g.id))
        .toList();

    return grupos.map((g) {
      final sensoresDoGrupo = _sensores.where((s) => s.grupo == g.id).toList();
      return Padding(
        padding: const EdgeInsets.only(bottom: 18),
        child: SectionCard(
          titulo: g.rotulo,
          subtitulo: '${sensoresDoGrupo.length} sensor${sensoresDoGrupo.length > 1 ? "es" : ""}',
          icone: _iconeAmbiente(g.id),
          corIcone: _corAmbiente(g.id),
          child: LayoutBuilder(
            builder: (_, c) {
              // Grid auto-fit pra prevenir overflow
              final minW = 220.0;
              final cols = (c.maxWidth / minW).floor().clamp(1, 4);
              final gap = 12.0;
              final cardW = (c.maxWidth - gap * (cols - 1)) / cols;
              return Wrap(
                spacing: gap,
                runSpacing: gap,
                children: sensoresDoGrupo.map((s) => SizedBox(
                  width: cardW,
                  child: SensorCard(
                    sensor: s,
                    nivelSaude: _nivelSaude(s),
                    onTap: () => context.go('/sensores/${s.id}'),
                  ),
                )).toList(),
              );
            },
          ),
        ),
      );
    }).toList();
  }

  IconData _iconeAmbiente(String id) => switch (id) {
        'extrusao'              => Icons.factory_rounded,
        'camara_congelados'     => Icons.ac_unit_rounded,
        'camara_estoque'        => Icons.inventory_2_rounded,
        'graxaria'              => Icons.water_drop_rounded,
        'externo_campo_grande'  => Icons.location_on_rounded,
        'externo_tres_lagoas'   => Icons.location_on_rounded,
        _                       => Icons.dashboard_rounded,
      };

  Color _corAmbiente(String id) => switch (id) {
        'extrusao'              => const Color(0xFFB25410),
        'camara_congelados'     => const Color(0xFF0A83B8),
        'camara_estoque'        => const Color(0xFF2A4EA0),
        'graxaria'              => const Color(0xFF6B3EB8),
        'externo_campo_grande'  => const Color(0xFF1F7A3A),
        'externo_tres_lagoas'   => const Color(0xFF9A6A00),
        _                       => AppCores.azulMedio,
      };
}
