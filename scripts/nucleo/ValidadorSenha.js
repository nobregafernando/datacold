/**
 * ValidadorSenha · regra única de senha forte usada em login, criação
 * de conta e redefinição.
 *
 * Regras (todas obrigatórias para `ok = true`):
 *   - mínimo 8 caracteres
 *   - máximo 128 caracteres (Supabase Auth aceita até esse limite)
 *   - pelo menos 1 letra MAIÚSCULA
 *   - pelo menos 1 letra minúscula
 *   - pelo menos 1 dígito
 *   - pelo menos 1 caractere especial (não-alfanumérico)
 *   - sem espaços (evita typos invisíveis e copy/paste sujo)
 *
 * Indicador de força (`forca`, 0 a 4) é APENAS visual — não substitui as
 * regras. Mesmo uma senha 4/4 que não cumpre alguma regra obrigatória
 * volta `ok = false`.
 */
class ValidadorSenha {

  static MIN = 8;
  static MAX = 128;
  static RE_MAIUSCULA = /[A-Z]/;
  static RE_MINUSCULA = /[a-z]/;
  static RE_DIGITO    = /\d/;
  static RE_ESPECIAL  = /[^A-Za-z0-9]/;
  static RE_ESPACO    = /\s/;

  /**
   * @returns {{ ok: boolean, motivos: string[], forca: number }}
   */
  static validar(senha) {
    const motivos = [];
    const s = senha ?? "";

    if (s.length < ValidadorSenha.MIN)         motivos.push(`pelo menos ${ValidadorSenha.MIN} caracteres`);
    if (s.length > ValidadorSenha.MAX)         motivos.push(`no máximo ${ValidadorSenha.MAX} caracteres`);
    if (!ValidadorSenha.RE_MAIUSCULA.test(s))  motivos.push("pelo menos 1 letra MAIÚSCULA");
    if (!ValidadorSenha.RE_MINUSCULA.test(s))  motivos.push("pelo menos 1 letra minúscula");
    if (!ValidadorSenha.RE_DIGITO.test(s))     motivos.push("pelo menos 1 número");
    if (!ValidadorSenha.RE_ESPECIAL.test(s))   motivos.push("pelo menos 1 caractere especial (ex: ! @ # $)");
    if (ValidadorSenha.RE_ESPACO.test(s))      motivos.push("sem espaços");

    return {
      ok: motivos.length === 0,
      motivos,
      forca: ValidadorSenha.forca(s),
    };
  }

  /**
   * Calcula 0-4 baseado em diversidade + tamanho.
   * 0 = vazia / muito curta
   * 1 = curta ou com só 1 tipo de caractere
   * 2 = média
   * 3 = boa
   * 4 = forte (≥14 chars + 4 tipos)
   */
  static forca(senha) {
    const s = senha ?? "";
    if (!s) return 0;

    let tipos = 0;
    if (ValidadorSenha.RE_MAIUSCULA.test(s)) tipos++;
    if (ValidadorSenha.RE_MINUSCULA.test(s)) tipos++;
    if (ValidadorSenha.RE_DIGITO.test(s))    tipos++;
    if (ValidadorSenha.RE_ESPECIAL.test(s))  tipos++;

    let pontos = 0;
    if (s.length >= 8)  pontos++;
    if (s.length >= 12) pontos++;
    if (s.length >= 16) pontos++;

    const score = Math.min(4, Math.floor((tipos + pontos) / 2));
    return Math.max(0, score);
  }

  /** Rótulo curto para barra de força. */
  static rotuloForca(nivel) {
    return ["muito fraca","fraca","média","boa","forte"][nivel] || "—";
  }
}

if (typeof window !== "undefined") window.ValidadorSenha = ValidadorSenha;
