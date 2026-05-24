import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';

import '../../../agentes/agente_reconstrutor.dart';
import '../../../agentes/analisador_sensor.dart';
import '../../../agentes/veredito.dart';
import '../../../core/theme.dart';
import '../../../data/api_client.dart';
import '../../../data/models/grupo.dart';
import '../../../data/models/ponto.dart';
import '../../../data/models/sensor.dart';
import '../../../shared/charts/time_series_chart.dart';
import '../../../shared/widgets/bento_grid.dart';
import '../../../shared/widgets/empty_state.dart';
import '../../../shared/widgets/reconstrucao_legend.dart';
import '../../../shared/widgets/section_card.dart';

/// Tela de detalhe do sensor — versão unificada que adapta os widgets
/// pelo tipo (energia/temperatura/porta). Substitui o stub.
///
/// Composição:
///   1. Banner lúdico colorido pela pior severidade do analisador
///   2. KPIs calculados por tipo (Wrap responsivo via BentoGrid)
///   3. Gráfico(s) com 3 séries (real / reconstruído / vazio)
///   4. Legenda da reconstrução
///   5. Análise automática (lista de vereditos)
class SensorDetalheScreen extends StatefulWidget {
  const SensorDetalheScreen({super.key, required this.sensorId});
  final String sensorId;

  @override
  State<SensorDetalheScreen> createState() => _SensorDetalheScreenState();
}

class _SensorDetalheScreenState extends State<SensorDetalheScreen> {
  final _api = ApiClient();
  Sensor? _sensor;
  Grupo? _grupo;
  List<Ponto> _pontosRaw = const [];
  ResultadoReconstrucao? _recon;
  List<Veredito> _vereditos = const [];
  String _janela = '-1h';
  bool _carregando = true;
  String? _erro;

  static const _janelas = ['-30m', '-1h', '-6h', '-24h', '-72h', '-167h'];
  static const _labelsJanela = ['30m', '1h', '6h', '24h', '3d', '7d'];

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  @override
  void didUpdateWidget(covariant SensorDetalheScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.sensorId != widget.sensorId) _carregar();
  }

  Future<void> _carregar() async {
    setState(() { _carregando = true; _erro = null; });
    try {
      final cat = await _api.catalogo();
      final s = cat.sensores.firstWhere(
        (x) => x.id == widget.sensorId,
        orElse: () => Sensor(
          id: widget.sensorId, rotulo: widget.sensorId,
          tipo: 'energia', grupo: '', status: 'historico',
        ),
      );
      final g = cat.grupos.firstWhere(
        (x) => x.id == s.grupo,
        orElse: () => Grupo(id: s.grupo, rotulo: s.grupo),
      );
      final dados = await _api.buscarDados(s.id, inicio: _janela, limite: 1000);

      // Reconstrutor: enriquece pontos com flags _reconstruido/_vazio
      final recon = AgenteReconstrutor(s).reconstruir(dados.pontos);

      // Análise: usa pontos ORIGINAIS (sem reconstruído) pra não mascarar incidente
      final vereditos = AnalisadorSensor(s, dados.pontos).avaliar();

      if (!mounted) return;
      setState(() {
        _sensor = s; _grupo = g;
        _pontosRaw = dados.pontos;
        _recon = recon;
        _vereditos = vereditos;
        _carregando = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _erro = '$e'; _carregando = false; });
    }
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

    final s = _sensor!;
    final sevMax = _piorSeveridade(_vereditos);
    final pontosEnriquecidos = _recon?.pontos ?? _pontosRaw;

    return RefreshIndicator(
      onRefresh: _carregar,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _Header(sensor: s, grupo: _grupo),
          const SizedBox(height: 14),
          _BannerLudico(severidade: sevMax, vereditos: _vereditos, sensor: s, ultimoPonto: _pontosRaw.isEmpty ? null : _pontosRaw.last),
          const SizedBox(height: 14),

          // Janela
          _SeletorJanela(
            janelaAtual: _janela,
            opcoes: _janelas, labels: _labelsJanela,
            onSelecionou: (j) { setState(() => _janela = j); _carregar(); },
            onAtualizar: _carregar,
          ),
          const SizedBox(height: 14),

          // Reconstrução legend
          if (_recon != null) ReconstrucaoLegend(resultado: _recon!),

          // Gráficos
          _Graficos(sensor: s, pontos: pontosEnriquecidos),
          const SizedBox(height: 14),

          // Análise automática
          SectionCard(
            titulo: 'Análise automática',
            subtitulo: 'O que os agentes estão detectando agora',
            icone: Icons.smart_toy_rounded,
            corIcone: const Color(0xFF6B3EB8),
            child: _ListaVereditos(vereditos: _vereditos),
          ),
        ],
      ),
    );
  }

  StatusVeredito _piorSeveridade(List<Veredito> vs) {
    if (vs.isEmpty) return StatusVeredito.ok;
    var max = StatusVeredito.ok;
    for (final v in vs) {
      if (_peso(v.status) > _peso(max)) max = v.status;
    }
    return max;
  }

  int _peso(StatusVeredito s) => switch (s) {
        StatusVeredito.crit => 3,
        StatusVeredito.warn => 2,
        StatusVeredito.info => 1,
        StatusVeredito.ok   => 0,
      };
}

