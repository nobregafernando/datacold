import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';

import '../../core/theme.dart';
import '../../data/models/notificacao.dart';
import '../../data/notificacoes_service.dart';

/// Sino do AppBar com badge dinâmico + dropdown das últimas notificações.
/// Escuta o singleton [NotificacoesService] e re-renderiza sem polling
/// próprio. Pisca quando uma nova crítica chega.
class SinoNotificacoes extends StatefulWidget {
  const SinoNotificacoes({super.key});

  @override
  State<SinoNotificacoes> createState() => _SinoNotificacoesState();
}

class _SinoNotificacoesState extends State<SinoNotificacoes>
    with SingleTickerProviderStateMixin {
  late final AnimationController _piscar;
  StreamSubscription<int>? _subCritica;

  @override
  void initState() {
    super.initState();
    _piscar = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
      lowerBound: 0.8, upperBound: 1.2,
    );
    _subCritica = NotificacoesService.instancia.aoChegarCritica.listen((_) {
      _piscar.forward(from: 0.8).then((_) => _piscar.animateBack(1.0));
    });
  }

  @override
  void dispose() {
    _subCritica?.cancel();
    _piscar.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: NotificacoesService.instancia,
      builder: (_, __) {
        final svc = NotificacoesService.instancia;
        final cor = svc.temCritica
            ? AppCores.erro
            : (svc.temNaoLidas ? AppCores.atencao : null);

        final icone = ScaleTransition(
          scale: _piscar,
          child: Icon(
            svc.temCritica
                ? Icons.notifications_active_rounded
                : Icons.notifications_outlined,
            color: AppCores.azulNoite,
            size: 22,
          ),
        );

        return IconButton(
          tooltip: svc.total == 0
              ? 'Notificações'
              : '${svc.total} não lidas'
                  '${svc.critica > 0 ? " · ${svc.critica} crítica${svc.critica == 1 ? "" : "s"}" : ""}',
          onPressed: () => _abrirDropdown(context),
          icon: cor == null
              ? icone
              : Badge(
                  backgroundColor: cor,
                  textColor: Colors.white,
                  label: Text(
                    svc.total > 99 ? '99+' : '${svc.total}',
                    style: GoogleFonts.inter(
                      fontSize: 10, fontWeight: FontWeight.w800,
                    ),
                  ),
                  child: icone,
                ),
        );
      },
    );
  }

  Future<void> _abrirDropdown(BuildContext context) async {
    await showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        minChildSize: 0.3,
        maxChildSize: 0.9,
        builder: (_, scroll) => _DropdownContent(scroll: scroll),
      ),
    );
  }
}

// =====================================================================

class _DropdownContent extends StatelessWidget {
  const _DropdownContent({required this.scroll});
  final ScrollController scroll;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: NotificacoesService.instancia,
      builder: (_, __) {
        final svc = NotificacoesService.instancia;
        final itens = svc.recentes;
        return Column(
          children: [
            // Grab handle + header
            const SizedBox(height: 8),
            Container(
              width: 38, height: 4,
              decoration: BoxDecoration(
                color: AppCores.borda,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 8, 12),
              child: Row(
                children: [
                  Icon(
                    svc.temCritica
                        ? Icons.notifications_active_rounded
                        : Icons.notifications_outlined,
                    color: svc.temCritica ? AppCores.erro : AppCores.azulNoite,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Notificações',
                      style: GoogleFonts.inter(
                        fontSize: 16, fontWeight: FontWeight.w700,
                        color: AppCores.azulNoite,
                      ),
                    ),
                  ),
                  if (svc.total > 0)
                    TextButton.icon(
                      onPressed: () async {
                        await svc.marcarTodasLidas();
                      },
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                      ),
                      icon: const Icon(Icons.done_all_rounded, size: 18),
                      label: const Text('Marcar todas'),
                    ),
                  IconButton(
                    tooltip: 'Ver todas',
                    icon: const Icon(Icons.open_in_full_rounded, size: 18),
                    onPressed: () {
                      Navigator.of(context).pop();
                      context.go('/notificacoes');
                    },
                  ),
                ],
              ),
            ),
            const Divider(height: 1, color: AppCores.borda),
            Expanded(
              child: itens.isEmpty
                  ? _Vazio()
                  : ListView.separated(
                      controller: scroll,
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      itemCount: itens.length,
                      separatorBuilder: (_, __) =>
                          const Divider(height: 1, color: AppCores.borda),
                      itemBuilder: (_, i) => _NotifTile(notif: itens[i]),
                    ),
            ),
          ],
        );
      },
    );
  }
}

