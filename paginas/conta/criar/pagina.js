/**
 * Página · Criar conta (admin-only)
 *
 * Bloqueia o acesso se não for admin (Autenticacao.protegerPagina).
 * Em sucesso, chama Autenticacao.criarUsuario que dispara signup no
 * Supabase Auth com metadata `nome` e `papel`. O trigger no banco
 * (fn_criar_perfil_padrao) cria a linha em perfis_usuarios já com o
 * papel pedido.
 */
class PaginaCriarConta {
  constructor() {
    this.form    = document.querySelector("[data-form]");
    this.inSenha = document.querySelector("[data-senha]");
    this.elInfo  = document.querySelector("[data-admin-info]");
    this.elErro  = document.querySelector("[data-erro]");
    this.elOk    = document.querySelector("[data-ok]");
    this.btn     = document.querySelector("[data-btn-criar]");

    this.elForcaSeg    = document.querySelector("[data-forca-segmentos]");
    this.elForcaRotulo = document.querySelector("[data-forca-rotulo]");
    this.requisitos    = {
      len:        document.querySelector('[data-req="len"]'),
      maiuscula:  document.querySelector('[data-req="maiuscula"]'),
      minuscula:  document.querySelector('[data-req="minuscula"]'),
      digito:     document.querySelector('[data-req="digito"]'),
      especial:   document.querySelector('[data-req="especial"]'),
      espaco:     document.querySelector('[data-req="espaco"]'),
    };
  }

  iniciar() {
    // Bloqueio: precisa estar logado E ser admin.
    if (!Autenticacao.protegerPagina("../../login/", "admin", "../../admin/")) return;

    const eu = Autenticacao.usuarioAtual();
    if (this.elInfo) {
      this.elInfo.textContent = `${eu.nome} · ${eu.rotuloPapel}`;
    }

    this.inSenha?.addEventListener("input", () => this._atualizarForca(this.inSenha.value));
    this.form?.addEventListener("submit", (ev) => this._criar(ev));
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

  async _criar(ev) {
    ev.preventDefault();
    this._msg(null, null);

    const f = new FormData(this.form);
    const nome   = (f.get("nome")  || "").toString();
    const email  = (f.get("email") || "").toString();
    const papel  = (f.get("papel") || "operador").toString();
    const senha  = (f.get("senha") || "").toString();
    const senha2 = (f.get("senha2")|| "").toString();

    if (senha !== senha2) return this._msg("As senhas não conferem.", null);

    const eNome  = Sanitizar.nome(nome);
    const eEmail = Sanitizar.email(email);
    if (!eNome)  return this._msg("Nome inválido (use só letras, espaços, hífen ou apóstrofo).", null);
    if (!eEmail) return this._msg("E-mail inválido.", null);
    if (Sanitizar.parecePerigoso(nome)) return this._msg("Caracteres suspeitos no nome.", null);
    if (!["admin","operador"].includes(papel)) return this._msg("Papel inválido.", null);

    const v = ValidadorSenha.validar(senha);
    if (!v.ok) return this._msg("Senha fraca: " + v.motivos.join("; ") + ".", null);

    this._carregando(true);
    try {
      await Autenticacao.criarUsuario({ nome: eNome, email: eEmail, senha, papel });
      this._msg(null, `Conta criada para ${eEmail}. Eles já podem entrar no login.`);
      this.form.reset();
      this._atualizarForca("");
    } catch (err) {
      const m = String(err.message || "");
      let amigavel = m;
      if (/already registered|user already exists|duplicate/i.test(m)) amigavel = "Este e-mail já tem conta.";
      else if (/weak password/i.test(m)) amigavel = "Senha rejeitada pelo servidor — escolha uma mais forte.";
      this._msg(amigavel, null);
    } finally {
      this._carregando(false);
    }
  }

  _msg(erro, ok) {
    if (this.elErro) {
      this.elErro.hidden = !erro;
      this.elErro.textContent = erro || "";
    }
    if (this.elOk) {
      this.elOk.hidden = !ok;
      this.elOk.textContent = ok || "";
    }
  }

  _carregando(estado) {
    if (!this.btn) return;
    this.btn.disabled = estado;
    this.btn.textContent = estado ? "Criando…" : "Criar conta";
  }
}

document.addEventListener("DOMContentLoaded", () => new PaginaCriarConta().iniciar());
