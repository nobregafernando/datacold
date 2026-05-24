/// Perfil de usuário (espelha `perfis_usuarios` + email de `auth.users`).
/// Vem da RPC `listar_usuarios` (admin-only).
class Usuario {
  Usuario({
    required this.id,
    required this.nome,
    required this.email,
    required this.papel,
    required this.ativo,
    required this.criadoEm,
    this.atualizadoEm,
    this.ultimoAcesso,
  });

  final String id;
  final String nome;
  final String email;
  final String papel;          // 'admin' | 'operador'
  final bool ativo;
  final DateTime criadoEm;
  final DateTime? atualizadoEm;
  final DateTime? ultimoAcesso;

  bool get ehAdmin => papel == 'admin';

  factory Usuario.fromJson(Map<String, dynamic> j) => Usuario(
        id:            j['id'].toString(),
        nome:          (j['nome']  ?? '') as String,
        email:         (j['email'] ?? '') as String,
        papel:         (j['papel'] ?? 'operador') as String,
        ativo:         (j['ativo'] ?? true) as bool,
        criadoEm:      DateTime.tryParse((j['criado_em'] ?? '') as String)
                       ?? DateTime.now(),
        atualizadoEm:  j['atualizado_em'] is String
                       ? DateTime.tryParse(j['atualizado_em'] as String)
                       : null,
        ultimoAcesso:  j['ultimo_acesso'] is String
                       ? DateTime.tryParse(j['ultimo_acesso'] as String)
                       : null,
      );
}
