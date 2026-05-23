/**
 * Página de documentação visual dos 3 agentes.
 * Renderiza dinamicamente a partir de window.AgenteEnergia/Temperatura/Porta
 * e permite customizar cada parâmetro POR SENSOR via modal (chama a RPC
 * `atualizar_parametros_sensor` no Supabase).
 */

// ===================================================================
//  Configuração visual por tipo
// ===================================================================
const TIPOS = [
  {
    chave: "energia",
    classe: AgenteEnergia,
    titulo: "Agente de Energia",
    apelido: "Vigia o medidor trifásico — FP, equilíbrio, picos e fases.",
    emoji: "⚡",
    cor: "energia",
    sensoresIds: ["extrusora_1","extrusora_2","extrusora_3","congelados_compressor","estoque_compressor_1","estoque_compressor_2","graxaria_energia"],
  },
  {
    chave: "temperatura",
    classe: AgenteTemperatura,
    titulo: "Agente de Temperatura",
    apelido: "Compara cada leitura com a faixa ANVISA/Codex do tipo de câmara.",
    emoji: "🌡️",
    cor: "temperatura",
    sensoresIds: ["congelados_temperatura","estoque_temperatura","graxaria_temperatura","externo_cg_temperatura","externo_tl_temperatura"],
  },
  {
    chave: "porta",
    classe: AgentePorta,
    titulo: "Agente de Porta",
    apelido: "Mede tempo aberta, frequência e padrões de uso.",
    emoji: "🚪",
    cor: "porta",
    sensoresIds: ["estoque_porta","graxaria_porta"],
  },
];

// ===================================================================
//  Explicações leigas por regra
// ===================================================================
const EXPLICACOES = {
  "conectividade":          "Verifica se o sensor está ligado e mandando dados — sinal de vida.",
  "telemetria":             "Conta quantas vezes os dados sumiram (lacunas).",
  "fp-baixo":               "Energia que vira trabalho de verdade vs. só esquentar fio. Abaixo do limite = multa da concessionária.",
  "fluxo-reverso":          "Medidor mostrando 'gera energia' em fábrica sem placa solar = fiação invertida.",
  "desequilibrio-corrente": "As 3 fases puxam força parecida? Se não, motor sofre.",
  "desequilibrio-tensao":   "'Pressão elétrica' igual nas 3 fases? Diferença queima motor.",
  "fase-ausente":           "Algum cabo sem tensão. Equipamento operando capengando.",
  "pico-corrente":          "Pico de partida acima de 7× a média = rolamento ou contator com defeito.",
  "phantom-load":           "Consumo de madrugada vs. dia. Madrugada alta = ligado fora do expediente.",
  "tensao-fora-faixa":      "Voltagem nos 127V/220V certos, com tolerância de ±5%.",
  "potencia-atual":         "Quantos kW o equipamento está puxando agora.",
  "leitura-impossivel":     "Valores impossíveis (ex: +85°C numa câmara fria) = sensor com defeito.",
  "fora-da-faixa":          "% das leituras fora do que ANVISA/Codex exigem.",
  "temperatura-atual":      "Temperatura agora vs. faixa ideal pro tipo de câmara.",
  "oscilacao":              "Pulando muito = compressor com short-cycling.",
  "tendencia":              "Esquentando ou esfriando ao longo do tempo? Pode ser falha começando.",
  "picos-zscore":           "Leituras isoladas fora da média = mau contato.",
  "sensor-travado":         "Sem variação = sensor 'congelou', não mede de verdade.",
  "porta-esquecida":        "Aberta mais que o limite = perdendo frio em massa.",
  "tempo-medio-alto":       "Cada abertura dura demais = vedação ruim.",
  "fracao-aberta":          "% do tempo total aberta. Acima de 5% já é problema.",
  "padrao-evolutivo":       "Mudança grande entre 1ª e 2ª metade do período = turno novo ou degradação.",
  "rajada-aberturas":       "Várias aberturas em segundos = mau contato falsificando eventos.",
  "sinal-binario":          "Sensor de porta devia mandar só 0 ou 1.",
  "estado-atual":           "Aberta ou fechada nesse exato momento.",
};

