/**
 * Página · Redefinir senha
 *
 * Recebe o usuário vindo do link enviado por e-mail. O Supabase Auth
 * coloca o token no HASH da URL no formato:
 *
 *   #access_token=eyJ...&refresh_token=...&expires_in=3600&type=recovery
 *
 * Pegamos o access_token desse hash e usamos pra chamar
 * PUT /auth/v1/user com a nova senha (via Autenticacao.redefinirSenha).
 *
 * Se não houver token no hash, mostramos a mensagem de "link inválido".
 */
class PaginaRedefinir {
  constructor() {
    this.form         = document.querySelector("[data-form]");
    this.inSenha      = document.querySelector("[data-senha]");
    this.elErroToken  = document.querySelector("[data-erro-token]");
    this.elErro       = document.querySelector("[data-erro]");
    this.elOk         = document.querySelector("[data-ok]");
    this.btn          = document.querySelector("[data-btn-redefinir]");

    this.elForcaSeg    = document.querySelector("[data-forca-segmentos]");
    this.elForcaRotulo = document.querySelector("[data-forca-rotulo]");
    this.requisitos    = {
      len:       document.querySelector('[data-req="len"]'),
      maiuscula: document.querySelector('[data-req="maiuscula"]'),
      minuscula: document.querySelector('[data-req="minuscula"]'),
      digito:    document.querySelector('[data-req="digito"]'),
      especial:  document.querySelector('[data-req="especial"]'),
      espaco:    document.querySelector('[data-req="espaco"]'),
    };

    this.accessToken = null;
  }

  iniciar() {
    this.accessToken = this._lerTokenDoHash();

    if (!this.accessToken) {
      // Sem token: avisa e desabilita form.
      if (this.elErroToken) this.elErroToken.hidden = false;
      this.form?.querySelectorAll("input, button").forEach(el => el.disabled = true);
      return;
    }

    // Limpa o hash da barra de endereço pra evitar o token aparecer em logs
    try { history.replaceState({}, "", location.pathname + location.search); } catch {}

    this.inSenha?.addEventListener("input", () => this._atualizarForca(this.inSenha.value));
    this.form?.addEventListener("submit", (ev) => this._redefinir(ev));
  }

  _lerTokenDoHash() {
    const h = location.hash || "";
    if (!h.startsWith("#")) return null;
    const p = new URLSearchParams(h.slice(1));
    const t = p.get("access_token");
    // Só aceita se for um recovery (não signup/magic-link)
    if (p.get("type") && p.get("type") !== "recovery") return null;
    return t || null;
  }

  _atualizarForca(senha) {
    const v = ValidadorSenha.validar(senha);
    if (this.elForcaSeg)    this.elForcaSeg.dataset.nivel = String(v.forca);
    if (this.elForcaRotulo) this.elForcaRotulo.textContent = ValidadorSenha.rotuloForca(v.forca);

    const s = senha || "";
    this._req("len",        s.length >= 10);
    this._req("maiuscula",  /[A-Z]/.test(s));
    this._req("minuscula",  /[a-z]/.test(s));
    this._req("digito",     /\d/.test(s));
    this._req("especial",   /[^A-Za-z0-9]/.test(s));
    this._req("espaco",     !!s && !/\s/.test(s));
  }
  _req(chave, ok) {
    const el = this.requisitos[chave];
    if (el) el.classList.toggle("ok", !!ok);
  }

  async _redefinir(ev) {
    ev.preventDefault();
    this._msg(null, null);

    const f = new FormData(this.form);
    const senha  = (f.get("senha")  || "").toString();
    const senha2 = (f.get("senha2") || "").toString();
    if (senha !== senha2) return this._msg("As senhas não conferem.", null);

    const v = ValidadorSenha.validar(senha);
    if (!v.ok) return this._msg("Senha fraca: " + v.motivos.join("; ") + ".", null);

    this._carregando(true);
    try {
      await Autenticacao.redefinirSenha(this.accessToken, senha);
      this._msg(null, "Senha redefinida com sucesso. Você já pode entrar com a nova senha. Redirecionando…");
      setTimeout(() => { window.location.href = "../../login/"; }, 1800);
    } catch (err) {
      this._msg(String(err.message || "Não foi possível redefinir agora."), null);
    } finally {
      this._carregando(false);
    }
  }

  _msg(erro, ok) {
    if (this.elErro) { this.elErro.hidden = !erro; this.elErro.textContent = erro || ""; }
    if (this.elOk)   { this.elOk.hidden   = !ok;   this.elOk.textContent   = ok   || ""; }
  }

  _carregando(estado) {
    if (!this.btn) return;
    this.btn.disabled = estado;
    this.btn.textContent = estado ? "Redefinindo…" : "Redefinir senha";
  }
}

document.addEventListener("DOMContentLoaded", () => new PaginaRedefinir().iniciar());