class _Vazio extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.celebration_outlined,
                size: 42, color: AppCores.azulMedio),
            const SizedBox(height: 10),
            Text(
              'Tudo limpo!',
              style: GoogleFonts.inter(
                fontSize: 15, fontWeight: FontWeight.w700,
                color: AppCores.azulNoite,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Nenhuma notificação ativa.',
              style: GoogleFonts.inter(
                fontSize: 12, color: AppCores.textoSuave,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NotifTile extends StatelessWidget {
  const _NotifTile({required this.notif});
  final Notificacao notif;

  Color get _cor {
    switch (notif.severidade) {
      case 'critica': return AppCores.erro;
      case 'alta':    return AppCores.atencao;
      case 'media':   return AppCores.azulMedio;
      default:        return AppCores.textoSuave;
    }
  }

  String get _selo {
    switch (notif.severidade) {
      case 'critica': return 'CRÍTICA';
      case 'alta':    return 'ATENÇÃO';
      case 'media':   return 'MÉDIA';
      default:        return 'INFO';
    }
  }

  String _quando(DateTime d) {
    final dif = DateTime.now().difference(d);
    if (dif.inMinutes < 1) return 'agora';
    if (dif.inMinutes < 60) return '${dif.inMinutes} min atrás';
    if (dif.inHours   < 24) return '${dif.inHours} h atrás';
    if (dif.inDays    < 7)  return '${dif.inDays} d atrás';
    return DateFormat('dd/MM HH:mm', 'pt_BR').format(d);
  }

  @override
  Widget build(BuildContext context) {
    final naoLida = !notif.lida;
    return Material(
      color: naoLida ? const Color(0xFFF5F9FF) : Colors.white,
      child: InkWell(
        onTap: () async {
          await NotificacoesService.instancia.marcarLida(notif.id);
          if (notif.sensorId != null && context.mounted) {
            Navigator.of(context).pop();
            context.go('/sensores/${notif.sensorId}');
          }
        },
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 4, height: 36,
                decoration: BoxDecoration(
                  color: _cor,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: _cor.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            _selo,
                            style: GoogleFonts.inter(
                              fontSize: 9, fontWeight: FontWeight.w800,
                              color: _cor, letterSpacing: 0.4,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _quando(notif.criadaEm),
                            style: GoogleFonts.inter(
                              fontSize: 11, color: AppCores.textoSuave,
                            ),
                          ),
                        ),
                        if (naoLida)
                          Container(
                            width: 8, height: 8,
                            decoration: const BoxDecoration(
                              shape: BoxShape.circle, color: AppCores.azulMedio,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      notif.titulo,
                      maxLines: 2, overflow: TextOverflow.ellipsis,
                      style: GoogleFonts.inter(
                        fontSize: 13, fontWeight: FontWeight.w700,
                        color: AppCores.azulNoite,
                      ),
                    ),
                    if (notif.mensagem.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        notif.mensagem,
                        maxLines: 2, overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.inter(
                          fontSize: 12, color: AppCores.textoSuave,
                          height: 1.3,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              IconButton(
                tooltip: 'Arquivar',
                visualDensity: VisualDensity.compact,
                icon: const Icon(Icons.inventory_2_outlined,
                    size: 16, color: AppCores.textoSuave),
                onPressed: () => NotificacoesService.instancia.arquivar(notif.id),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
