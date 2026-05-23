/**
 * =============================================================================
 *  SISTEMA DE NOTIFICAÇÕES — GUIA RÁPIDO PARA DEVS
 * =============================================================================
 *
 *  É um event bus global persistido em localStorage.
 *  Qualquer página/componente pode ENVIAR e LER notificações.
 *  O MenuTopo (sino) se inscreve automaticamente — não precisa tocar nele.
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  ENVIAR UMA NOTIFICAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────
 *
 *  // Forma rápida (atalhos por severidade):
 *  Notificacoes.critica("Sensor offline", "extrusora_1 sem leitura há 12min");
 *  Notificacoes.alta("FP baixo", "extrusora_2: FP=0.45 abaixo do limite ANEEL");
 *  Notificacoes.media("Calibração pendente", "Câmara de congelados precisa recalibrar");
 *  Notificacoes.comum("Sincronização concluída", "Catálogo de 14 sensores atualizado");
 *
 *  // Forma completa (com origem e link de ação):
 *  Notificacoes.enviar({
 *    severidade: "critica",                              // critica | alta | media | comum
 *    titulo: "Superaquecimento detectado",
 *    mensagem: "Temperatura da câmara passou de -8°C há 5 minutos",
 *    origem: {
 *      tipo: "sensor",                                   // tipo livre (sensor, sistema, usuario...)
 *      id: "congelados_temperatura",
 *      label: "Câmara de Congelados",
 *    },
 *    acao: {                                             // opcional, vira link clicável
 *      url: "/paginas/admin/sensores/congelados_temperatura/",
 *      texto: "Abrir sensor",
 *    },
 *    metadados: { temperaturaAtual: -7.4 },              // opcional, qualquer payload
 *  });
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  SEVERIDADES
 *  ─────────────────────────────────────────────────────────────────────────
 *   - "critica"  → vermelho. Badge pulsa. Use pra falhas que exigem ação imediata.
 *   - "alta"     → laranja. Use pra anomalias relevantes mas não imediatas.
 *   - "media"    → azul. Use pra avisos operacionais (calibração, manutenção).
 *   - "comum"    → cinza. Use pra eventos informativos do sistema.
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  OUTRAS OPERAÇÕES
 *  ─────────────────────────────────────────────────────────────────────────
 *
 *   Notificacoes.listar()             // array (mais recentes primeiro)
 *   Notificacoes.contarNaoLidas()
 *   Notificacoes.contarPorSeveridade("critica")
 *   Notificacoes.marcarComoLido(id)
 *   Notificacoes.marcarTodosLidos()
 *   Notificacoes.remover(id)
 *   Notificacoes.limpar()             // apaga TODAS
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  OBSERVAR MUDANÇAS (event bus)
 *  ─────────────────────────────────────────────────────────────────────────
 *
 *   const cancelar = Notificacoes.assinar((lista) => {
 *     console.log("notificações mudaram", lista);
 *   });
 *   // depois: cancelar();
 *
 *   Também emite eventos do DOM:
 *     document.addEventListener("notificacoes:mudou", (ev) => {
 *       const lista = ev.detail.lista;
 *     });
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  PERSISTÊNCIA & SINCRONIZAÇÃO ENTRE ABAS
 *  ─────────────────────────────────────────────────────────────────────────
 *   - Tudo fica em localStorage (chave: "datacold_notificacoes").
 *   - Mudanças propagam automaticamente entre abas via storage event.
 *   - Lista é truncada em Notificacoes.MAX (default: 100) mais recentes.
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  COMO INTEGRAR COM UM DETECTOR DE ANOMALIAS
 *  ─────────────────────────────────────────────────────────────────────────
 *  Em qualquer ponto do código (após o script estar carregado):
 *
 *    if (medida.fp_composto < 0.92) {
 *      Notificacoes.alta(
 *        "Fator de potência baixo",
 *        `${sensor.rotulo}: FP=${medida.fp_composto.toFixed(2)} abaixo do limite ANEEL`,
 *        {
 *          origem: { tipo: "sensor", id: sensor.id, label: sensor.rotulo },
 *          acao: { url: `/paginas/admin/sensores/${sensor.id}/`, texto: "Ver sensor" },
 *        }
 *      );
 *    }
 *
 *  Não precisa mexer no MenuTopo nem no MenuLateral — eles vão refletir o
 *  estado automaticamente assim que `Notificacoes.enviar(...)` for chamado.
 * =============================================================================
 */

class Notificacao {
  constructor({
    severidade = "comum",
    titulo,
    mensagem = "",
    origem = null,
    acao = null,
    metadados = null,
  } = {}) {
    if (!Notificacao.SEVERIDADES.includes(severidade)) {
      console.warn(`Notificacao: severidade "${severidade}" inválida, usando "comum"`);
      severidade = "comum";
    }
    this.id          = Notificacao._gerarId();
    this.severidade  = severidade;
    this.titulo      = titulo || "(sem título)";
    this.mensagem    = mensagem;
    this.origem      = origem;
    this.acao        = acao;
    this.metadados   = metadados;
    this.criadoEm    = new Date().toISOString();
    this.lido        = false;
  }

  static SEVERIDADES = ["critica", "alta", "media", "comum"];

