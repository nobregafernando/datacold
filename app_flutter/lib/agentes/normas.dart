/// Constantes técnicas dos agentes — mesmas do JS `scripts/agentes/normas.js`.
/// Cada valor carrega a fonte pra UI auditável.
class Norma {
  const Norma(this.valor, this.fonte);
  final num valor;
  final String fonte;
}

class FaixaTermica {
  const FaixaTermica({required this.min, required this.max, required this.label});
  final double min;
  final double max;
  final String label;
}

class Normas {
  // ----- ENERGIA · ANEEL -----
  static const fpMinimo  = Norma(0.92, 'PRODIST Módulo 8 — ANEEL §3.2');
  static const fpCritico = Norma(0.85, 'PRODIST Módulo 8 — ANEEL §3.2');
  static const tensaoTolerancia = Norma(5, 'PRODIST 8 — Anexo VIII (±5% da nominal)');

  // ----- ENERGIA · NEMA -----
  static const cubAtencao = Norma(5,  'NEMA MG-1 §14.35 (desequilíbrio de corrente)');
  static const cubCritico = Norma(10, 'NEMA MG-1 §14.35 (zona crítica)');
  static const vubIdeal   = Norma(1,  'NEMA MG-1 (ideal)');
  static const vubMax     = Norma(2,  'NEMA MG-1 (máx tolerável)');
  static const partidaMinX = Norma(5, 'IEEE 141 — partida típica de motor');
  static const partidaMaxX = Norma(7, 'IEEE 141 — partida típica de motor');

  // ----- TEMPERATURA -----
  static const Map<String, FaixaTermica> faixasAnvisa = {
    'camara_congelados': FaixaTermica(min: -28, max: -18, label: 'câmara de congelados (Codex/ANVISA)'),
    'camara_estoque':    FaixaTermica(min: -4,  max: 4,   label: 'câmara fria de estoque (ANVISA)'),
    'graxaria':          FaixaTermica(min: -10, max: 4,   label: 'câmara da graxaria'),
  };
  static const envelopeMin = Norma(-100, 'Limite físico — termopar industrial');
  static const envelopeMax = Norma(100,  'Limite físico — termopar industrial');
  static const oscilacaoWarnSigma = Norma(5,   'Engenharia frigorífica — variação aceitável');
  static const sensorTravadoSigma = Norma(0.05,'σ próximo de zero = sensor congelado');
  static const tendenciaWarnCH = Norma(1.0,  'Engenharia frigorífica — drift relevante');
  static const zScorePico      = Norma(3,    'Estatística — outlier >3σ');
  static const tempoForaWarnPct = Norma(10,  'Engenharia frigorífica — tempo fora aceitável');
  static const tempoForaCritPct = Norma(30,  'Engenharia frigorífica — tempo fora crítico');
  static const sorveteMaxC = Norma(-18, 'Codex Alimentarius CAC/GL 50 — armazenamento de sorvete');

  // ----- PORTA -----
  static const portaEsquecidaS    = Norma(600, 'Boa prática operacional — porta esquecida > 10min');
  static const portaTempoMedioWarn= Norma(120, 'Boa prática — abertura típica < 2min');
  static const portaRajadaS       = Norma(60,  'Engenharia operacional — aberturas em rajada');
  static const portaMudancaPct    = Norma(50,  'Análise de padrão — mudança >50% entre metades');

  // ----- TELEMETRIA -----
  static const gapMultiplicador     = Norma(2,  'ISO 8000 — gap = 2× intervalo médio');
  static const lacunasWarn          = Norma(10, 'Engenharia IoT — alerta com >10 gaps');
  static const lacunasCrit          = Norma(30, 'Engenharia IoT — crítico com >30 gaps');
  static const offlineMultiplicador = Norma(10, 'Sensor offline = sem leitura > 10× cadência');
  static const instavelMultiplicador= Norma(3,  'Sensor instável = sem leitura > 3× cadência');
}

/// Mescla os defaults da norma com overrides do sensor (vindos do jsonb).
Map<String, dynamic> mesclarParametros(
  Map<String, dynamic> defaults,
  Map<String, dynamic>? overrides,
) =>
    {...defaults, ...?overrides};
