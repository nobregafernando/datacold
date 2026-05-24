import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/supabase_config.dart';
import '../../core/theme.dart';
import 'auth_background.dart';
import 'auth_repository.dart';

class RecuperarSenhaScreen extends StatefulWidget {
  const RecuperarSenhaScreen({super.key});
  @override
  State<RecuperarSenhaScreen> createState() => _RecuperarSenhaScreenState();
}

class _RecuperarSenhaScreenState extends State<RecuperarSenhaScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _auth = AuthRepository();
  bool _carregando = false;
  bool _enviado = false;
  String? _erro;

  @override
  void dispose() { _email.dispose(); super.dispose(); }

  Future<void> _enviar() async {
    setState(() => _erro = null);
    if (!_form.currentState!.validate()) return;
    setState(() => _carregando = true);
    final err = await _auth.enviarLinkRecuperacao(_email.text);
    if (!mounted) return;
    setState(() {
      _carregando = false;
      if (err != null) { _erro = err; } else { _enviado = true; }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, size: 18),
          color: Colors.white,
          onPressed: () => context.pop(),
        ),
      ),
      extendBodyBehindAppBar: true,
      body: AuthBackground(
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
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
                  child: _enviado ? _construirSucesso() : _construirFormulario(),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _construirFormulario() {
    return Form(
      key: _form,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Image.network(
              SupabaseConfig.brandingUrl('04-icon-standalone.png'),
              height: 56,
              errorBuilder: (_, __, ___) => const Icon(Icons.lock_reset, size: 56, color: AppCores.azulMedio),
            ),
          ),
          const SizedBox(height: 18),
          Text('Recuperar senha',
            textAlign: TextAlign.center,
            style: GoogleFonts.inter(
              fontSize: 20, fontWeight: FontWeight.w700,
              color: AppCores.azulNoite, letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Informe seu email cadastrado. Vamos enviar um link pra você cadastrar uma nova senha.',
            textAlign: TextAlign.center,
            style: GoogleFonts.inter(
              fontSize: 13, color: AppCores.textoSuave, height: 1.5,
            ),
          ),
          const SizedBox(height: 22),
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
              if (!t.contains('@') || !t.contains('.')) return 'Email inválido.';
              return null;
            },
            onFieldSubmitted: (_) => _enviar(),
          ),
          if (_erro != null) ...[
            const SizedBox(height: 12),
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
          const SizedBox(height: 18),
          ElevatedButton(
            onPressed: _carregando ? null : _enviar,
            child: _carregando
                ? const SizedBox(
                    height: 20, width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                  )
                : const Text('Enviar link de recuperação'),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: () => context.pop(),
            child: const Text('Voltar pro login'),
          ),
        ],
      ),
    );
  }

  Widget _construirSucesso() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          width: 64, height: 64,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppCores.ok.withOpacity(0.12),
            shape: BoxShape.circle,
          ),
          child: const Icon(Icons.mark_email_read_outlined, color: AppCores.ok, size: 32),
        )._centralizar(),
        const SizedBox(height: 18),
        Text('Email enviado',
          textAlign: TextAlign.center,
          style: GoogleFonts.inter(
            fontSize: 20, fontWeight: FontWeight.w700, color: AppCores.azulNoite,
          ),
        ),
        const SizedBox(height: 10),
        Text(
          'Se houver uma conta com ${_email.text.trim()}, você vai receber um link nos próximos minutos. '
          'Verifique também a caixa de spam.',
          textAlign: TextAlign.center,
          style: GoogleFonts.inter(
            fontSize: 13, color: AppCores.textoSuave, height: 1.55,
          ),
        ),
        const SizedBox(height: 24),
        ElevatedButton(
          onPressed: () => context.go('/login'),
          child: const Text('Voltar pro login'),
        ),
      ],
    );
  }
}

extension on Widget {
  Widget _centralizar() => Center(child: this);
}