  static _gerarId() {
    return `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

class Notificacoes {
  static CHAVE = "datacold_notificacoes";
  static MAX   = 100;

  static _assinantes = new Set();
  static _bridgeBound = false;

  // ===================================================================
  //  ENVIO (API principal)
  // ===================================================================

  /**
   * Envia uma notificação para o sistema.
   * @param {object|Notificacao} dados
   * @returns {Notificacao} a notificação criada
   */
  static enviar(dados) {
    const notificacao = dados instanceof Notificacao ? dados : new Notificacao(dados);
    const lista = Notificacoes.listar();
    lista.unshift(notificacao);
    if (lista.length > Notificacoes.MAX) lista.length = Notificacoes.MAX;
    Notificacoes._persistir(lista);
    return notificacao;
  }

  // Atalhos por severidade
  static critica(titulo, mensagem, opcoes = {}) {
    return Notificacoes.enviar({ severidade: "critica", titulo, mensagem, ...opcoes });
  }
  static alta(titulo, mensagem, opcoes = {}) {
    return Notificacoes.enviar({ severidade: "alta", titulo, mensagem, ...opcoes });
  }
  static media(titulo, mensagem, opcoes = {}) {
    return Notificacoes.enviar({ severidade: "media", titulo, mensagem, ...opcoes });
  }
  static comum(titulo, mensagem, opcoes = {}) {
    return Notificacoes.enviar({ severidade: "comum", titulo, mensagem, ...opcoes });
  }

  // ===================================================================
  //  LEITURA
  // ===================================================================

  static listar() {
    try {
      const cru = localStorage.getItem(Notificacoes.CHAVE);
      return cru ? JSON.parse(cru) : [];
    } catch {
      return [];
    }
  }

  static obter(id) {
    return Notificacoes.listar().find(n => n.id === id) || null;
  }

  static contarNaoLidas() {
    return Notificacoes.listar().filter(n => !n.lido).length;
  }

  static contarPorSeveridade(severidade) {
    return Notificacoes.listar().filter(n => n.severidade === severidade).length;
  }

  static contarNaoLidasPorSeveridade(severidade) {
    return Notificacoes.listar().filter(n => n.severidade === severidade && !n.lido).length;
  }

  // ===================================================================
  //  MUTAÇÕES
  // ===================================================================

  static marcarComoLido(id) {
    const lista = Notificacoes.listar().map(n =>
      n.id === id ? { ...n, lido: true } : n
    );
    Notificacoes._persistir(lista);
  }

  static marcarTodosLidos() {
    const lista = Notificacoes.listar().map(n => ({ ...n, lido: true }));
    Notificacoes._persistir(lista);
  }

  static remover(id) {
    const lista = Notificacoes.listar().filter(n => n.id !== id);
    Notificacoes._persistir(lista);
  }

  static limpar() {
    Notificacoes._persistir([]);
  }

  // ===================================================================
  //  EVENT BUS
  // ===================================================================

  /**
   * Assina mudanças. Retorna função pra cancelar.
   * @param {(lista: Notificacao[]) => void} callback
   * @returns {() => void}
   */
  static assinar(callback) {
    Notificacoes._garantirBridge();
    Notificacoes._assinantes.add(callback);
    return () => Notificacoes._assinantes.delete(callback);
  }

  // ===================================================================
  //  HELPERS
  // ===================================================================

  /** Formata "há X tempo" a partir do timestamp ISO. */
  static formatarQuando(isoString) {
    const t = new Date(isoString).getTime();
    if (isNaN(t)) return "";
    const diff = Date.now() - t;
    const s = Math.floor(diff / 1000);
    if (s < 60)       return "agora";
    const m = Math.floor(s / 60);
    if (m < 60)       return `há ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24)       return `há ${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7)        return `há ${d}d`;
    return new Date(isoString).toLocaleDateString("pt-BR");
  }

  static rotuloSeveridade(severidade) {
    return {
      critica: "crítica",
      alta:    "alta",
      media:   "média",
      comum:   "comum",
    }[severidade] ?? severidade;
  }

  // ===================================================================
  //  INTERNOS
  // ===================================================================

  static _persistir(lista) {
    try {
      localStorage.setItem(Notificacoes.CHAVE, JSON.stringify(lista));
    } catch (e) {
      console.error("Notificacoes: falha ao persistir", e);
    }
    Notificacoes._emitir(lista);
  }

  static _emitir(lista) {
    Notificacoes._assinantes.forEach(cb => {
      try { cb(lista); } catch (e) { console.error("assinante de notificações falhou", e); }
    });
    document.dispatchEvent(new CustomEvent("notificacoes:mudou", { detail: { lista } }));
  }

  /** Liga o storage event uma única vez (sincroniza entre abas). */
  static _garantirBridge() {
    if (Notificacoes._bridgeBound) return;
    Notificacoes._bridgeBound = true;
    window.addEventListener("storage", (ev) => {
      if (ev.key !== Notificacoes.CHAVE) return;
      Notificacoes._emitir(Notificacoes.listar());
    });
  }
}

if (typeof window !== "undefined") {
  window.Notificacao  = Notificacao;
  window.Notificacoes = Notificacoes;
}
