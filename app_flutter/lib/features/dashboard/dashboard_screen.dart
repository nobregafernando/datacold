import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../data/models/grupo.dart';
import '../../data/models/sensor.dart';
import '../../shared/widgets/bento_grid.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/section_card.dart';
import '../../shared/widgets/sensor_tile.dart';

/// Dashboard "Mapa da planta" — layout bento denso:
///   - Faixa de saudação com KPIs inline compactos
///   - 1 painel grande "Mapa da planta" com sub-headers por ambiente
///     e BentoGrid (auto-fit) de SensorTiles densos (~92px)
///   - Pull-to-refresh + clique no tile → detalhe
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
      if (!mounted) return;
      setState(() {
        _sensores = cat.sensores;
        _grupos = cat.grupos;
        _comIncidente = inc.map((i) => i.sensorId).toSet();
        _carregando = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _erro = '$e'; _carregando = false; });
    }
  }

  int _nivelSaude(Sensor s) {
    if (_comIncidente.contains(s.id)) return 1;
    if (s.historico) return 2;
    if (s.ativo) return 4;
    return 0;
  }

  String _primeiroNome() {
    final u = Supabase.instance.client.auth.currentUser;
    final nome = (u?.userMetadata?['nome'] as String?)
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

    final total       = _sensores.length;
    final ativos      = _sensores.where((s) => s.ativo).length;
    final historicos  = _sensores.where((s) => s.historico).length;
    final ambientes   = _grupos.length;
    final criticos    = _comIncidente.length;

    return RefreshIndicator(
      onRefresh: _carregar,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
        children: [
          // Saudação + KPIs inline numa faixa só
          _SaudacaoStrip(
            nome: _primeiroNome(),
            kpis: [
              _Kpi(valor: total.toString(),      label: 'sensores'),
              _Kpi(valor: ativos.toString(),     label: 'ao vivo',    cor: AppCores.ok),
              _Kpi(valor: criticos.toString(),   label: 'críticos',   cor: AppCores.erro),
              _Kpi(valor: historicos.toString(), label: 'histórico',  cor: AppCores.alerta),
              _Kpi(valor: ambientes.toString(),  label: 'ambientes'),
            ],
            onAtualizar: _carregar,
          ),
          const SizedBox(height: 16),

          // Mapa da planta — 1 painel grande
          SectionCard(
            titulo: 'Mapa da planta',
            subtitulo: 'Sensores agrupados por ambiente · clique pra abrir',
            icone: Icons.factory_rounded,
            corIcone: AppCores.azulMedio,
            child: _construirMapaDaPlanta(),
          ),
        ],
      ),
    );
  }

  Widget _construirMapaDaPlanta() {
    if (_sensores.isEmpty) {
      return const EmptyState(
        titulo: 'Catálogo vazio',
        descricao: 'A API não devolveu sensores.',
        icone: Icons.sensors_off_rounded,
      );
    }
    const ordem = [
      'extrusao', 'camara_congelados', 'camara_estoque',
      'graxaria', 'externo_campo_grande', 'externo_tres_lagoas',
    ];

    final blocos = <Widget>[];
    for (final gid in ordem) {
      final doGrupo = _sensores.where((s) => s.grupo == gid).toList();
      if (doGrupo.isEmpty) continue;
      final grupo = _grupos.firstWhere(
        (g) => g.id == gid,
        orElse: () => Grupo(id: gid, rotulo: gid),
      );
      if (blocos.isNotEmpty) blocos.add(const SizedBox(height: 18));
      blocos.add(_SubcabecalhoAmbiente(grupo: grupo, quantidade: doGrupo.length));
      blocos.add(const SizedBox(height: 8));
      blocos.add(BentoGrid(
        minLargura: 200,
        espaco: 10,
        itens: doGrupo
            .map((s) => SensorTile(
                  sensor: s,
                  nivelSaude: _nivelSaude(s),
                  ambienteLabel: grupo.rotulo,
                  ambienteCor: _corAmbiente(gid),
                  onTap: () => context.go('/sensores/${s.id}'),
                ))
            .toList(),
      ));
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: blocos,
    );
  }

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

// =================================================================
// Faixa de saudação com KPIs inline
// =================================================================
class _Kpi {
  const _Kpi({required this.valor, required this.label, this.cor});
  final String valor;
  final String label;
  final Color? cor;
}