/**
 * Metadados ricos por parâmetro:
 *  - rotulo:     nome curto pra humano
 *  - unidade:    "kW", "°C", "s", "%", "×", "" (adimensional)
 *  - severidade: "atencao" | "critico" | "info" | "neutro"
 *  - descricao:  o que muda quando o valor é ultrapassado / por que esse número
 */
const META_PARAMS = {
  // ===== ENERGIA · Fator de Potência =====
  limite_atencao: { rotulo: "FP — atenção",  unidade: "",   severidade: "atencao",
    descricao: "FP abaixo disso já gera aviso amarelo. Cuide do banco de capacitores." },
  limite_critico: { rotulo: "FP — crítico",  unidade: "",   severidade: "critico",
    descricao: "Mínimo aceitável pela ANEEL. Abaixo disso = multa garantida na conta de luz." },

  // ===== ENERGIA · Desequilíbrio de fases =====
  atencao_pct:    { rotulo: "%CUB — atenção", unidade: "%", severidade: "atencao",
    descricao: "Desequilíbrio de corrente entre as 3 fases. Acima disso, motor começa a sofrer." },
  critico_pct:    { rotulo: "%CUB — crítico", unidade: "%", severidade: "critico",
    descricao: "Limite NEMA MG-1 para desequilíbrio de corrente. Acima = risco de queima." },
  ideal_pct:      { rotulo: "%VUB — ideal",  unidade: "%",  severidade: "info",
    descricao: "Desequilíbrio de tensão considerado ideal. Acima fica em zona de observação." },
  max_pct:        { rotulo: "%VUB — máximo", unidade: "%",  severidade: "critico",
    descricao: "Limite máximo de desequilíbrio de tensão. Equipamentos degradam mais rápido." },

  // ===== ENERGIA · Outros =====
  limite_v:       { rotulo: "Tensão mínima", unidade: "V",  severidade: "critico",
    descricao: "Abaixo disso a fase é considerada ausente — disjuntor caído ou cabo solto." },
  partida_min_x:  { rotulo: "Partida mín.",  unidade: "×",  severidade: "info",
    descricao: "Múltiplo da corrente nominal esperado numa partida normal de motor." },
  partida_max_x:  { rotulo: "Partida máx.",  unidade: "×",  severidade: "critico",
    descricao: "Acima desse pico = travamento ou contator com defeito (rolamento, bobina)." },
  razao_minima_alerta: { rotulo: "Razão noite/dia", unidade: "", severidade: "atencao",
    descricao: "Se consumo de madrugada/dia for maior que isso, equipamento ficou ligado fora do expediente." },
  tolerancia_pct: { rotulo: "Tensão — tolerância", unidade: "%", severidade: "info",
    descricao: "Quanto a tensão pode variar do nominal (127V/220V) sem ser alarme." },

  // ===== TEMPERATURA =====
  envelope_min:   { rotulo: "Mínimo plausível", unidade: "°C", severidade: "critico",
    descricao: "Abaixo disso a leitura é fisicamente impossível pro tipo de câmara — sensor defeituoso." },
  envelope_max:   { rotulo: "Máximo plausível", unidade: "°C", severidade: "critico",
    descricao: "Acima disso a leitura é fisicamente impossível — sensor com defeito ou desconectado." },
  warn_sigma:     { rotulo: "Oscilação — atenção", unidade: "σ", severidade: "atencao",
    descricao: "Desvio padrão alto = compressor com short-cycling (liga/desliga toda hora)." },
  tempo_warn_pct: { rotulo: "Tempo fora — atenção", unidade: "%", severidade: "atencao",
    descricao: "% do tempo fora da faixa ANVISA antes de virar alerta amarelo." },
  tempo_crit_pct: { rotulo: "Tempo fora — crítico", unidade: "%", severidade: "critico",
    descricao: "% do tempo fora da faixa ANVISA que dispara alerta vermelho — risco de perda de carga." },
  warn_c_h:       { rotulo: "Tendência — atenção", unidade: "°C/h", severidade: "atencao",
    descricao: "Velocidade de aquecimento/resfriamento suspeita. Pode ser falha começando." },
  z_limite:       { rotulo: "Limite z-score", unidade: "σ",  severidade: "atencao",
    descricao: "Quantos desvios padrão um ponto isolado precisa estar pra ser considerado pico/mau contato." },
  sigma_min:      { rotulo: "σ mínimo (vivo)", unidade: "°C", severidade: "atencao",
    descricao: "Variação mínima esperada. Se o sensor não varia nada, está travado." },

  // ===== PORTA =====
  esquecida_s:    { rotulo: "Esquecida", unidade: "s", severidade: "critico",
    descricao: "Duração contínua de uma única abertura que dispara alerta — porta ficou aberta esquecida." },
  warn_s:         { rotulo: "Tempo médio — atenção", unidade: "s", severidade: "atencao",
    descricao: "Tempo médio por abertura acima disso = vedação ruim ou pessoal demorando." },
  warn_pct:       { rotulo: "% aberta — atenção", unidade: "%", severidade: "atencao",
    descricao: "% do tempo total com porta aberta que vira alerta amarelo. Operacional alto perde frio." },
  crit_pct:       { rotulo: "% aberta — crítico", unidade: "%", severidade: "critico",
    descricao: "% do tempo total com porta aberta que vira alerta vermelho — perda de frio insustentável." },
  mudanca_pct:    { rotulo: "Mudança padrão", unidade: "%", severidade: "info",
    descricao: "Variação entre 1ª e 2ª metade do período. Mudança grande = turno novo ou problema novo." },
  rajada_s:       { rotulo: "Intervalo rajada", unidade: "s", severidade: "atencao",
    descricao: "Aberturas/fechamentos consecutivos em menos disso = mau contato falsificando eventos." },
  max_unicos:     { rotulo: "Máx valores únicos", unidade: "", severidade: "critico",
    descricao: "Sensor binário deve ter só 2 valores (0/1). Mais que isso = leitura corrompida." },

  // ===== COMUNS · Conectividade / Telemetria =====
  offline_multiplicador:  { rotulo: "Mult. offline", unidade: "×", severidade: "critico",
    descricao: "Quantas vezes a janela esperada sem dado = sensor considerado offline." },
  instavel_multiplicador: { rotulo: "Mult. instável", unidade: "×", severidade: "atencao",
    descricao: "Quantas vezes a janela esperada sem dado = sensor instável (ainda não offline)." },
  gap_multiplicador:      { rotulo: "Mult. de gap",  unidade: "×", severidade: "info",
    descricao: "A partir de quantas vezes o intervalo esperado entre pontos vira 'lacuna'." },
  lacunas_warn:           { rotulo: "Lacunas — atenção", unidade: "", severidade: "atencao",
    descricao: "Quantidade de lacunas detectadas na janela que vira alerta amarelo." },
  lacunas_crit:           { rotulo: "Lacunas — crítico", unidade: "", severidade: "critico",
    descricao: "Quantidade de lacunas detectadas que vira alerta vermelho — telemetria furada." },
};

