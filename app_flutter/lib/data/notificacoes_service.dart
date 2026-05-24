import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'api_client.dart';
import 'models/notificacao.dart';

/// Singleton ChangeNotifier que mantém o sino do app sempre fresco.
///
/// - Polling **adaptativo**: 5 s com o app no foreground, 60 s em background.
/// - Liga/desliga sozinho conforme o estado de auth: sem sessão, ninguém
///   pinga.
/// - Detecta **escalada crítica**: quando o número de notificações críticas
///   sobe entre dois ciclos, emite no stream `aoChegarCritica` — usado pra
///   piscar o sino e tocar ToastBus.
/// - Mantém em memória as últimas N (default 20) pra preencher o dropdown
///   sem nova chamada.
class NotificacoesService extends ChangeNotifier with WidgetsBindingObserver {
  NotificacoesService._() {
    WidgetsBinding.instance.addObserver(this);
    Supabase.instance.client.auth.onAuthStateChange.listen(_aoMudarAuth);
  }
  static final NotificacoesService instancia = NotificacoesService._();

  final ApiClient _api = ApiClient();
  Timer? _ticker;
  bool _ativo = false;
  bool _emPrimeiroPlano = true;

  // Estado público
  int _total = 0;
  int _critica = 0;
  List<Notificacao> _recentes = const [];

  int get total                  => _total;
  int get critica                => _critica;
  bool get temNaoLidas           => _total > 0;
  bool get temCritica            => _critica > 0;
  List<Notificacao> get recentes => _recentes;

  /// Stream que emite o NOVO contador de críticas SEMPRE QUE ele sobe.
  /// Telas escutam pra piscar o sino e/ou disparar toast.
  final _aoChegarCriticaCtl = StreamController<int>.broadcast();
  Stream<int> get aoChegarCritica => _aoChegarCriticaCtl.stream;

  /// Chamado uma vez no boot (após Supabase.initialize) por main.dart.
  /// Idempotente — chamadas repetidas são ignoradas.
  void iniciar() {
    if (_ativo) return;
    _ativo = true;
    if (Supabase.instance.client.auth.currentSession != null) {
      _agendar(imediato: true);
    }
  }

  /// Força uma atualização agora (pull-to-refresh, ação manual, etc).
  Future<void> atualizarAgora() async {
    await _ciclo();
  }

  // ===================================================================
  // Ações que mexem no estado — refazem o ciclo pra refletir já
  // ===================================================================

  Future<bool> marcarLida(String id) async {
    final ok = await _api.marcarNotificacaoLida(id);
    if (ok) unawaited(atualizarAgora());
    return ok;
  }

  Future<bool> arquivar(String id) async {
    final ok = await _api.arquivarNotificacao(id);
    if (ok) unawaited(atualizarAgora());
    return ok;
  }

  Future<bool> marcarTodasLidas() async {
    final ok = await _api.marcarTodasLidas();
    if (ok) unawaited(atualizarAgora());
    return ok;
  }

  // ===================================================================
  // Internals
  // ===================================================================

  void _aoMudarAuth(AuthState s) {
    final logado = s.session != null;
    if (logado && _ativo) {
      _agendar(imediato: true);
    } else if (!logado) {
      _ticker?.cancel();
      _ticker = null;
      _total = 0; _critica = 0; _recentes = const [];
      notifyListeners();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final visivel = state == AppLifecycleState.resumed;
    if (visivel == _emPrimeiroPlano) return;
    _emPrimeiroPlano = visivel;
    if (Supabase.instance.client.auth.currentSession != null) {
      _agendar(imediato: visivel);
    }
  }

  void _agendar({bool imediato = false}) {
    _ticker?.cancel();
    final periodo = _emPrimeiroPlano
        ? const Duration(seconds: 5)
        : const Duration(seconds: 60);
    _ticker = Timer.periodic(periodo, (_) => _ciclo());
    if (imediato) unawaited(_ciclo());
  }

  Future<void> _ciclo() async {
    if (Supabase.instance.client.auth.currentSession == null) return;

    // Roda em paralelo
    final results = await Future.wait([
      _api.contarNaoLidas(),
      _api.listarMinhasNotificacoes(limite: 20, status: 'ativas'),
    ]);
    final contagem = results[0] as ({int total, int critica});
    final lista    = results[1] as ({List<Notificacao> itens, int total});

    final criticaAntes = _critica;
    _total    = contagem.total;
    _critica  = contagem.critica;
    _recentes = lista.itens;

    if (_critica > criticaAntes) {
      _aoChegarCriticaCtl.add(_critica);
    }
    notifyListeners();
  }

  @override
  void dispose() {
    _ticker?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _aoChegarCriticaCtl.close();
    super.dispose();
  }
}
