/**
 * Constantes técnicas centralizadas — uma fonte só pra TODAS as normas e
 * thresholds que os agentes usam. Cada valor cita a referência (PRODIST,
 * NEMA, ANVISA, Codex…) pra que o veredito possa exibir a origem da regra
 * no front e ser auditável.
 *
 * Cada bloco devolve `valor` + `fonte`. A `fonte` é texto curto pra UI
 * ("PRODIST 8 — ANEEL").
 *
 * Pra MUDAR um limite só pra UM sensor específico, sobreponha via
 * `sensor.parametros` na tabela `sensores` do Supabase (jsonb). Os
 * agentes lêem da norma como default, e do sensor como override.
 */
const NORMAS = {

  // =================================================================
  //  ENERGIA — distribuição elétrica
  // =================================================================
  ANEEL: {
    fp_minimo:      { valor: 0.92,  fonte: "PRODIST Módulo 8 — ANEEL §3.2" },
    fp_critico:     { valor: 0.85,  fonte: "PRODIST Módulo 8 — ANEEL §3.2" },
    tensao_tolerancia_pct: { valor: 5, fonte: "PRODIST 8 — Anexo VIII (±5% da nominal)" },
  },

  NEMA: {
    cub_atencao_pct: { valor: 5,   fonte: "NEMA MG-1 §14.35 (desequilíbrio de corrente)" },
    cub_critico_pct: { valor: 10,  fonte: "NEMA MG-1 §14.35 (zona crítica)" },
    vub_ideal_pct:   { valor: 1,   fonte: "NEMA MG-1 (ideal)" },
    vub_max_pct:     { valor: 2,   fonte: "NEMA MG-1 (máx tolerável)" },
    partida_min_x:   { valor: 5,   fonte: "IEEE 141 — partida típica de motor" },
    partida_max_x:   { valor: 7,   fonte: "IEEE 141 — partida típica de motor" },
  },

  // =================================================================
  //  TEMPERATURA — refrigeração de alimentos
  // =================================================================
  ANVISA: {
    rdc_275: {                fonte: "ANVISA RDC 275 — temperatura de câmaras refrigeradas" },
    faixas: {
      camara_congelados: { min: -28, max: -18, label: "câmara de congelados (Codex/ANVISA)" },
      camara_estoque:    { min:  -4, max:   4, label: "câmara fria de estoque (ANVISA)" },
      graxaria:          { min: -10, max:   4, label: "câmara da graxaria" },
    },
  },

  CODEX: {
    sorvete_max_c:  { valor: -18,  fonte: "Codex Alimentarius CAC/GL 50 — armazenamento de sorvete" },
  },

  TEMPERATURA: {
    envelope_min_c:        { valor: -100, fonte: "Limite físico — termopar industrial" },
    envelope_max_c:        { valor:  100, fonte: "Limite físico — termopar industrial" },
    oscilacao_warn_sigma:  { valor: 5,    fonte: "Engenharia frigorífica — variação aceitável" },
    sensor_travado_sigma:  { valor: 0.05, fonte: "σ próximo de zero = sensor congelado" },
    tendencia_warn_c_h:    { valor: 1.0,  fonte: "Engenharia frigorífica — drift relevante" },
    z_score_pico:          { valor: 3,    fonte: "Estatística — outlier >3σ" },
    tempo_fora_warn_pct:   { valor: 10,   fonte: "Engenharia frigorífica — tempo fora aceitável" },
    tempo_fora_crit_pct:   { valor: 30,   fonte: "Engenharia frigorífica — tempo fora crítico" },
  },

  // =================================================================
  //  PORTA — câmaras com controle de acesso
  // =================================================================
  PORTA: {
    esquecida_s:          { valor: 600,  fonte: "Boa prática operacional — porta esquecida > 10min" },
    tempo_medio_warn_s:   { valor: 120,  fonte: "Boa prática — abertura típica < 2min" },
    rajada_intervalo_s:   { valor: 60,   fonte: "Engenharia operacional — aberturas em rajada" },
    mudanca_padrao_pct:   { valor: 50,   fonte: "Análise de padrão — mudança >50% entre metades" },
  },

  // =================================================================
  //  TELEMETRIA — qualidade do dado
  // =================================================================
  TELEMETRIA: {
    gap_multiplicador:    { valor: 2,    fonte: "ISO 8000 — gap = 2× intervalo médio" },
    lacunas_warn:         { valor: 10,   fonte: "Engenharia IoT — alerta com >10 gaps" },
    lacunas_crit:         { valor: 30,   fonte: "Engenharia IoT — crítico com >30 gaps" },
    offline_multiplicador:{ valor: 10,   fonte: "Sensor offline = sem leitura > 10× cadência" },
    instavel_multiplicador:{ valor: 3,   fonte: "Sensor instável = sem leitura > 3× cadência" },
  },
};

// Helper: junta defaults da norma com overrides do sensor.
function mesclarParametros(defaults, overrides) {
  return Object.assign({}, defaults, overrides || {});
}

if (typeof window !== "undefined") {
  window.NORMAS = NORMAS;
  window.mesclarParametros = mesclarParametros;
}
