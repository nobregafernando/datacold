/**
 * Notificacoes — cliente para o sistema multi-usuário no Supabase.
 *
 * ZERO localStorage. Tudo vem do banco via RPCs:
 *   listar_minhas_notificacoes, contar_nao_lidas,
 *   marcar_notificacao_lida, arquivar_notificacao, desarquivar_notificacao,
 *   marcar_todas_lidas
 *
 * RLS: operador só vê notificações criadas APÓS sua data de cadastro;
 * admin vê tudo. Estado (lida/arquivada) é por usuário.
 *
 * API pública (compatível com o que MenuTopo e páginas já consomem):
 *   Notificacoes.iniciar()                  ↳ inicia polling (auto-refresh)
 *   Notificacoes.parar()
 *   Notificacoes.recarregar()               ↳ força refresh imediato
 *   Notificacoes.listar()                   ↳ snapshot atual em memória
 *   Notificacoes.contagem()                 ↳ {total, critica} não-lidas
 *   Notificacoes.naoLidas()                 ↳ filtra lista por não-lidas
 *   Notificacoes.marcarComoLido(id)
 *   Notificacoes.arquivar(id)
 *   Notificacoes.desarquivar(id)
 *   Notificacoes.marcarTodosLidos()
 *   Notificacoes.assinar(cb)                ↳ cb chamado quando lista muda
 *   Notificacoes.formatarQuando(iso)
 *   Notificacoes.rotuloSeveridade(s)
 *
 * Notificações NUNCA são criadas pelo front — são geradas pelos triggers
 * AFTER INSERT nas tabelas de leituras (Postgres). Front só consome.
 */
class Notificacoes {
  // Polling agressivo na aba visível pra dar sensação de "tempo real".
  // 5s é o sweet-spot entre carga no servidor e latência percebida.
  static INTERVALO_POLLING_MS = 5000;
  static INTERVALO_POLLING_OCULTO_MS = 60000;
  static LIMITE_INICIAL = 50;
  static CANAL_BROADCAST = "datacold-notificacoes";

  static _api = null;
  static _cache = [];                    // últimas notificações carregadas
  static _contagem = { total: 0, critica: 0 };
  static _contagemAnterior = null;       // detecta SUBIDA pra animar o sino
  static _assinantes = new Set();
  static _timer = null;
  static _carregando = false;
  static _statusFiltro = "ativas";       // 'todas'|'ativas'|'nao_lidas'|'arquivadas'
  static _broadcast = null;              // BroadcastChannel entre abas

  static _getApi() {
    if (!Notificacoes._api) Notificacoes._api = new ApiBEM();
    return Notificacoes._api;
  }

  // -------------------------------------------------------------------
  //  Polling
  // -------------------------------------------------------------------
  static iniciar() {
    if (Notificacoes._timer) return;
    Notificacoes._abrirBroadcast();
    Notificacoes.recarregar();
    Notificacoes._reagendar();
    // Recarrega imediatamente quando a aba volta a ficar visível
    if (!Notificacoes._visListener) {
      Notificacoes._visListener = () => {
        if (document.visibilityState === "visible") {
          Notificacoes.recarregar();
        }
        Notificacoes._reagendar();
      };
      document.addEventListener("visibilitychange", Notificacoes._visListener);
    }
  }

  /**
   * BroadcastChannel sincroniza várias abas do mesmo navegador. Quando
   * uma aba detecta nova notificação (contagem subindo), ela manda evento
   * e as outras puxam imediatamente — sem esperar o próximo polling.
   */
  static _abrirBroadcast() {
    if (Notificacoes._broadcast || typeof BroadcastChannel === "undefined") return;
    try {
      Notificacoes._broadcast = new BroadcastChannel(Notificacoes.CANAL_BROADCAST);
      Notificacoes._broadcast.onmessage = (ev) => {
        if (ev.data?.tipo === "novas-notificacoes") {
          // Outra aba viu novidade — puxa agora
          Notificacoes.recarregar();
        }
      };
    } catch { /* ignora */ }
  }

