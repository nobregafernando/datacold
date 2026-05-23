/**
 * Representa um usuário autenticado da plataforma.
 *
 * `id`     · uuid de `auth.users` no Supabase (null se sessão fake/MVP)
 * `papel`  · "admin" | "operador"
 */
class Usuario {
  constructor({ id = null, nome, email, papel = "operador" } = {}) {
    this.id = id;
    this.nome = nome;
    this.email = email;
    this.papel = papel === "admin" ? "admin" : "operador";
    this.iniciais = Usuario.gerarIniciais(nome);
  }

  static gerarIniciais(nomeCompleto = "") {
    const partes = String(nomeCompleto || "").trim().split(/\s+/).filter(Boolean);
    if (partes.length === 0) return "?";
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }

  get rotuloPapel() {
    return { admin: "Administrador", operador: "Operador" }[this.papel] ?? this.papel;
  }

  get ehAdmin()    { return this.papel === "admin"; }
  get ehOperador() { return this.papel === "operador"; }

  serializar() {
    return { id: this.id, nome: this.nome, email: this.email, papel: this.papel };
  }

  static deserializar(obj) {
    if (!obj) return null;
    return new Usuario(obj);
  }
}

if (typeof window !== "undefined") window.Usuario = Usuario;
