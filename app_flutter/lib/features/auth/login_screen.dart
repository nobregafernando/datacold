import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/supabase_config.dart';
import '../../core/theme.dart';
import 'auth_background.dart';
import 'auth_repository.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _senha = TextEditingController();
  final _auth = AuthRepository();
  bool _carregando = false;
  bool _verSenha = false;
  String? _erro;

  @override
  void dispose() {
    _email.dispose();
    _senha.dispose();
    super.dispose();
  }

  Future<void> _entrar() async {
    setState(() => _erro = null);
    if (!_form.currentState!.validate()) return;
    setState(() => _carregando = true);
    final err = await _auth.entrar(email: _email.text, senha: _senha.text);
    if (!mounted) return;
    if (err != null) {
      setState(() { _erro = err; _carregando = false; });
      return;
    }
    context.go('/dashboard');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: AuthBackground(
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Container(
                  padding: const EdgeInsets.fromLTRB(28, 32, 28, 28),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    boxShadow: [
                      BoxShadow(
                        color: AppCores.azulNoite.withOpacity(0.06),
                        blurRadius: 32, offset: const Offset(0, 12),
                      ),
                    ],
                    border: Border.all(color: AppCores.borda),
                  ),
                  child: Form(
                    key: _form,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        // Marca
                        Center(
                          child: Image.network(
                            SupabaseConfig.brandingUrl('01-primary-logo.png'),
                            height: 40,
                            errorBuilder: (_, __, ___) => Text(
                              'DataCold',
                              style: GoogleFonts.inter(
                                fontSize: 26, fontWeight: FontWeight.w800,
                                color: AppCores.azulNoite,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 24),
                        Text('Entre na sua conta',
                          textAlign: TextAlign.center,
                          style: GoogleFonts.inter(
                            fontSize: 20, fontWeight: FontWeight.w700,
                            color: AppCores.azulNoite, letterSpacing: -0.3,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text('Acesse o painel de monitoramento da sua planta.',
                          textAlign: TextAlign.center,
                          style: GoogleFonts.inter(
                            fontSize: 13, color: AppCores.textoSuave,
                          ),
                        ),
                        const SizedBox(height: 24),

                        // Email
                        TextFormField(
                          controller: _email,
                          keyboardType: TextInputType.emailAddress,
                          autocorrect: false,
                          autofillHints: const [AutofillHints.email],
                          decoration: const InputDecoration(
                            labelText: 'E-mail',
                            hintText: 'seu@email.com',
                            prefixIcon: Icon(Icons.email_outlined, size: 18),
                          ),
                          validator: (v) {
                            final t = (v ?? '').trim();
                            if (t.isEmpty) return 'Informe seu email.';
                            if (!t.contains('@') || !t.contains('.')) {
                              return 'Email inválido.';
                            }
                            return null;
                          },
                        ),
                        const SizedBox(height: 12),

                        // Senha
                        TextFormField(
                          controller: _senha,
                          obscureText: !_verSenha,
                          autofillHints: const [AutofillHints.password],
                          decoration: InputDecoration(
                            labelText: 'Senha',
                            hintText: '••••••••',
                            prefixIcon: const Icon(Icons.lock_outline, size: 18),
                            suffixIcon: IconButton(
                              icon: Icon(
                                _verSenha ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                                size: 18,
                              ),
                              onPressed: () => setState(() => _verSenha = !_verSenha),
                            ),
                          ),
                          validator: (v) => (v == null || v.isEmpty) ? 'Informe sua senha.' : null,
                          onFieldSubmitted: (_) => _entrar(),
                        ),

                        // Esqueci minha senha
                        Align(
                          alignment: Alignment.centerRight,
                          child: TextButton(
                            onPressed: () => context.push('/recuperar-senha'),
                            style: TextButton.styleFrom(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
                            ),
                            child: const Text('Esqueci minha senha'),
                          ),
                        ),

                        // Erro
                        if (_erro != null) ...[
                          const SizedBox(height: 6),
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: AppCores.erro.withOpacity(0.06),
                              border: Border.all(color: AppCores.erro.withOpacity(0.30)),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Row(
                              children: [
                                const Icon(Icons.error_outline, color: AppCores.erro, size: 18),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(_erro!,
                                    style: GoogleFonts.inter(
                                      fontSize: 12.5, color: AppCores.erro,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],

                        const SizedBox(height: 16),

                        // Botão Entrar
                        ElevatedButton(
                          onPressed: _carregando ? null : _entrar,
                          child: _carregando
                              ? const SizedBox(
                                  height: 20, width: 20,
                                  child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                                )
                              : const Text('Entrar'),
                        ),

                        const SizedBox(height: 18),

                        Text(
                          'Login multi-usuário · admin e operador são distinguidos pelo papel salvo na conta.',
                          textAlign: TextAlign.center,
                          style: GoogleFonts.inter(
                            fontSize: 11, color: AppCores.textoSuave, height: 1.5,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