// =================================================================
// Header da página
// =================================================================
class _Header extends StatelessWidget {
  const _Header({required this.sensor, this.grupo});
  final Sensor sensor;
  final Grupo? grupo;
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          'SENSOR · ${sensor.tipo.toUpperCase()}',
          style: GoogleFonts.inter(
            fontSize: 10, fontWeight: FontWeight.w800,
            letterSpacing: 1.4, color: AppCores.azulMedio,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          sensor.rotulo,
          style: GoogleFonts.inter(
            fontSize: 22, fontWeight: FontWeight.w800,
            color: AppCores.azulNoite, letterSpacing: -0.4,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          '${grupo?.rotulo ?? sensor.grupo} · ${sensor.id}',
          style: GoogleFonts.inter(
            fontSize: 12, color: AppCores.textoSuave,
          ),
        ),
      ],
    );
  }
}

// =================================================================
// Banner lúdico
// =================================================================
class _BannerLudico extends StatelessWidget {
  const _BannerLudico({
    required this.severidade,
    required this.vereditos,
    required this.sensor,
    required this.ultimoPonto,
  });
  final StatusVeredito severidade;
  final List<Veredito> vereditos;
  final Sensor sensor;
  final Ponto? ultimoPonto;

  Color _cor() => switch (severidade) {
        StatusVeredito.crit => AppCores.erro,
        StatusVeredito.warn => AppCores.alerta,
        StatusVeredito.info => AppCores.ciano,
        StatusVeredito.ok   => AppCores.ok,
      };

  String _emoji() => switch (severidade) {
        StatusVeredito.crit => '🔴',
        StatusVeredito.warn => '🟡',
        StatusVeredito.info => 'ℹ️',
        StatusVeredito.ok   => '✅',
      };

  String _titulo() {
    if (severidade == StatusVeredito.crit) {
      final c = vereditos.firstWhere((v) => v.critico, orElse: () => vereditos.first);
      return c.label;
    }
    if (severidade == StatusVeredito.warn) {
      final w = vereditos.firstWhere((v) => v.atencao, orElse: () => vereditos.first);
      return w.label;
    }
    return switch (sensor.tipo) {
      'energia'     => 'Energia saudável',
      'temperatura' => 'Temperatura na faixa ideal',
      'porta'       => 'Porta operando normal',
      _             => 'Sensor saudável',
    };
  }

  String _sub() {
    if (severidade == StatusVeredito.crit) {
      final c = vereditos.firstWhere((v) => v.critico, orElse: () => vereditos.first);
      return c.detalhe.isNotEmpty ? c.detalhe : c.resumo;
    }
    if (severidade == StatusVeredito.warn) {
      final w = vereditos.firstWhere((v) => v.atencao, orElse: () => vereditos.first);
      return w.detalhe.isNotEmpty ? w.detalhe : w.resumo;
    }
    return 'Todas as verificações dos agentes passaram.';
  }