  static _broadcastSubida() {
    try {
      Notificacoes._broadcast?.postMessage({ tipo: "novas-notificacoes", t: Date.now() });
    } catch { /* ignora */ }
  }
  static parar() {
    if (Notificacoes._timer) clearInterval(Notificacoes._timer);
    Notificacoes._timer = null;
  }
  static _reagendar() {
    if (Notificacoes._timer) clearInterval(Notificacoes._timer);
    const intervalo = (typeof document !== "undefined" && document.hidden)
      ? Notificacoes.INTERVALO_POLLING_OCULTO_MS
      : Notificacoes.INTERVALO_POLLING_MS;
    Notificacoes._timer = setInterval(
      () => Notificacoes.recarregar(),
      intervalo
    );
  }

  static async recarregar({ status = null, severidade = null, limit = null } = {}) {
    if (Notificacoes._carregando) return;
    Notificacoes._carregando = true;
    try {
      const api = Notificacoes._getApi();
      const [lista, cont] = await Promise.all([
        api.listarMinhasNotificacoes({
          limit: limit || Notificacoes.LIMITE_INICIAL,
          status: status || Notificacoes._statusFiltro,
          severidade,
        }),
        api.contarNaoLidas(),
      ]);

      const novaCont = cont || { total: 0, critica: 0 };
      const ant = Notificacoes._contagemAnterior;

      // Detecta SUBIDA pra disparar animação "pisca" e broadcast pras abas.
      // Ignora a primeira carga (ant === null) pra não piscar no boot.
      const subiu = ant !== null && (
        (novaCont.total   > ant.total) ||
        (novaCont.critica > ant.critica)
      );

      Notificacoes._cache = Array.isArray(lista?.notificacoes) ? lista.notificacoes : [];
      Notificacoes._contagem = novaCont;
      Notificacoes._contagemAnterior = { ...novaCont };

      // Chama assinantes (MenuTopo). Passa flag de subida pra UI piscar.
      Notificacoes._notificarAssinantes({ subiu });

      // Avisa outras abas — assim todas reagem juntas mesmo se só uma
      // viu primeiro
      if (subiu) Notificacoes._broadcastSubida();
    } catch (e) {
      // sem sessão / rede caiu — mantém cache antigo
    } finally {
      Notificacoes._carregando = false;
    }
  }

  // -------------------------------------------------------------------
  //  Leitura
  // -------------------------------------------------------------------
  static listar()              { return [...Notificacoes._cache]; }
  static contagem()            { return { ...Notificacoes._contagem }; }
  static naoLidas()            { return Notificacoes._cache.filter(n => !n.lido && !n.arquivado); }
  static buscar(id)            { return Notificacoes._cache.find(n => n.id === id) || null; }
  static filtrarPor(fn)        { return Notificacoes._cache.filter(fn); }

  // -------------------------------------------------------------------
  //  Ações (otimistas: ajusta cache local, dispara fetch em background)
  // -------------------------------------------------------------------
  static async marcarComoLido(id) {
    const n = Notificacoes.buscar(id);
    if (n) { n.lido = true; n.lido_em = new Date().toISOString(); Notificacoes._notificarAssinantes(); }
    try { await Notificacoes._getApi().marcarNotificacaoLida(id); } catch {}
    Notificacoes.recarregar();
  }
  static async arquivar(id) {
    const n = Notificacoes.buscar(id);
    if (n) {
      n.arquivado = true; n.lido = true;
      n.arquivado_em = new Date().toISOString();
      Notificacoes._notificarAssinantes();
    }
    try { await Notificacoes._getApi().arquivarNotificacao(id); } catch {}
    Notificacoes.recarregar();
  }
  static async desarquivar(id) {
    const n = Notificacoes.buscar(id);
    if (n) { n.arquivado = false; n.arquivado_em = null; Notificacoes._notificarAssinantes(); }
    try { await Notificacoes._getApi().desarquivarNotificacao(id); } catch {}
    Notificacoes.recarregar();
  }
  static async marcarTodosLidos() {
    Notificacoes._cache.forEach(n => {
      if (!n.arquivado) { n.lido = true; n.lido_em = new Date().toISOString(); }
    });
    Notificacoes._notificarAssinantes();
    try { await Notificacoes._getApi().marcarTodasLidas(); } catch {}
    Notificacoes.recarregar();
  }