class _SaudacaoStrip extends StatelessWidget {
  const _SaudacaoStrip({
    required this.nome,
    required this.kpis,
    required this.onAtualizar,
  });
  final String nome;
  final List<_Kpi> kpis;
  final VoidCallback onAtualizar;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 14, 14, 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppCores.borda),
        boxShadow: [
          BoxShadow(
            color: AppCores.azulNoite.withValues(alpha: 0.04),
            blurRadius: 18, offset: const Offset(0, 6),
          ),
        ],
      ),
      child: LayoutBuilder(
        builder: (_, c) {
          // Em telas estreitas, quebra em 2 linhas (saudação cima, KPIs baixo)
          final estreito = c.maxWidth < 720;
          final kpisRow = Wrap(
            spacing: 8, runSpacing: 8,
            children: kpis.map((k) => _KpiInline(kpi: k)).toList(),
          );
          if (estreito) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(child: _saudacao()),
                    IconButton(
                      onPressed: onAtualizar,
                      icon: const Icon(Icons.refresh_rounded, size: 18),
                      tooltip: 'Atualizar',
                      color: AppCores.azulMedio,
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                kpisRow,
              ],
            );
          }
          return Row(
            children: [
              Expanded(child: _saudacao()),
              kpisRow,
              const SizedBox(width: 6),
              IconButton(
                onPressed: onAtualizar,
                icon: const Icon(Icons.refresh_rounded, size: 18),
                tooltip: 'Atualizar',
                color: AppCores.azulMedio,
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _saudacao() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('DASHBOARD',
          style: GoogleFonts.inter(
            fontSize: 10, fontWeight: FontWeight.w800,
            letterSpacing: 1.6, color: AppCores.azulMedio,
          ),
        ),
        const SizedBox(height: 2),
        Text('Olá, $nome 👋',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: GoogleFonts.inter(
            fontSize: 18, fontWeight: FontWeight.w800,
            color: AppCores.azulNoite, letterSpacing: -0.3, height: 1.15,
          ),
        ),
      ],
    );
  }
}

class _KpiInline extends StatelessWidget {
  const _KpiInline({required this.kpi});
  final _Kpi kpi;

  @override
  Widget build(BuildContext context) {
    final cor = kpi.cor ?? AppCores.azulNoite;
    return Container(
      padding: const EdgeInsets.fromLTRB(11, 7, 11, 7),
      decoration: BoxDecoration(
        color: cor.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: cor.withValues(alpha: 0.18)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(kpi.valor,
            style: GoogleFonts.inter(
              fontSize: 16, fontWeight: FontWeight.w800,
              color: cor, height: 1.0, letterSpacing: -0.3,
            ),
          ),
          const SizedBox(width: 6),
          Text(kpi.label,
            style: GoogleFonts.inter(
              fontSize: 11, fontWeight: FontWeight.w600,
              color: AppCores.textoSuave,
            ),
          ),
        ],
      ),
    );
  }
}

// =================================================================
// Sub-cabeçalho de ambiente dentro do mapa da planta
// =================================================================
class _SubcabecalhoAmbiente extends StatelessWidget {
  const _SubcabecalhoAmbiente({required this.grupo, required this.quantidade});
  final Grupo grupo;
  final int quantidade;

  IconData _iconeAmb(String id) => switch (id) {
        'extrusao'              => Icons.factory_rounded,
        'camara_congelados'     => Icons.ac_unit_rounded,
        'camara_estoque'        => Icons.inventory_2_rounded,
        'graxaria'              => Icons.water_drop_rounded,
        'externo_campo_grande'  => Icons.location_on_rounded,
        'externo_tres_lagoas'   => Icons.location_on_rounded,
        _                       => Icons.dashboard_rounded,
      };

  Color _corAmb(String id) => switch (id) {
        'extrusao'              => const Color(0xFFB25410),
        'camara_congelados'     => const Color(0xFF0A83B8),
        'camara_estoque'        => const Color(0xFF2A4EA0),
        'graxaria'              => const Color(0xFF6B3EB8),
        'externo_campo_grande'  => const Color(0xFF1F7A3A),
        'externo_tres_lagoas'   => const Color(0xFF9A6A00),
        _                       => AppCores.azulMedio,
      };

  @override
  Widget build(BuildContext context) {
    final cor = _corAmb(grupo.id);
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.all(5),
          decoration: BoxDecoration(
            color: cor.withValues(alpha: 0.14),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Icon(_iconeAmb(grupo.id), size: 13, color: cor),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(grupo.rotulo,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: GoogleFonts.inter(
              fontSize: 12.5, fontWeight: FontWeight.w800,
              color: AppCores.azulNoite, letterSpacing: -0.1,
            ),
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
          decoration: BoxDecoration(
            color: AppCores.azulGelo,
            borderRadius: BorderRadius.circular(99),
          ),
          child: Text('$quantidade',
            style: GoogleFonts.inter(
              fontSize: 11, fontWeight: FontWeight.w800,
              color: AppCores.azulProfundo,
            ),
          ),
        ),
      ],
    );
  }
}