  String _valor() {
    if (ultimoPonto == null) return '—';
    switch (sensor.tipo) {
      case 'energia':
        final t = (ultimoPonto!.lerNumero('tensao_fase_a') ?? 0) * (ultimoPonto!.lerNumero('corrente_fase_a') ?? 0) * (ultimoPonto!.lerNumero('fator_potencia_a') ?? 0);
        return '${(t / 1000).toStringAsFixed(1)} kW';
      case 'temperatura':
        final v = ultimoPonto!.lerNumero('temperatura');
        return v == null ? '—' : '${v.toStringAsFixed(1)}°C';
      case 'porta':
        return (ultimoPonto!.lerNumero('abertura_porta') ?? 0) > 0 ? 'ABERTA' : 'FECHADA';
    }
    return '—';
  }

  @override
  Widget build(BuildContext context) {
    final cor = _cor();
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
      decoration: BoxDecoration(
        color: cor.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: cor.withValues(alpha: 0.30)),
        boxShadow: [
          BoxShadow(
            color: cor.withValues(alpha: 0.08),
            blurRadius: 14, offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        children: [
          Text(_emoji(), style: const TextStyle(fontSize: 28)),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_titulo(),
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.inter(
                    fontSize: 16, fontWeight: FontWeight.w800,
                    color: AppCores.azulNoite,
                  ),
                ),
                const SizedBox(height: 2),
                Text(_sub(),
                  maxLines: 2, overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.inter(
                    fontSize: 12, color: AppCores.textoSuave, height: 1.4,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 14),
          Text(_valor(),
            style: GoogleFonts.inter(
              fontSize: 22, fontWeight: FontWeight.w800,
              color: cor, letterSpacing: -0.5,
            ),
          ),
        ],
      ),
    );
  }
}

// =================================================================
// Seletor de janela
// =================================================================
class _SeletorJanela extends StatelessWidget {
  const _SeletorJanela({
    required this.janelaAtual,
    required this.opcoes,
    required this.labels,
    required this.onSelecionou,
    required this.onAtualizar,
  });
  final String janelaAtual;
  final List<String> opcoes;
  final List<String> labels;
  final ValueChanged<String> onSelecionou;
  final VoidCallback onAtualizar;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (var i = 0; i < opcoes.length; i++)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ChoiceChip(
                      label: Text(labels[i]),
                      selected: janelaAtual == opcoes[i],
                      onSelected: (_) => onSelecionou(opcoes[i]),
                      labelStyle: GoogleFonts.inter(
                        fontSize: 12, fontWeight: FontWeight.w600,
                        color: janelaAtual == opcoes[i] ? Colors.white : AppCores.textoSuave,
                      ),
                      selectedColor: AppCores.azulNoite,
                      backgroundColor: Colors.white,
                      side: const BorderSide(color: AppCores.borda),
                      shape: const StadiumBorder(),
                    ),
                  ),
              ],
            ),
          ),
        ),
        IconButton(
          onPressed: onAtualizar,
          icon: const Icon(Icons.refresh_rounded, size: 18),
          tooltip: 'Atualizar',
          color: AppCores.azulMedio,
        ),
      ],
    );
  }
}

// =================================================================
// Gráficos por tipo
// =================================================================
class _Graficos extends StatelessWidget {
  const _Graficos({required this.sensor, required this.pontos});
  final Sensor sensor;
  final List<Ponto> pontos;

