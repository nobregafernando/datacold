/**
 * Sanitizar · utilidades de saneamento e validação de entrada.
 *
 * Por que existe:
 *   - Defesa em profundidade. SQL injection já é impossível por construção
 *     (todo INSERT/UPDATE vai por PostgREST parametrizado), mas ainda
 *     queremos rejeitar entradas malformadas no front pra dar UX boa e
 *     evitar XSS quando algum nome/texto for renderizado via innerHTML.
 *   - Nunca confie em valores que vieram de input do usuário ao montar
 *     HTML. Use `Sanitizar.escapar()` antes de `innerHTML += ...`.
 *
 * Regra-mãe: SAÍDA sai escapada. ENTRADA sai limpa.
 */
class Sanitizar {

  /** Regex de e-mail (RFC 5322 simplificada, prática). */
  static RE_EMAIL = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  /** Nome humano: letras (Unicode), espaços, hífen, apóstrofo, ponto. */
  static RE_NOME_PROIBIDO = /[^\p{L}\s.\-']/u;

  /** Escapa HTML pra colocar com segurança em innerHTML. */
  static escapar(valor) {
    if (valor == null) return "";
    return String(valor)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Normaliza um e-mail: trim, lowercase, valida regex.
   * @returns {string|null} o e-mail normalizado, ou `null` se inválido.
   */
  static email(valor) {
    if (typeof valor !== "string") return null;
    const v = valor.trim().toLowerCase();
    if (!v || v.length > 254) return null;
    return Sanitizar.RE_EMAIL.test(v) ? v : null;
  }

  /**
   * Normaliza um nome humano: trim, colapsa espaços, limita tamanho.
   * Aceita apenas letras (incluindo acentos via Unicode), espaços,
   * hífen, apóstrofo e ponto (ex: "Dr. João D'Avila-Sousa").
   *
   * @returns {string|null} o nome limpo, ou `null` se inválido.
   */
  static nome(valor, { min = 2, max = 100 } = {}) {
    if (typeof valor !== "string") return null;
    const v = valor.trim().replace(/\s+/g, " ");
    if (v.length < min || v.length > max) return null;
    if (Sanitizar.RE_NOME_PROIBIDO.test(v)) return null;
    return v;
  }

  /**
   * Texto livre: trim, colapsa espaços, retira tags HTML, limita tamanho.
   * Usar pra campos como "descricao", "observacao", etc.
   */
  static texto(valor, { max = 1000 } = {}) {
    if (typeof valor !== "string") return "";
    let v = valor.trim();
    // Remove qualquer coisa que pareça tag HTML/JS
    v = v.replace(/<[^>]*>/g, "");
    v = v.replace(/\s+/g, " ");
    if (v.length > max) v = v.slice(0, max);
    return v;
  }

  /**
   * Detecta se uma string contém padrões clássicos de tentativa de SQL
   * injection. NÃO é uma defesa real (a defesa real é o PostgREST
   * parametrizado), mas serve pra dar UX preventiva.
   */
  static parecePerigoso(valor) {
    if (typeof valor !== "string") return false;
    return /\b(drop\s+table|union\s+select|insert\s+into|delete\s+from|update\s+\w+\s+set)\b/i.test(valor)
        || /(--|;|\/\*|\*\/)/.test(valor);
  }
}

if (typeof window !== "undefined") window.Sanitizar = Sanitizar;
