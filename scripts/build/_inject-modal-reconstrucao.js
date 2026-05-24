// Injeta ModalReconstrucao.css (depois de MenuLateral.css) e
// ModalReconstrucao.js (depois de AgenteReconstrutor.js) em todos os
// HTMLs de sensor. Idempotente.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

const dir = path.join(ROOT, 'paginas/admin/sensores');
const arquivos = [];
for (const sub of fs.readdirSync(dir)) {
  const html = path.join(dir, sub, 'index.html');
  if (fs.existsSync(html)) arquivos.push(html);
}

let mudados = 0;
for (const arq of arquivos) {
  let c = fs.readFileSync(arq, 'utf8');
  const teveMudanca = { css: false, js: false };

  // 1) CSS — depois de MenuLateral.css
  if (!c.includes('ModalReconstrucao.css')) {
    const reCss = /(<link rel="stylesheet" href="([^"]*?)\/scripts\/componentes\/MenuLateral\.css[^"]*">)/;
    const m = c.match(reCss);
    if (m) {
      const prefixo = m[2];
      c = c.replace(reCss, `$1\n<link rel="stylesheet" href="${prefixo}/scripts/componentes/ModalReconstrucao.css">`);
      teveMudanca.css = true;
    }
  }

  // 2) JS — depois de AgenteReconstrutor.js
  if (!c.includes('ModalReconstrucao.js')) {
    const reJs = /(<script src="([^"]*?)\/scripts\/agentes\/AgenteReconstrutor\.js[^"]*"><\/script>)/;
    const m = c.match(reJs);
    if (m) {
      const prefixo = m[2];
      c = c.replace(reJs, `$1\n<script src="${prefixo}/scripts/componentes/ModalReconstrucao.js"></script>`);
      teveMudanca.js = true;
    }
  }

  if (teveMudanca.css || teveMudanca.js) {
    fs.writeFileSync(arq, c);
    mudados++;
    console.log('ok:', path.relative(ROOT, arq), `(css=${teveMudanca.css}, js=${teveMudanca.js})`);
  } else {
    console.log('skip:', path.relative(ROOT, arq));
  }
}

console.log(`\ntotal mudados: ${mudados}/${arquivos.length}`);
