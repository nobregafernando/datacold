/**
 * Página · Ambiente Controlado
 *
 * - Monta menu lateral + menu superior
 * - Anima os KPIs do hero
 * - Renderiza a grade de "personalidades" dos sensores
 */

// ======================== Personalidades dos sensores ========================
// Mesmas falhas embutidas no perfil real do simulador (perfis.py / supabase).
// Esta é a fonte de verdade visual — quando trocar uma personalidade no
// banco, atualize aqui também.
const PERSONAGENS = [
  // EXTRUSÃO
  { id: "extrusora_1",            tipo: "energia",     emoji: "⚡", nome: "Extrusora 1",            falha: "FP baixo crônico (0,70) — banco de capacitores queimado",            tag: "atencao" },
  { id: "extrusora_2",            tipo: "energia",     emoji: "⚡", nome: "Extrusora 2",            falha: "FP muito baixo (0,45) + drops frequentes do contator",               tag: "critico" },
  { id: "extrusora_3",            tipo: "energia",     emoji: "⚡", nome: "Extrusora 3",            falha: "Fluxo reverso (FP negativo) — TCs invertidos na instalação",        tag: "critico" },

  // CÂMARA DE CONGELADOS
  { id: "congelados_compressor",  tipo: "energia",     emoji: "❄", nome: "Compressor Congelados",  falha: "TC invertido (FP -0,43) + desequilíbrio CUB 11% (crítico)",         tag: "critico" },
  { id: "congelados_temperatura", tipo: "temperatura", emoji: "🌡", nome: "Temperatura Congelados", falha: "Vive em -8°C (alvo -22°C) + spikes para +85°C ocasionais",          tag: "critico" },

  // CÂMARA DE ESTOQUE
  { id: "estoque_compressor_1",   tipo: "energia",     emoji: "⚡", nome: "Compressor Estoque 1",   falha: "TC invertido + desequilíbrio CUB 22% (severo)",                      tag: "critico" },
  { id: "estoque_compressor_2",   tipo: "energia",     emoji: "⚡", nome: "Compressor Estoque 2",   falha: "TC invertido + volatilidade crescente (short-cycling)",              tag: "atencao" },
  { id: "estoque_temperatura",    tipo: "temperatura", emoji: "🌡", nome: "Temperatura Estoque",    falha: "Estável em -3,9°C, sobe +0,5°C após cada abertura da porta",         tag: "estavel" },
  { id: "estoque_porta",          tipo: "porta",       emoji: "🚪", nome: "Porta Estoque",          falha: "Aberturas raras mas longas (~5h em média) · sinal semi-analógico",   tag: "atencao" },

  // GRAXARIA
  { id: "graxaria_energia",       tipo: "energia",     emoji: "⚡", nome: "Energia Graxaria",       falha: "Fases A e B em zero — fase ausente confirmada (histórico)",          tag: "critico" },
  { id: "graxaria_temperatura",   tipo: "temperatura", emoji: "🌡", nome: "Temperatura Graxaria",   falha: "Estável em -9,2°C (histórico)",                                      tag: "estavel" },
  { id: "graxaria_porta",         tipo: "porta",       emoji: "🚪", nome: "Porta Graxaria",         falha: "Padrão evolutivo: +292% entre as metades do período",                tag: "atencao" },

  // EXTERNOS
  { id: "externo_cg_temperatura", tipo: "temperatura", emoji: "🌡", nome: "Externo · Campo Grande", falha: "Ciclo dia/noite natural (~13 a 30°C)",                               tag: "estavel" },
  { id: "externo_tl_temperatura", tipo: "temperatura", emoji: "🌡", nome: "Externo · Três Lagoas",  falha: "Sensor defeituoso — leituras impossíveis (-3276°C) ocasionais",      tag: "critico" },
];

const RotuloTag = { critico: "crítico", atencao: "atenção", estavel: "estável" };

function renderizarPersonagens() {
  const grade = document.getElementById("grade-personagens");
  if (!grade) return;
  grade.innerHTML = PERSONAGENS.map(p => `
    <article class="amb-personagem" data-tipo="${p.tipo}">
      <div class="amb-personagem-avatar" aria-hidden="true">${p.emoji}</div>
      <div class="amb-personagem-corpo">
        <div class="amb-personagem-nome">${p.nome}</div>
        <div class="amb-personagem-falha">${p.falha}</div>
        <span class="amb-personagem-tag ${p.tag}">${RotuloTag[p.tag] || p.tag}</span>
      </div>
    </article>
  `).join("");
}

// ======================== Animação dos KPIs do hero ========================
function animarKpis() {
  const els = document.querySelectorAll("[data-anima]");
  els.forEach(el => {
    const alvo = Number(el.dataset.anima);
    const sufixo = el.dataset.sufixo || "";
    if (!alvo || Number.isNaN(alvo)) return;
    const duracao = 900;
    const inicio = performance.now();
    function passo(t) {
      const p = Math.min(1, (t - inicio) / duracao);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(alvo * eased);
      el.textContent = v + sufixo;
      if (p < 1) requestAnimationFrame(passo);
    }
    requestAnimationFrame(passo);
  });
}

// ======================== Boot ========================
document.addEventListener("DOMContentLoaded", async () => {
  // Exige sessão ativa para a página admin
  if (!Autenticacao.usuarioAtual()) {
    window.location.href = "../../login/";
    return;
  }

  // Monta menu lateral e barra superior
  const menu = new MenuLateral({ paginaAtiva: "ambiente", raiz: "../../../" });
  await menu.montar("#menu-lateral");
  if (window.MenuTopo) {
    const topo = new MenuTopo({ raiz: "../../../" });
    topo.montar("#menu-topo");
  }

  renderizarPersonagens();
  animarKpis();
});
