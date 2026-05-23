// Uso pontual: garante que Sanitizar.js + ValidadorSenha.js + Usuario.js
// + ApiBEM.js carreguem ANTES de Autenticacao.js em toda página admin.
//
// Idempotente: pula HTMLs que já têm Sanitizar.js incluído.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

const arquivos = [];
const candidatos = [
  path.join(ROOT, 'paginas/admin'),
];

function listar(dir) {
  for (const nome of fs.readdirSync(dir)) {
    const full = path.join(dir, nome);
    const st = fs.statSync(full);
    if (st.isDirectory()) listar(full);
    else if (nome === 'index.html' || nome === 'admin.html') arquivos.push(full);
  }
}
candidatos.forEach(listar);

// Para cada HTML, achamos a linha do Autenticacao.js e adicionamos
// Sanitizar.js + ValidadorSenha.js LOGO ANTES (mas só se faltarem).
const reAuth = /(<script src="([^"]*?)\/scripts\/nucleo\/Autenticacao\.js[^"]*"><\/script>)/;
let mudados = 0;

for (const arq of arquivos) {
  let c = fs.readFileSync(arq, 'utf8');
  if (c.includes('/scripts/nucleo/Sanitizar.js')) {
    console.log('skip (já tem):', path.relative(ROOT, arq));
    continue;
  }
  const m = c.match(reAuth);
  if (!m) {
    console.log('SEM ANCHOR (sem Autenticacao.js):', path.relative(ROOT, arq));
    continue;
  }
  const prefixo = m[2];
  const inserir = [
    `<script src="${prefixo}/scripts/nucleo/Sanitizar.js"></script>`,
    `<script src="${prefixo}/scripts/nucleo/ValidadorSenha.js"></script>`,
  ].join('\n');
  c = c.replace(reAuth, `${inserir}\n$1`);
  fs.writeFileSync(arq, c);
  console.log('ok:', path.relative(ROOT, arq));
  mudados++;
}

console.log(`\ntotal mudados: ${mudados}/${arquivos.length}`);
