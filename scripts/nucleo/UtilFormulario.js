/**
 * Utilitários reusáveis dos formulários de auth.
 *
 *   UtilFormulario.acoplarOlhoSenha(input)
 *     Adiciona botão "👁/🚫👁" pra mostrar/ocultar a senha. Idempotente:
 *     pode chamar várias vezes no mesmo input sem duplicar.
 *
 *   UtilFormulario.acoplarConferenciaSenhas(input1, input2, alvoMsg)
 *     Live feedback enquanto digita: se senha2 ≠ senha, marca o input
 *     com erro e escreve a mensagem em `alvoMsg`. Limpa quando bate.
 *
 *   UtilFormulario.bloquearInjection(...valores)
 *     Lança Error se qualquer valor parecer SQL/XSS clássico. Usar
 *     ANTES de mandar pro servidor (mesmo que o servidor seja safe).
 */
class UtilFormulario {

  // ============ Olhinho mostrar/esconder senha ============
  static acoplarOlhoSenha(input) {
    if (!input) return;
    if (input.dataset.olhoAcoplado === "1") return;
    input.dataset.olhoAcoplado = "1";

    // Embrulha o input em um wrapper relativo
    const pai = input.parentNode;
    const wrap = document.createElement("div");
    wrap.className = "input-senha-wrap";
    pai.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "input-olho";
    btn.setAttribute("aria-label", "Mostrar senha");
    btn.title = "Mostrar/ocultar senha";
    btn.innerHTML = UtilFormulario._SVG_OLHO_ABERTO;
    wrap.appendChild(btn);

    btn.addEventListener("click", () => {
      const aberto = input.type === "password";
      input.type = aberto ? "text" : "password";
      btn.innerHTML = aberto ? UtilFormulario._SVG_OLHO_FECHADO : UtilFormulario._SVG_OLHO_ABERTO;
      btn.setAttribute("aria-label", aberto ? "Ocultar senha" : "Mostrar senha");
      // Mantém o foco no input pra UX boa
      input.focus();
    });
  }

  // ============ Live check: senha2 confere com senha ============
  static acoplarConferenciaSenhas(in1, in2, msgEl) {
    if (!in1 || !in2) return;
    const checar = () => {
      const v1 = in1.value, v2 = in2.value;
      if (!v2) {
        in2.classList.remove("input-erro","input-ok");
        if (msgEl) { msgEl.textContent = ""; msgEl.hidden = true; }
        return;
      }
      if (v1 === v2) {
        in2.classList.remove("input-erro");
        in2.classList.add("input-ok");
        if (msgEl) { msgEl.textContent = "Senhas conferem ✓"; msgEl.hidden = false; msgEl.className = "conferencia-ok"; }
      } else {
        in2.classList.remove("input-ok");
        in2.classList.add("input-erro");
        if (msgEl) { msgEl.textContent = "As senhas estão diferentes."; msgEl.hidden = false; msgEl.className = "conferencia-erro"; }
      }
    };
    in1.addEventListener("input", checar);
    in2.addEventListener("input", checar);
  }

  // ============ Bloqueio anti-injection ============
  /**
   * Recebe N strings. Se ANY parecer suspeita, lança Error.
   * Apenas defesa em profundidade — o servidor (PostgREST) é parametrizado
   * e imune a SQL injection por design. Mas a gente bloqueia antes pra
   * dar feedback ao usuário e não desperdiçar request.
   */
  static bloquearInjection(...valores) {
    for (const v of valores) {
      if (Sanitizar.parecePerigoso(v || "")) {
        throw new Error("Caracteres não permitidos detectados (parece tentativa de injeção). Use só caracteres normais nos campos.");
      }
    }
  }

  // ============ Ícones SVG inline ============
  static _SVG_OLHO_ABERTO = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  static _SVG_OLHO_FECHADO = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
}

if (typeof window !== "undefined") window.UtilFormulario = UtilFormulario;