function metaParam(k) {
  return META_PARAMS[k] || { rotulo: k.replace(/_/g, " "), unidade: "", severidade: "neutro", descricao: "" };
}
function rotular(k) { return metaParam(k).rotulo; }
function _esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function _verifsComuns() {
  return [
    {
      id: "conectividade", label: "Sensor está online?", categoria: "Conectividade",
      fonte: NORMAS.TELEMETRIA.offline_multiplicador.fonte,
      parametros: {
        offline_multiplicador:  NORMAS.TELEMETRIA.offline_multiplicador.valor,
        instavel_multiplicador: NORMAS.TELEMETRIA.instavel_multiplicador.valor,
      },
    },
    {
      id: "telemetria", label: "A telemetria é confiável?", categoria: "Telemetria",
      fonte: NORMAS.TELEMETRIA.gap_multiplicador.fonte,
      parametros: {
        gap_multiplicador: NORMAS.TELEMETRIA.gap_multiplicador.valor,
        lacunas_warn:      NORMAS.TELEMETRIA.lacunas_warn.valor,
        lacunas_crit:      NORMAS.TELEMETRIA.lacunas_crit.valor,
      },
    },
  ];
}

// ===================================================================
//  Página
// ===================================================================
class PaginaAgentes {

  constructor() {
    this.api = new ApiBEM();
    this.sensoresCatalogo = [];
  }