  @override
  Widget build(BuildContext context) {
    if (pontos.isEmpty) {
      return SectionCard(
        titulo: 'Gráficos',
        icone: Icons.show_chart_rounded,
        corIcone: AppCores.azulMedio,
        child: const SizedBox(
          height: 200,
          child: Center(child: Text('Sem dados na janela')),
        ),
      );
    }

    switch (sensor.tipo) {
      case 'energia':
        return BentoGrid(
          minLargura: 360, espaco: 12,
          itens: [
            _grafico('Corrente fase A (A)', 'corrente_fase_a', const Color(0xFF123B7A)),
            _grafico('Corrente fase B (A)', 'corrente_fase_b', const Color(0xFF1E6FD6)),
            _grafico('Corrente fase C (A)', 'corrente_fase_c', const Color(0xFF00B8F0)),
            _grafico('Tensão fase A (V)',   'tensao_fase_a',   const Color(0xFF6B3EB8)),
          ],
        );
      case 'temperatura':
        return _grafico('Temperatura (°C)', 'temperatura', AppCores.ciano, unidade: '°C');
      case 'porta':
        return _grafico('Sinal de abertura', 'abertura_porta', const Color(0xFF2A4EA0));
      default:
        return const SizedBox.shrink();
    }
  }

  Widget _grafico(String titulo, String campo, Color cor, {String unidade = ''}) {
    return SectionCard(
      titulo: titulo,
      icone: Icons.show_chart_rounded,
      corIcone: cor,
      child: TimeSeriesChart(
        pontos: pontos,
        campo: campo,
        titulo: titulo,
        unidade: unidade,
        corPrincipal: cor,
      ),
    );
  }
}

// =================================================================
// Lista de vereditos (análise)
// =================================================================
class _ListaVereditos extends StatelessWidget {
  const _ListaVereditos({required this.vereditos});
  final List<Veredito> vereditos;

  Color _cor(StatusVeredito s) => switch (s) {
        StatusVeredito.crit => AppCores.erro,
        StatusVeredito.warn => AppCores.alerta,
        StatusVeredito.info => AppCores.ciano,
        StatusVeredito.ok   => AppCores.ok,
      };

  IconData _icone(StatusVeredito s) => switch (s) {
        StatusVeredito.crit => Icons.error_rounded,
        StatusVeredito.warn => Icons.warning_amber_rounded,
        StatusVeredito.info => Icons.info_outline_rounded,
        StatusVeredito.ok   => Icons.check_circle_rounded,
      };

  @override
  Widget build(BuildContext context) {
    if (vereditos.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: EmptyState(
          icone: Icons.smart_toy_outlined,
          titulo: 'Sem dados',
          descricao: 'Os agentes ainda não puderam analisar.',
        ),
      );
    }
    // Ordena: crit > warn > info > ok
    final ord = [...vereditos]..sort((a, b) {
      int p(StatusVeredito s) => switch (s) {
            StatusVeredito.crit => 0,
            StatusVeredito.warn => 1,
            StatusVeredito.info => 2,
            StatusVeredito.ok   => 3,
          };
      return p(a.status).compareTo(p(b.status));
    });
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: ord.map((v) {
        final cor = _cor(v.status);
        return Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
          decoration: BoxDecoration(
            color: Colors.white,
            border: Border(
              left: BorderSide(color: cor, width: 3),
              top: const BorderSide(color: AppCores.borda),
              right: const BorderSide(color: AppCores.borda),
              bottom: const BorderSide(color: AppCores.borda),
            ),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            children: [
              Icon(_icone(v.status), color: cor, size: 16),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(v.label,
                      maxLines: 2, overflow: TextOverflow.ellipsis,
                      style: GoogleFonts.inter(
                        fontSize: 12.5, fontWeight: FontWeight.w700,
                        color: AppCores.azulNoite,
                      ),
                    ),
                    if (v.resumo.isNotEmpty)
                      Text(v.resumo,
                        maxLines: 2, overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.inter(
                          fontSize: 11.5, color: AppCores.textoSuave,
                        ),
                      ),
                    if (v.detalhe.isNotEmpty && v.detalhe != v.resumo) ...[
                      const SizedBox(height: 2),
                      Text(v.detalhe,
                        maxLines: 3, overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.inter(
                          fontSize: 11, color: AppCores.texto, height: 1.4,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }
}
