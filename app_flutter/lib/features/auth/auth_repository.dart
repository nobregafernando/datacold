import 'package:supabase_flutter/supabase_flutter.dart';

/// Wrapper sobre `supabase_flutter` pra centralizar login/logout/recover.
/// Mantém o contrato simples: telas chamam métodos, recebem result + erro
/// legível em português.
class AuthRepository {
  AuthRepository({SupabaseClient? client})
      : _client = client ?? Supabase.instance.client;

  final SupabaseClient _client;

  /// Sessão atual (null se deslogado).
  Session? get sessao => _client.auth.currentSession;

  /// Usuário do JWT (null se deslogado).
  User? get usuario => _client.auth.currentUser;

  /// Stream de mudanças de sessão (pra GoRouter listenable).
  Stream<AuthState> get mudancas => _client.auth.onAuthStateChange;

  // ===================================================================

  /// Login com email + senha. Retorna mensagem de erro ou null em sucesso.
  Future<String?> entrar({required String email, required String senha}) async {
    try {
      final r = await _client.auth.signInWithPassword(
        email: email.trim(),
        password: senha,
      );
      if (r.session == null) return 'Não foi possível iniciar a sessão.';
      return null;
    } on AuthException catch (e) {
      return _traduzir(e.message);
    } catch (e) {
      return 'Erro inesperado: $e';
    }
  }

  /// Envia link de redefinição de senha por email.
  Future<String?> enviarLinkRecuperacao(String email) async {
    try {
      await _client.auth.resetPasswordForEmail(
        email.trim(),
        redirectTo: 'datacold://redefinir-senha',
      );
      return null;
    } on AuthException catch (e) {
      return _traduzir(e.message);
    } catch (e) {
      return 'Erro inesperado: $e';
    }
  }

  Future<void> sair() async {
    await _client.auth.signOut();
  }

  // ===================================================================

  /// Traduz mensagens comuns do Supabase Auth.
  String _traduzir(String m) {
    final lower = m.toLowerCase();
    if (lower.contains('invalid login credentials')) {
      return 'Email ou senha incorretos.';
    }
    if (lower.contains('email not confirmed')) {
      return 'Confirme seu email antes de entrar.';
    }
    if (lower.contains('rate limit')) {
      return 'Muitas tentativas. Aguarde alguns minutos.';
    }
    if (lower.contains('user not found') || lower.contains('user does not exist')) {
      return 'Não encontramos uma conta com esse email.';
    }
    if (lower.contains('network')) {
      return 'Sem conexão com o servidor. Tente de novo.';
    }
    return m;  // devolve o original em último caso
  }
}