  async iniciar() {
    if (!Autenticacao.protegerPagina("../../login/login.html")) return;

    this.menu = new MenuLateral({ paginaAtiva: "agentes", raiz: "../../../" });
    await this.menu.montar("#menu-lateral");

    this.topo = new MenuTopo({ titulo: "Agentes", raiz: "../../../" });
    this.topo.montar("#menu-topo");

    // Catálogo de sensores (pra preencher o select do modal)
    try {
      const cat = await this.api.listarCatalogo();
      this.sensoresCatalogo = cat.sensors || [];
    } catch (e) {
      console.warn("Falha ao listar sensores:", e);
    }

    this._renderResumo();
    this._renderAgentes();
    this._ligarEventos();
  }

  _renderResumo() {
    const totalRegras = TIPOS.reduce(
      (s, t) => s + (t.classe.REGRAS?.length || 0) + _verifsComuns().length,
      0
    );
    const totalSensores = TIPOS.reduce((s, t) => s + t.sensoresIds.length, 0);
    document.getElementById("resumoTopo").innerHTML = `
      <div class="ag-numero"><span>${TIPOS.length}</span><small>tipos de agente</small></div>
      <div class="ag-numero"><span>${totalSensores}</span><small>sensores cobertos</small></div>
      <div class="ag-numero"><span>${totalRegras}</span><small>regras técnicas</small></div>
      <div class="ag-numero"><span>4</span><small>normas referenciadas</small></div>
    `;
  }

  _renderAgentes() {
    const grade = document.getElementById("agentesGrade");
    grade.innerHTML = TIPOS.map(t => this._htmlAgente(t)).join("");
  }

  _htmlAgente(t) {
    const regrasComuns = _verifsComuns();
    const regrasTipo = t.classe.REGRAS || [];
    const todasRegras = [
      ...regrasComuns.map(r => ({ ...r, _comum: true })),
      ...regrasTipo.map(r => ({ ...r, _comum: false })),
    ];

    return `
      <article class="ag-card ag-${t.cor}">
        <header class="ag-card-head">
          <div class="ag-emoji">${t.emoji}</div>
          <div class="ag-card-info">
            <span class="olho">Agente ${t.chave}</span>
            <h2>${t.titulo}</h2>
            <p class="ag-apelido">${t.apelido}</p>
          </div>
          <div class="ag-stats">
            <div><strong>${todasRegras.length}</strong><span>regras</span></div>
            <div><strong>${t.sensoresIds.length}</strong><span>sensores</span></div>
          </div>
        </header>

        <div class="ag-sensores">
          <span class="ag-lbl">Sensores:</span>
          ${t.sensoresIds.map(s => `<code class="ag-tag-sensor">${s}</code>`).join("")}
        </div>

        <div class="ag-regras">
          ${todasRegras.map(r => this._htmlRegra(r, t)).join("")}
        </div>
      </article>
    `;
  }

  _htmlRegra(regra, tipo) {
    const explicacao = EXPLICACOES[regra.id] || regra.label;
    const params = regra.parametros || {};
    const entradas = Object.entries(params);
    const temParams = entradas.length > 0;

    return `
      <div class="ag-regra ${regra._comum ? 'compartilhada' : ''}">
        <div class="ag-regra-tags">
          <span class="ag-cat-tag">${_esc(regra.categoria)}</span>
          ${regra._comum ? `<span class="ag-tag-comum">comum</span>` : ""}
        </div>
        <h4 class="ag-regra-q">${_esc(regra.label)}</h4>
        <p class="ag-regra-explica">${_esc(explicacao)}</p>

        ${temParams ? `
          <div class="ag-params-bloco">
            <div class="ag-params-head">
              <span class="ag-params-titulo">Parâmetros configuráveis</span>
              <span class="ag-params-hint">clique pra customizar por sensor</span>
            </div>
            <div class="ag-params-lista">
              ${entradas.map(([k, v]) => this._htmlParam(k, v, tipo.chave)).join("")}
            </div>
          </div>
        ` : `
          <div class="ag-sem-params" title="Regra observacional — não tem limites configuráveis">
            <span class="ag-sem-params-ico">ⓘ</span>
            <span>Regra observacional — só relata o estado, sem limite configurável.</span>
          </div>
        `}

        ${regra.fonte ? `<p class="ag-fonte-r">📖 ${_esc(regra.fonte)}</p>` : ""}
      </div>
    `;
  }

