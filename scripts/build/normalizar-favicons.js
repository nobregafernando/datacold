#!/usr/bin/env node
/**
 * scripts/build/normalizar-favicons.js
 *
 * Garante que TODOS os HTMLs do projeto tenham o mesmo conjunto de favicons,
 * apontando pra arquivos locais com caminho absoluto. Isso evita quebras
 * quando uma página fica numa profundidade diferente e elimina dependência
 * de URLs externas (ex: Supabase Storage).
 *
 * O que faz pra cada HTML:
 *   1) Remove TODOS os <link rel="icon">, <link rel="shortcut icon"> e
 *      <link rel="apple-touch-icon"> existentes.
 *   2) Insere o bloco padrão logo antes do primeiro <link rel="preconnect">
 *      (ou, se não tiver, antes do </head>).
 *
 * O versionamento ?v=... é responsabilidade do aplicar-sem-cache.js — rode
 * ele DEPOIS deste script. Aqui só normalizamos o bloco com caminhos limpos.
 *
 * Uso: node scripts/build/normalizar-favicons.js
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');

const BLOCO_PADRAO = `<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`;

/** Acha todos os .html ignorando node_modules e .firebase. */
function listarHtmls(dir) {
  const out = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name.startsWith('.') || entrada.name === 'node_modules') continue;
    const cheio = path.join(dir, entrada.name);
    if (entrada.isDirectory()) out.push(...listarHtmls(cheio));
    else if (entrada.name.endsWith('.html')) out.push(cheio);
  }
  return out;
}

function normalizar(html) {
  // 1) Remove TODAS as tags <link rel="icon"|"shortcut icon"|"apple-touch-icon">,
  //    estejam elas isoladas em linhas ou concatenadas com outras tags na mesma linha.
  let limpo = html.replace(
    /<link\s+[^>]*rel="(?:icon|shortcut icon|apple-touch-icon)"[^>]*>\s*/g,
    ''
  );
  // 2) Colapsa múltiplas linhas em branco que possam ter ficado.
  limpo = limpo.replace(/\n{3,}/g, '\n\n');

  // 2) Insere o bloco padrão. Tenta antes do primeiro <link rel="preconnect">,
  //    senão antes do <link rel="stylesheet">, senão antes de </head>.
  const indent = '';
  const blocoIndentado = BLOCO_PADRAO.split('\n').map(l => indent + l).join('\n') + '\n';

  const padrao = /(\s*)(<link\s+rel="preconnect")/;
  if (padrao.test(limpo)) {
    limpo = limpo.replace(padrao, (_, ws, tag) => `\n${blocoIndentado}${ws}${tag}`);
  } else {
    const padraoCss = /(\s*)(<link\s+rel="stylesheet")/;
    if (padraoCss.test(limpo)) {
      limpo = limpo.replace(padraoCss, (_, ws, tag) => `\n${blocoIndentado}${ws}${tag}`);
    } else {
      limpo = limpo.replace(/(<\/head>)/i, `${blocoIndentado}$1`);
    }
  }

  return limpo;
}

function main() {
  const arquivos = listarHtmls(RAIZ);
  let mudados = 0;
  for (const arq of arquivos) {
    const original = fs.readFileSync(arq, 'utf8');
    const novo = normalizar(original);
    if (novo !== original) {
      fs.writeFileSync(arq, novo, 'utf8');
      mudados++;
      const rel = path.relative(RAIZ, arq);
      console.log(`  ✓ ${rel}`);
    }
  }
  console.log(`\nNormalizado ${mudados}/${arquivos.length} arquivos.`);
}

main();
