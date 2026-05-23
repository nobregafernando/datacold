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
    apelido: "Quando o sensor reconecta depois de um silêncio, preenche o trecho perdido com dados estimados.",
    emoji: "🧩",
    cor: "reconstrutor",
    sensoresIds: ["extrusora_1","extrusora_2","extrusora_3","congelados_compressor","congelados_temperatura","estoque_compressor_1","estoque_compressor_2","estoque_temperatura","estoque_porta","graxaria_energia","graxaria_temperatura","graxaria_porta","externo_cg_temperatura","externo_tl_temperatura"],
    _especial: "reconstrutor",
  },
];

// Estratégias do reconstrutor (substituem o conceito de "regras" — ele não
// avalia condições, ele preenche gaps).
const ESTRATEGIAS_RECONSTRUTOR = [
  {
    id: "detectar-gap", categoria: "Detecção",
    label: "Quando um gap é considerado lacuna?",
    fonte: "AgenteReconstrutor.GAP_MULT × cadência do tipo",
    parametros: {
      gap_mult:             (typeof AgenteReconstrutor !== "undefined") ? AgenteReconstrutor.GAP_MULT : 2.5,
      cadencia_energia:     (typeof AgenteReconstrutor !== "undefined") ? AgenteReconstrutor.CADENCIA_S.energia : 30,
      cadencia_temperatura: (typeof AgenteReconstrutor !== "undefined") ? AgenteReconstrutor.CADENCIA_S.temperatura : 60,
      cadencia_porta:       (typeof AgenteReconstrutor !== "undefined") ? AgenteReconstrutor.CADENCIA_S.porta : 60,
    },
  },
  { id: "estrategia-energia",    categoria: "Energia",     label: "Como reconstrói leituras de energia",
    fonte: "Interpolação linear das 9 métricas (correntes, tensões, FPs)" },
  { id: "estrategia-temperatura", categoria: "Temperatura", label: "Como reconstrói leituras de temperatura",
    fonte: "Interpolação linear da temperatura" },
  { id: "estrategia-porta",       categoria: "Porta",       label: "Como reconstrói o sinal de porta",
    fonte: "Função degrau — mantém último estado conhecido" },
  { id: "marcacao",               categoria: "Marcação",    label: "Como sinaliza pontos estimados",
    fonte: "flag `_reconstruido = true` em cada ponto" },
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

  // ---- Reconstrutor ----
  "detectar-gap":            "Considera lacuna qualquer intervalo > 2,5× o tempo normal entre leituras daquele tipo.",
  "estrategia-energia":      "Pega o último ponto antes da queda e o primeiro depois — desenha a linha reta entre os dois pra cada uma das 9 métricas.",
  "estrategia-temperatura":  "Mesma ideia: interpola linearmente a temperatura entre antes e depois do silêncio.",
  "estrategia-porta":        "Mantém o último estado conhecido (aberta/fechada) até a metade do gap, depois assume o estado seguinte.",
  "marcacao":                "Cada ponto preenchido vai com a flag _reconstruido=true, então o gráfico desenha em cinza tracejado pra você saber que é estimado.",
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
    if (!Autenticacao.protegerPagina("../../login//")) return;

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

        <div class="ag-sensores">
          <span class="ag-lbl">Sensores:</span>
          ${t.sensoresIds.map(s => `<code class="ag-tag-sensor">${s}</code>`).join("")}
        </div>

        <div class="ag-regras">
          ${itens.map(r => this._htmlRegra(r, t)).join("")}
        </div>

        ${t._especial === "reconstrutor" ? this._htmlGuiaReconstrutor() : ""}
      </article>
    `;
  }

  /** Guia lúdico expansível — só renderizado dentro do card do Reconstrutor. */
  _htmlGuiaReconstrutor() {
    return `
      <details class="ag-guia">
        <summary>
          <span class="ag-guia-ico">🎓</span>
          <span class="ag-guia-titulo">Como funciona? Clique pra ver passo a passo</span>
          <span class="ag-guia-seta">▾</span>
        </summary>
        <div class="ag-guia-corpo">
          <p class="ag-guia-intro">
            O Agente Reconstrutor entra em ação quando o sensor <strong>perde
            conexão</strong> e depois <strong>volta</strong>. O objetivo é
            preencher o "buraco" no gráfico da forma mais fiel possível ao
            que provavelmente aconteceu — sem fingir certeza quando não tem.
          </p>

          <div class="ag-guia-tecnico">
            <div class="ag-tec-item">
              <span class="ag-tec-rotulo">Biblioteca usada</span>
              <span class="ag-tec-valor">Nenhuma — JavaScript puro</span>
              <p>O algoritmo é implementação própria em <code>scripts/agentes/AgenteReconstrutor.js</code>
              (~250 linhas). Não usa TensorFlow.js, Prophet ou similares —
              eles pesam MB, exigem treinamento e geram resultado de "caixa
              preta". Aqui o método é <strong>explicável passo a passo</strong>
              e roda em milissegundos no navegador.</p>
            </div>
            <div class="ag-tec-item">
              <span class="ag-tec-rotulo">Algoritmo</span>
              <span class="ag-tec-valor">SPLC (Same Period Last Cycle)</span>
              <p>O mesmo método que <strong>Grafana, Prometheus, Datadog e
              CloudWatch</strong> usam pra séries temporais com sazonalidade.
              Versão melhorada: multi-ciclo ponderado + filtro de outliers +
              correção de offset nas pontas pra fechar suave.</p>
            </div>
            <div class="ag-tec-item">
              <span class="ag-tec-rotulo">Janela de histórico</span>
              <span class="ag-tec-valor">Últimos <strong>30 dias</strong> do sensor</span>
              <p>O front carrega <strong>30 dias</strong> de leituras desse
              sensor em segundo plano (atualizado a cada 5 min). Esses dados
              ficam em memória pro reconstrutor olhar quando precisar.
              Cobre os 3 ciclos: 24 horas, 7 dias e 30 dias atrás.</p>
            </div>
            <div class="ag-tec-item">
              <span class="ag-tec-rotulo">Quando recalcula</span>
              <span class="ag-tec-valor">A cada 3 segundos (refresh do gráfico)</span>
              <p>Reconstruções <strong>não são salvas no banco</strong>. São
              calculadas em memória a cada refresh — então se um ponto real
              chegar atrasado depois, ele substitui automaticamente a estimativa.
              Dado real sempre prevalece.</p>
            </div>
          </div>

          <ol class="ag-passos">
            <li>
              <div class="ag-passo-num">1</div>
              <div>
                <h4>Detecta o gap</h4>
                <p>Compara o tempo entre dois pontos consecutivos. Se passou
                de <strong>1,6×</strong> a cadência esperada do tipo
                (energia 30s, temperatura/porta 60s), considera lacuna.</p>
              </div>
            </li>
            <li>
              <div class="ag-passo-num">2</div>
              <div>
                <h4>Pega o contexto adjacente</h4>
                <p>Olha os <strong>5 últimos pontos antes</strong> do gap e
                os <strong>5 primeiros depois</strong>. Calcula a média de
                cada campo nos dois lados — assim a estimativa não fica
                refém de um ponto isolado possivelmente ruidoso.</p>
              </div>
            </li>
            <li>
              <div class="ag-passo-num">3</div>
              <div>
                <h4>Busca o mesmo horário em ciclos passados (SPLC)</h4>
                <p>Pra cada ponto faltante, procura no histórico carregado
                (7 dias) o ponto correspondente em três janelas atrás:</p>
                <ul class="ag-ciclos">
                  <li><strong>24 horas atrás</strong> — peso 50% (padrão diário)</li>
                  <li><strong>7 dias atrás</strong> — peso 30% (dia da semana)</li>
                  <li><strong>30 dias atrás</strong> — peso 20% (tendência mensal)</li>
                </ul>
                <p>É o mesmo algoritmo usado pelo Grafana, Prometheus e Datadog
                pra séries temporais com sazonalidade.</p>
              </div>
            </li>
            <li>
              <div class="ag-passo-num">4</div>
              <div>
                <h4>Filtra outliers no histórico</h4>
                <p>Antes de usar um valor do "mesmo horário ontem", verifica
                se ele é coerente com a vizinhança no próprio ciclo
                (<strong>z-score &gt; 3 = descarta</strong>). Picos anômalos
                do passado não são copiados pro presente.</p>
              </div>
            </li>
            <li>
              <div class="ag-passo-num">5</div>
              <div>
                <h4>Estratégia por CAMPO, não só por sensor</h4>
                <p>Cada métrica usa o método mais apropriado:</p>
                <table class="ag-tabela-estrategias">
                  <thead><tr><th>Campo</th><th>Estratégia</th></tr></thead>
                  <tbody>
                    <tr><td><code>tensao_*</code></td><td>Média estável (sinal quase constante)</td></tr>
                    <tr><td><code>corrente_*</code></td><td>SPLC multi-ciclo (padrão diário forte)</td></tr>
                    <tr><td><code>fator_potencia_*</code></td><td>Média do contexto</td></tr>
                    <tr><td><code>temperatura</code> (câmara)</td><td>SPLC + correção local</td></tr>
                    <tr><td><code>temperatura</code> (ambiente)</td><td>SPLC 24h dominante (ciclo dia/noite)</td></tr>
                    <tr><td><code>abertura_porta</code></td><td>Step (mantém último estado)</td></tr>
                  </tbody>
                </table>
              </div>
            </li>
            <li>
              <div class="ag-passo-num">6</div>
              <div>
                <h4>Combina via média ponderada + correção de offset</h4>
                <p>Junta os valores dos ciclos com seus pesos. Depois aplica
                uma correção linear pra "fechar" suavemente nas pontas — sem
                aquele salto feio entre dado real e reconstruído.</p>
              </div>
            </li>
            <li>
              <div class="ag-passo-num">7</div>
              <div>
                <h4>Calcula a confiança honesta</h4>
                <p>A confiança final reflete: tamanho do gap, quantos ciclos
                conseguiram contribuir, tamanho do contexto. Se for baixa,
                a <strong>linha roxa fica mais apagada</strong> no gráfico —
                pra você reparar que aquele trecho é especulativo.</p>
              </div>
            </li>
            <li>
              <div class="ag-passo-num">8</div>
              <div>
                <h4>Marca cada ponto</h4>
                <p>Cada ponto reconstruído leva <code>_reconstruido = true</code>
                e a meta completa (método, ciclos usados, confiança por campo).
                O gráfico desenha em <strong>ROXO tracejado</strong> e o tooltip
                mostra a explicação ao passar o mouse.</p>
              </div>
            </li>
          </ol>

          <h3 class="ag-guia-h3">Quando ele NÃO age</h3>
          <ul class="ag-lista-bullet">
            <li><strong>Gap ainda em curso</strong> (sensor offline AGORA, sem
              ponto-âncora depois): NÃO inventa. Em vez disso, o gráfico mostra
              "linha morta" (vazio) até o sinal voltar.</li>
            <li><strong>Incidentes spike, drift, valor_impossivel</strong>:
              os pontos chegam ao banco normalmente, só com valor alterado.
              Não há gap, então o reconstrutor não interfere.</li>
            <li><strong>Sem dado real depois</strong>: precisa de pelo menos
              um ponto antes E um ponto depois pra interpolar com segurança.</li>
          </ul>

          <h3 class="ag-guia-h3">Limitações honestas</h3>
          <ul class="ag-lista-bullet">
            <li>Gap &gt; 6h: confiança baixa porque o ciclo de 24h cobre só
              uma "fatia" do que pode ter mudado.</li>
            <li>Sensor com falha crônica: a reconstrução assume que o padrão
              histórico continua válido. Se o sensor mudou de comportamento
              recentemente, a estimativa pode ficar enviesada.</li>
            <li>Pontos reconstruídos <strong>NUNCA são gravados no banco</strong>.
              São calculados em memória a cada refresh do gráfico. Dado real
              sempre prevalece.</li>
          </ul>

          <h3 class="ag-guia-h3">Todos os parâmetros</h3>
          <table class="ag-tabela-params">
            <thead><tr><th>Parâmetro</th><th>Valor</th><th>O que faz</th></tr></thead>
            <tbody>
              <tr><td><code>GAP_MULT</code></td><td>1,6×</td><td>Multiplicador da cadência que define "lacuna". Menor = detecta gap mais rápido.</td></tr>
              <tr><td><code>N_CONTEXTO</code></td><td>5</td><td>Quantos pontos vizinhos compõem a âncora de cada lado do gap.</td></tr>
              <tr><td><code>Z_OUTLIER</code></td><td>3</td><td>Z-score acima disso = outlier no histórico, descartar.</td></tr>
              <tr><td><code>Ciclo 24h</code></td><td>peso 50%</td><td>Padrão diário, dominante (ex: turno comercial).</td></tr>
              <tr><td><code>Ciclo 7d</code></td><td>peso 30%</td><td>Dia da semana (segunda diferente de domingo).</td></tr>
              <tr><td><code>Ciclo 30d</code></td><td>peso 20%</td><td>Tendência mensal (ex: clima ou demanda sazonal).</td></tr>
              <tr><td><code>Cadência energia</code></td><td>30s</td><td>Frequência esperada de leituras de motor.</td></tr>
              <tr><td><code>Cadência temp/porta</code></td><td>60s</td><td>Frequência esperada de leituras térmicas e de porta.</td></tr>
            </tbody>
          </table>
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
