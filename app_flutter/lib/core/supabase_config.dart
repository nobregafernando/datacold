/// Constantes do projeto Supabase do DataCold.
///
/// A `anonKey` é pública por design (Supabase publica essa chave pra
/// uso em apps client-side — RLS é quem protege os dados de verdade).
class SupabaseConfig {
  static const String url = 'https://fcverbceppwdbveustvq.supabase.co';
  static const String anonKey =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
      '.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjdmVyYmNlcHB3ZGJ2ZXVzdHZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NTEzNTgsImV4cCI6MjA5NTEyNzM1OH0'
      '.bI6SExnbpMGKI3bvOK2aGGa-NoV5PN_OTRhwPp5hays';

  /// Bucket público de assets de branding (logos).
  static String brandingUrl(String arquivo) =>
      '$url/storage/v1/object/public/branding/$arquivo';

  /// MVP — usuário "Fernando" entra sem JWT.
  static const Map<String, dynamic> mvpUsuario = {
    'id': null,
    'nome': 'Fernando Nóbrega Alves',
    'email': 'fernandonobregaalves@gmail.com',
    'papel': 'admin',
  };
}
