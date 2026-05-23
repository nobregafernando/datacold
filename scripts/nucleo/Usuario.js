/**
 * Representa um usuário autenticado da plataforma.
 */
class Usuario {
  constructor({ nome, email, papel = "operador" } = {}) {
    this.nome = nome;
    this.email = email;
    this.papel = papel;
    this.iniciais = Usuario.gerarIniciais(nome);
  }

  static gerarIniciais(nomeCompleto = "") {
    const partes = nomeCompleto.trim().split(/\s+/).filter(Boolean);
    if (partes.length === 0) return "?";
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }

  get rotuloPapel() {
    return {
      admin:     "Administrador",
      operador:  "Operador",
      visitante: "Visitante",
    }[this.papel] ?? this.papel;
  }

  serializar() {
    return { nome: this.nome, email: this.email, papel: this.papel };
  }

  static deserializar(obj) {
    if (!obj) return null;
    return new Usuario(obj);
  }
}

if (typeof window !== "undefined") window.Usuario = Usuario;
