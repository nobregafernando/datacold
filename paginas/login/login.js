/**
 * Página de login (Supabase Auth).
 *
 * O formulário usa Autenticacao.loginEmail(email, senha), que valida
 * entrada via Sanitizar/ValidadorSenha antes de bater no Supabase.
 */
class PaginaLogin {
  constructor() {
    this.form      = document.querySelector("[data-form]");
    this.btnEntrar = document.querySelector("[data-btn-entrar]");
    this.elErro    = document.querySelector("[data-erro]");
    // Guard contra reentrada — previne duplo signin (clique no card +
    // submit do form, ou double-click). Sem ele, duas requisições paralelas
    // podem gravar tokens fora de ordem e o usuário entra como conta errada.
    this._loginEmProgresso = false;
  }

  iniciar() {
    if (Autenticacao.autenticado()) {
      window.location.replace("../admin/");
      return;
    }
    this.form?.addEventListener("submit", (ev) => this._entrarFormulario(ev));

    // Olhinho mostrar/ocultar senha
    UtilFormulario.acoplarOlhoSenha(this.form?.querySelector("[name='senha']"));

    const params = new URLSearchParams(location.search);

    // Mostra aviso visível se a página recebeu ?sessao=expirada
    // (ApiBEM redireciona com isso quando o proxy devolve 401).
    if (params.get("sessao") === "expirada") {
      this._mostrarErro("Sua sessão expirou. Entre novamente.");
    }

    // Pré-preenche email vindo de ?email=... (usado pelo fluxo de convite
    // após o operador definir senha, e por qualquer outro redirecionamento).
    const emailQuery = Sanitizar.email(params.get("email") || "");
    if (emailQuery) {
      const inEmail = this.form?.querySelector("[name='email']");
      const inSenha = this.form?.querySelector("[name='senha']");
      if (inEmail) {
        inEmail.value = emailQuery;
        inEmail.readOnly = true;
        inEmail.classList.add("pre-preenchido");
      }
      setTimeout(() => inSenha?.focus(), 100);
    }

    // Cards de credenciais de teste: clicar = login direto.
    // NÃO dispara submit do form (era a causa do duplo-submit), chama
    // loginEmail() direto e gerencia estado visual do card.
    this.gradeCards = document.querySelector("[data-grade-credenciais]");
    document.querySelectorAll("[data-cred-email]").forEach(card => {
      card.addEventListener("click", async () => {
        if (this._loginEmProgresso) return;
        this._loginEmProgresso = true;
        this._mostrarErro(null);

        const email = Sanitizar.email(card.dataset.credEmail || "");
        const senha = card.dataset.credSenha || "";
        if (!email || !senha) {
          this._loginEmProgresso = false;
          return this._mostrarErro("Credencial de teste inválida.");
        }

        // Espelha nos campos do form (UX) — reset antes de setar pra evitar
        // valores antigos persistirem em re-tentativas.
        const inEmail = this.form?.querySelector("[name='email']");
        const inSenha = this.form?.querySelector("[name='senha']");
        if (inEmail) { inEmail.value = ""; inEmail.value = email; inEmail.readOnly = false; }
        if (inSenha) { inSenha.value = ""; inSenha.value = senha; }

        // Feedback visual: marca este card como carregando, desabilita
        // todos os cards e o botão Entrar, dimmer nos outros cards.
        this._marcarCardCarregando(card, true);
        this._carregando(true);

        try {
          await Autenticacao.loginEmail(email, senha);
          window.location.replace("../admin/");
        } catch (err) {
          this._mostrarErro(this._traduzirErro(err.message));
          this._marcarCardCarregando(card, false);
          this._loginEmProgresso = false;
          this._carregando(false);
        }
        // Em sucesso, NÃO limpa o estado — a navegação tá a caminho.
        // Manter os cards "travados" evita um flash de UI antes do redirect.
      });
    });
  }

  /** Liga/desliga o estado visual de carregamento num card específico. */
  _marcarCardCarregando(card, ligado) {
    if (ligado) {
      card.classList.add("carregando");
      this.gradeCards?.classList.add("bloqueada");
      this.gradeCards?.querySelectorAll(".cred-card").forEach(c => c.disabled = true);
    } else {
      card.classList.remove("carregando");
      this.gradeCards?.classList.remove("bloqueada");
      this.gradeCards?.querySelectorAll(".cred-card").forEach(c => c.disabled = false);
    }
  }

  async _entrarFormulario(ev) {
    ev.preventDefault();
    if (this._loginEmProgresso) return;
    this._mostrarErro(null);

    const dados = new FormData(this.form);
    const emailBruto = (dados.get("email") || "").toString();
    const senha = (dados.get("senha") || "").toString();

    const email = Sanitizar.email(emailBruto);
    if (!email)  return this._mostrarErro("Informe um e-mail válido.");
    if (!senha)  return this._mostrarErro("Informe a senha.");

    // Defesa em profundidade: rejeita padrões típicos de SQL/XSS antes
    // de enviar pro servidor (PostgREST já é parametrizado, mas avisa).
    try { UtilFormulario.bloquearInjection(emailBruto); }
    catch (err) { return this._mostrarErro(err.message); }

    this._loginEmProgresso = true;
    this._carregando(true);
    try {
      await Autenticacao.loginEmail(email, senha);
      window.location.replace("../admin/");
    } catch (err) {
      this._mostrarErro(this._traduzirErro(err.message));
    } finally {
      this._loginEmProgresso = false;
      this._carregando(false);
    }
  }

  _traduzirErro(m) {
    const s = String(m || "");
    if (/invalid login credentials/i.test(s)) return "E-mail ou senha incorretos.";
    if (/email not confirmed/i.test(s))       return "Confirme o e-mail antes de entrar.";
    if (/network/i.test(s))                   return "Sem conexão com o servidor.";
    return s || "Não foi possível entrar.";
  }

  _mostrarErro(msg) {
    if (!this.elErro) return;
    if (!msg) { this.elErro.hidden = true; this.elErro.textContent = ""; return; }
    this.elErro.hidden = false;
    this.elErro.textContent = msg;
  }

  _carregando(estado) {
    if (!this.btnEntrar) return;
    this.btnEntrar.disabled = estado;
    this.btnEntrar.textContent = estado ? "Entrando…" : "Entrar";
  }
}

document.addEventListener("DOMContentLoaded", () => new PaginaLogin().iniciar());
