#!/usr/bin/env node
/**
 * scripts/build/aplicar-sem-cache.js
 *
 * Injeta em todos os HTML do projeto:
 *   1) Meta tags Cache-Control / Pragma / Expires no <head>
 *   2) Script inline que, ao carregar a página:
 *        - desregistra Service Workers antigos
 *        - apaga todas as caches da Cache API
 *        - se detectar build novo (versao.json mudou), faz reload sem cache
 *
 * É IDEMPOTENTE: usa marcadores <!-- BLOCO-SEM-CACHE:INICIO --> ... :FIM
 * para substituir o bloco em execuções futuras sem duplicar.
 *
 * Rode quando criar HTMLs novos ou quando quiser reforçar o bloco em
 * todas as páginas:
 *     node scripts/build/aplicar-sem-cache.js
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const IGNORAR = new Set([
  'node_modules', '.git', 'simulador', 'supabase', '__pycache__',
  '.firebase', 'scripts'
]);

const MARCA_INICIO = '<!-- BLOCO-SEM-CACHE:INICIO -->';
const MARCA_FIM = '<!-- BLOCO-SEM-CACHE:FIM -->';

const BLOCO = `${MARCA_INICIO}
<meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate, max-age=0">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<script>
(function(){
  // 1) Desregistra qualquer Service Worker antigo (PWA residual)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(rs){
      rs.forEach(function(r){ r.unregister(); });
    }).catch(function(){});
  }
  // 2) Apaga todas as caches da Cache API
  if ('caches' in window) {
    caches.keys().then(function(ks){
      ks.forEach(function(k){ caches.delete(k); });
    }).catch(function(){});
  }
  // 3) Se detectar build novo, limpa storages voláteis e recarrega forte
  try {
    fetch('/versao.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(v){
        if (!v || !v.build_id) return;
        var anterior = localStorage.getItem('__build_id');
        if (anterior && anterior !== v.build_id) {
          // Limpa apenas chaves marcadas como voláteis pra não derrubar sessão
          Object.keys(sessionStorage).forEach(function(k){
            if (k.indexOf('cache:') === 0) sessionStorage.removeItem(k);
          });
        }
        localStorage.setItem('__build_id', v.build_id);
      })
      .catch(function(){});
  } catch (_) {}
})();
</script>
${MARCA_FIM}`;

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

function aplicar(conteudo) {
  // Já tem o bloco? substitui (idempotente)
  if (conteudo.includes(MARCA_INICIO) && conteudo.includes(MARCA_FIM)) {
    const re = new RegExp(`${MARCA_INICIO}[\\s\\S]*?${MARCA_FIM}`, 'm');
    return { conteudo: conteudo.replace(re, BLOCO), acao: 'atualizado' };
  }
  // Caso contrário, insere logo depois do <meta name="viewport"...>
  const re = /(<meta\s+name="viewport"[^>]*>)/i;
  if (re.test(conteudo)) {
    return { conteudo: conteudo.replace(re, `$1\n${BLOCO}`), acao: 'inserido' };
  }
  // Sem viewport? insere após <head>
  const reHead = /(<head[^>]*>)/i;
  if (reHead.test(conteudo)) {
    return { conteudo: conteudo.replace(reHead, `$1\n${BLOCO}`), acao: 'inserido (após head)' };
  }
  return { conteudo, acao: 'PULADO (sem <head>)' };
}

function main() {
  const arquivos = listarHtml(RAIZ);
  let mudados = 0;
  for (const arquivo of arquivos) {
    const original = fs.readFileSync(arquivo, 'utf8');
    const { conteudo, acao } = aplicar(original);
    if (conteudo !== original) {
      fs.writeFileSync(arquivo, conteudo, 'utf8');
      mudados++;
      console.log(`[sem-cache] ${path.relative(RAIZ, arquivo)} — ${acao}`);
    } else {
      console.log(`[sem-cache] ${path.relative(RAIZ, arquivo)} — ${acao}`);
    }
  }
  console.log(`[sem-cache] Concluído: ${mudados}/${arquivos.length} arquivo(s) alterado(s).`);
}

main();
