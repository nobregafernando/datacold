#!/usr/bin/env node
/**
 * scripts/build/versionar.js
 *
 * Cache-busting automático: antes de cada deploy, injeta ?v=<BUILD_ID>
 * em todo <script src="..."> e <link href="..."> que aponta para um
 * arquivo LOCAL (.js, .css, .json). URLs externas (http/https///) são
 * ignoradas.
 *
 * Roda automaticamente via "predeploy" no firebase.json.
 *
 * Por que isto resolve o cache antigo:
 *   - Mesmo com Cache-Control: no-store, navegadores antigos podem
 *     servir bytes em disco. Como o browser trata "app.js?v=123" e
 *     "app.js?v=124" como recursos distintos, o ?v= novo força o
 *     download da versão mais recente.
 *   - O BUILD_ID muda em cada deploy (timestamp), então cada deploy
 *     invalida 100% dos arquivos de uma vez.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const BUILD_ID = Date.now().toString();

// Pastas a ignorar (não tem HTML servido, ou são externas)
const IGNORAR = new Set([
  'node_modules', '.git', 'simulador', 'supabase', '__pycache__',
  '.firebase', 'scripts'
]);

// Lista todos os .html recursivamente, exceto pastas ignoradas
function listarHtml(dir, lista = []) {
  for (const nome of fs.readdirSync(dir)) {
    if (nome.startsWith('.')) continue;
    const caminho = path.join(dir, nome);
    const stat = fs.statSync(caminho);
    if (stat.isDirectory()) {
      if (IGNORAR.has(nome)) continue;
      listarHtml(caminho, lista);
    } else if (nome.endsWith('.html')) {
      lista.push(caminho);
    }
  }
  return lista;
}

// É URL externa? (não precisa de cache-busting)
function ehExterna(url) {
  return /^(https?:)?\/\//i.test(url) || url.startsWith('data:');
}

// Tira qualquer ?v=... anterior, deixa o resto da query intacto
function trocarVersao(url, novoId) {
  const [base, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  params.set('v', novoId);
  return `${base}?${params.toString()}`;
}

function versionarConteudo(conteudo) {
  let alterado = 0;

  // <script src="..."> e <script type="..." src="...">
  conteudo = conteudo.replace(
    /(<script\b[^>]*\bsrc=")([^"]+)(")/gi,
    (m, antes, url, depois) => {
      if (ehExterna(url)) return m;
      alterado++;
      return antes + trocarVersao(url, BUILD_ID) + depois;
    }
  );

  // <link ... href="..."> (CSS, ícones, manifests etc.)
  conteudo = conteudo.replace(
    /(<link\b[^>]*\bhref=")([^"]+)(")/gi,
    (m, antes, url, depois) => {
      if (ehExterna(url)) return m;
      // Só versiona se tiver extensão local conhecida — evita versionar /algo sem extensão
      if (!/\.(css|js|json|png|jpg|jpeg|gif|webp|svg|ico|webmanifest)(\?|$)/i.test(url)) return m;
      alterado++;
      return antes + trocarVersao(url, BUILD_ID) + depois;
    }
  );

  return { conteudo, alterado };
}

function main() {
  console.log(`[versionar] BUILD_ID=${BUILD_ID}`);
  const arquivos = listarHtml(RAIZ);
  let totalArquivos = 0;
  let totalRefs = 0;

  for (const arquivo of arquivos) {
    const original = fs.readFileSync(arquivo, 'utf8');
    const { conteudo, alterado } = versionarConteudo(original);
    if (alterado > 0 && conteudo !== original) {
      fs.writeFileSync(arquivo, conteudo, 'utf8');
      totalArquivos++;
      totalRefs += alterado;
      console.log(`[versionar] ${path.relative(RAIZ, arquivo)} — ${alterado} ref(s) atualizada(s)`);
    }
  }

  // Grava versao.json para referência (debug / suporte)
  fs.writeFileSync(
    path.join(RAIZ, 'versao.json'),
    JSON.stringify({ build_id: BUILD_ID, gerado_em: new Date().toISOString() }, null, 2),
    'utf8'
  );

  console.log(`[versionar] Concluído: ${totalRefs} referência(s) em ${totalArquivos} arquivo(s).`);
}

main();
