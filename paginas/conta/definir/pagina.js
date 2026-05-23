/**
 * Página · Definir conta (após o convite por email)
 *
 * Fluxo:
 *   1. Operador clica no link do email.
 *   2. URL chega com `#access_token=...&type=recovery&...`.
 *   3. Página lê o token, descobre o email do usuário (via /auth/v1/user),
 *      mostra na tela e pede nome + senha.
 *   4. Submit envia PUT /auth/v1/user com {password, data:{nome}}.
 *   5. Redireciona pra /paginas/login/?email=<email>.
 */
class PaginaDefinir {
  constructor() {
    this.form         = document.querySelector("[data-form]");
    this.inSenha      = document.querySelector("[data-senha]");
    this.elEmailInfo  = document.querySelector("[data-email-info]");
    this.elEmail      = document.querySelector("[data-email]");
    this.elErroToken  = document.querySelector("[data-erro-token]");
    this.elErro       = document.querySelector("[data-erro]");
    this.elOk         = document.querySelector("[data-ok]");
    this.btn          = document.querySelector("[data-btn-finalizar]");

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
    this.email = null;
  }

  async iniciar() {
    this.accessToken = this._lerTokenDoHash();

    if (!this.accessToken) {
      if (this.elErroToken) this.elErroToken.hidden = false;
      this.form?.querySelectorAll("input, button").forEach(el => el.disabled = true);
      return;
    }

    // Limpa o token da barra de endereço (não fica em histórico/logs)
    try { history.replaceState({}, "", location.pathname + location.search); } catch {}

    // Descobre o email pra mostrar pro usuário e usar no redirect do login
    try {
      const r = await fetch(`${ApiBEM.URL_SUPABASE}/auth/v1/user`, {
        headers: {
          "apikey": ApiBEM.CHAVE_SUPABASE_ANON,
          "Authorization": `Bearer ${this.accessToken}`,
        },
      });
      if (r.ok) {
        const u = await r.json();
        this.email = u?.email || null;
        if (this.email && this.elEmail && this.elEmailInfo) {
          this.elEmail.textContent = this.email;
          this.elEmailInfo.hidden = false;
        }
      }
    } catch { /* tudo bem, segue sem mostrar */ }

    this.inSenha?.addEventListener("input", () => this._atualizarForca(this.inSenha.value));
    this.form?.addEventListener("submit", (ev) => this._finalizar(ev));

    // Olhinhos mostrar/ocultar nas duas senhas
    const inSenha2 = this.form?.querySelector("[name='senha2']");
    UtilFormulario.acoplarOlhoSenha(this.inSenha);
    UtilFormulario.acoplarOlhoSenha(inSenha2);

    // Live feedback "senhas conferem"
    if (inSenha2) {
      const msg = document.createElement("div");
      msg.hidden = true;
      inSenha2.closest("label")?.after(msg);
      UtilFormulario.acoplarConferenciaSenhas(this.inSenha, inSenha2, msg);
    }
  }

  _lerTokenDoHash() {
    const h = location.hash || "";
    if (!h.startsWith("#")) return null;
    const p = new URLSearchParams(h.slice(1));
    const t = p.get("access_token");
    // type pode ser "recovery" (default do nosso fluxo) ou "invite" (se um dia
    // usarmos /admin/invite via Edge Function). Aceitamos os dois.
    const tipo = p.get("type");
    if (tipo && !["recovery","invite"].includes(tipo)) return null;
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

  async _finalizar(ev) {
    ev.preventDefault();
    this._msg(null, null);

    const f = new FormData(this.form);
    const nome   = (f.get("nome")   || "").toString();
    const senha  = (f.get("senha")  || "").toString();
    const senha2 = (f.get("senha2") || "").toString();
    if (senha !== senha2) return this._msg("As senhas não conferem.", null);

    // Anti-injection no nome (sanção de XSS / SQL clássicos)
    try { UtilFormulario.bloquearInjection(nome); }
    catch (err) { return this._msg(err.message, null); }

    this._carregando(true);
    try {
      const r = await Autenticacao.completarPerfil(this.accessToken, { nome, senha });
      const emailFinal = r?.email || this.email || "";
      this._msg(null, "Tudo certo! Redirecionando para o login…");
      const dest = emailFinal
        ? `../../login/?email=${encodeURIComponent(emailFinal)}`
        : `../../login/`;
      setTimeout(() => { window.location.href = dest; }, 1200);
    } catch (err) {
      this._msg(String(err.message || "Não foi possível finalizar."), null);
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
    this.btn.textContent = estado ? "Salvando…" : "Finalizar e entrar";
  }
}

document.addEventListener("DOMContentLoaded", () => new PaginaDefinir().iniciar());