  _htmlParam(k, v, tipoChave) {
    const meta = metaParam(k);
    const sev = meta.severidade || "neutro";
    const valor = String(v);
    const unidade = meta.unidade || "";
    const ico = ({ critico:"⚠", atencao:"●", info:"ⓘ", neutro:"·" })[sev];

    return `
      <button class="ag-param-card sev-${sev}"
              data-acao="editar-param"
              data-tipo="${tipoChave}"
              data-param="${_esc(k)}"
              data-default="${_esc(valor)}"
              title="Customizar ${_esc(meta.rotulo)} pra um sensor específico">
        <div class="ag-param-topo">
          <span class="ag-param-sev" aria-hidden="true">${ico}</span>
          <span class="ag-param-rotulo">${_esc(meta.rotulo)}</span>
          <span class="ag-param-edit" aria-hidden="true">✎</span>
        </div>
        <div class="ag-param-meio">
          <span class="ag-param-valor">${_esc(valor)}</span>
          ${unidade ? `<span class="ag-param-unidade">${_esc(unidade)}</span>` : ""}
        </div>
        ${meta.descricao ? `<div class="ag-param-desc">${_esc(meta.descricao)}</div>` : ""}
      </button>
    `;
  }

  // ===================================================================
  //  Modal de customização
  // ===================================================================
  _ligarEventos() {
    document.getElementById("agentesGrade").addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-acao='editar-param']");
      if (btn) this._abrirModal(btn.dataset);
    });
    document.getElementById("modalFechar").onclick = () => this._fecharModal();
    document.getElementById("modalBackdrop").onclick = (e) => {
      if (e.target.id === "modalBackdrop") this._fecharModal();
    };
    document.getElementById("formCustomizar").onsubmit = (e) => {
      e.preventDefault();
      this._salvarCustomizacao();
    };
  }

  _abrirModal({ tipo, param, default: vDefault }) {
    this._editando = { tipo, param, vDefault };
    document.getElementById("modalParamRotulo").textContent = rotular(param);
    document.getElementById("modalParamId").textContent     = param;
    document.getElementById("modalDefault").textContent     = vDefault;
    document.getElementById("modalNovoValor").value         = vDefault;
    document.getElementById("modalAviso").innerHTML         = "";
    document.getElementById("modalSalvar").disabled = false;
    document.getElementById("modalSalvar").textContent = "Aplicar customização";

    // Preenche select de sensores filtrando pelo tipo
    const sel = document.getElementById("modalSensor");
    const candidatos = this.sensoresCatalogo.filter(s => s.type === tipo);
    sel.innerHTML = candidatos.length
      ? candidatos.map(s => `<option value="${s.id}">${s.label} (${s.id})</option>`).join("")
      : `<option disabled>Nenhum sensor desse tipo no catálogo</option>`;

    document.getElementById("modalBackdrop").hidden = false;
  }

  _fecharModal() {
    document.getElementById("modalBackdrop").hidden = true;
    this._editando = null;
  }

  async _salvarCustomizacao() {
    if (!this._editando) return;
    const sensor = document.getElementById("modalSensor").value;
    const valorRaw = document.getElementById("modalNovoValor").value.trim();
    const valorNum = Number(valorRaw);
    const valor = (valorRaw !== "" && !isNaN(valorNum)) ? valorNum : valorRaw;

    const aviso = document.getElementById("modalAviso");
    const btn = document.getElementById("modalSalvar");
    btn.disabled = true; btn.textContent = "Salvando…";

    try {
      const payload = { [this._editando.param]: valor };
      const r = await this.api.atualizarParametrosSensor(sensor, payload);
      if (r?.error) throw new Error(r.error);
      aviso.className = "modal-aviso ok";
      aviso.innerHTML = `<strong>Salvo.</strong> O sensor <code>${sensor}</code> agora usa <code>${this._editando.param} = ${valor}</code>.`;
      btn.textContent = "Salvar outra";
      btn.disabled = false;
    } catch (e) {
      aviso.className = "modal-aviso erro";
      aviso.innerHTML = `<strong>Erro:</strong> ${_esc(e.message)}`;
      btn.disabled = false; btn.textContent = "Tentar de novo";
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new PaginaAgentes().iniciar();
});
