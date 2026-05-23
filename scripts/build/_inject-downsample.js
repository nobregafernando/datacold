// Uso pontual: insere <script src=".../Downsample.js"> logo após FabricaSensor.js
// em todos os HTMLs de sensor e grupo. Idempotente.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

const dirs = [
  path.join(ROOT, 'paginas/admin/sensores'),
  path.join(ROOT, 'paginas/admin/grupos'),
];

const arquivos = [];
for (const d of dirs) {
  for (const sub of fs.readdirSync(d)) {
    const full = path.join(d, sub);
    if (!fs.statSync(full).isDirectory()) continue;
    if (sub === '_compartilhado') continue;
    const html = path.join(full, 'index.html');
    if (fs.existsSync(html)) arquivos.push(html);
  }
}

const re = /(<script src="([^"]*?)\/scripts\/nucleo\/FabricaSensor\.js[^"]*"><\/script>)/;
let mudados = 0;

for (const arq of arquivos) {
  let c = fs.readFileSync(arq, 'utf8');
  if (c.includes('/scripts/nucleo/Downsample.js')) {
    console.log('skip (já tem):', path.relative(ROOT, arq));
    continue;
  }
  const m = c.match(re);
  if (!m) {
    console.log('SEM ANCHOR:', path.relative(ROOT, arq));
    continue;
  }
  const prefixo = m[2];
  const linha = `<script src="${prefixo}/scripts/nucleo/Downsample.js"></script>`;
  c = c.replace(re, `$1\n${linha}`);
  fs.writeFileSync(arq, c);
  console.log('ok:', path.relative(ROOT, arq));
  mudados++;
}

console.log(`\ntotal mudados: ${mudados}/${arquivos.length}`);