  // Aliases de nomenclatura antiga (alguns callsites usam camelCase variado)
  static async marcarLida(id)       { return Notificacoes.marcarComoLido(id); }
  static async marcarTodasLidas()   { return Notificacoes.marcarTodosLidos(); }
  static async marcarTodos()        { return Notificacoes.marcarTodosLidos(); }
  static async remover(id)          { return Notificacoes.arquivar(id); }

  /**
   * Arquiva todas as notificações visíveis (não-arquivadas) — botão "Limpar"
   * do sino. Otimista: marca tudo localmente, depois faz fetch em paralelo
   * e força recarregar pra sincronizar com o servidor.
   *
   * Sem RPC bulk; o overhead de 50 chamadas em paralelo é ~500ms no Supabase.
   */
  static async limpar() {
    const ativos = Notificacoes._cache.filter(n => !n.arquivado);
    if (!ativos.length) return;

    // Optimista no cache local + render imediato
    const agora = new Date().toISOString();
    ativos.forEach(n => {
      n.arquivado = true;
      n.lido = true;
      n.arquivado_em = agora;
    });
    Notificacoes._notificarAssinantes();

    // Persiste em paralelo (ignora erros individuais — recarregar sincroniza)
    const api = Notificacoes._getApi();
    await Promise.allSettled(
      ativos.map(n => api.arquivarNotificacao(n.id))
    );
    Notificacoes.recarregar();
  }

  // -------------------------------------------------------------------
  //  Compat — descontinuados. Mantemos pra não quebrar callsites antigos
  //  que ainda chamem .enviar(), .critica() etc.
  // -------------------------------------------------------------------
  static enviar()  { console.warn("Notificacoes.enviar() removido — notificações vêm do servidor."); }
  static critica() { Notificacoes.enviar(); }
  static alta()    { Notificacoes.enviar(); }
  static media()   { Notificacoes.enviar(); }
  static comum()   { Notificacoes.enviar(); }
  // OBS: `remover(id)` é definido na seção de aliases acima (→ arquivar).
  // Não redefinir como stub aqui — class fields tem regra de "última vence"
  // e sobrescreveria a definição funcional.

  // -------------------------------------------------------------------
  //  Assinantes (MenuTopo/sino se inscreve aqui)
  // -------------------------------------------------------------------
  static assinar(cb) {
    Notificacoes._assinantes.add(cb);
    try { cb(Notificacoes.listar()); } catch {}
    return () => Notificacoes._assinantes.delete(cb);
  }
  static _notificarAssinantes(extra = {}) {
    for (const cb of Notificacoes._assinantes) {
      try { cb(Notificacoes.listar(), extra); } catch (e) { console.error("assinante notif:", e); }
    }
  }

  // -------------------------------------------------------------------
  //  Helpers de formatação
  // -------------------------------------------------------------------
  static rotuloSeveridade(s) {
    return { critica: "Crítica", alta: "Alta", media: "Média", comum: "Comum" }[s] || s;
  }
  static formatarQuando(iso) {
    if (!iso) return "agora";
    const d = new Date(iso);
    const seg = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (seg < 60)        return "agora";
    if (seg < 3600)      return `há ${Math.floor(seg / 60)} min`;
    if (seg < 86400)     return `há ${Math.floor(seg / 3600)}h`;
    if (seg < 86400 * 7) return `há ${Math.floor(seg / 86400)}d`;
    return d.toLocaleDateString("pt-BR");
  }
}

if (typeof window !== "undefined") {
  window.Notificacoes = Notificacoes;
  // Auto-inicia o polling assim que o script carrega
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Notificacoes.iniciar());
  } else {
    Notificacoes.iniciar();
  }
}
