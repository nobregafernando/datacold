/**
 * Injeta uma "guarda de autenticação" SÍNCRONA no <head> de toda
 * página interna (paginas/admin/* e paginas/conta/*).
 *
 * Por quê: o `Autenticacao.protegerPagina()` redireciona quando não há
 * sessão, mas roda no FIM do <body> — quando o HTML já foi parseado e
 * pintado. Resultado: o usuário sem login vê o esqueleto da página
 * (menu, layout) por uma fração de segundo antes do redirect.
 *
 * A guarda inline aqui:
 *   1. Roda no <head>, ANTES do body ser pintado
 *   2. Lê localStorage["datacold_sessao"] sincronamente
 *   3. Se não houver sessão válida: esconde o <html> e dispara
 *      `location.replace()` pra /paginas/login/
 *   4. Idempotente: pula HTMLs que já têm o marcador GUARDA-AUTH
 *
 * NÃO se aplica a:
 *   - paginas/login/* (a tela de login obviamente)
 *   - paginas/conta/* (criar/recuperar/redefinir são públicas)
 *   - landing, 404, apresentacao (públicas)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PASTAS_PROTEGIDAS = [
  path.join(ROOT, 'paginas', 'admin'),
];

const MARCADOR_INI = '<!-- GUARDA-AUTH:INICIO -->';
const MARCADOR_FIM = '<!-- GUARDA-AUTH:FIM -->';

const BLOCO = `${MARCADOR_INI}
<style>html[data-aguardando-auth]{visibility:hidden}html[data-aguardando-auth] body{visibility:hidden}</style>
<script>
(function(){
  try {
    var bruto = localStorage.getItem("datacold_sessao");
    if (bruto) {
      var s = JSON.parse(bruto);
      // Sessão "real" tem access_token; sessão MVP tem só perfil.
      if (s && (s.access_token || s.perfil)) return;
    }
  } catch (e) {}
  // Sem sessão: esconde tudo (CSS sincronicamente) e redireciona pra login.
  document.documentElement.setAttribute("data-aguardando-auth", "");
  var alvo = "/paginas/login/";
  try { sessionStorage.setItem("datacold_redirect_apos_login", location.pathname + location.search); } catch(e){}
  location.replace(alvo);
})();
</script>
${MARCADOR_FIM}`;

function listarHtmls(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listarHtmls(p));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(p);
    }
  }
  return out;
}

let tocados = 0, pulados = 0, ignorados = 0;
for (const raiz of PASTAS_PROTEGIDAS) {
  if (!fs.existsSync(raiz)) continue;
  for (const arquivo of listarHtmls(raiz)) {
    let html = fs.readFileSync(arquivo, 'utf8');
    if (html.includes(MARCADOR_INI)) {
      // Já tem — atualiza o conteúdo (idempotente, vence renomeações).
      const regex = new RegExp(`${MARCADOR_INI}[\\s\\S]*?${MARCADOR_FIM}`, 'g');
      const novo = html.replace(regex, BLOCO);
      if (novo !== html) { fs.writeFileSync(arquivo, novo); tocados++; }
      else { pulados++; }
      continue;
    }
    // Não tem — injeta logo após <head> (ou logo após o BLOCO-SEM-CACHE,
    // pra ficar idiomático).
    const ancora = html.includes('<!-- BLOCO-SEM-CACHE:FIM -->')
      ? '<!-- BLOCO-SEM-CACHE:FIM -->'
      : '<head>';
    if (!html.includes(ancora)) { ignorados++; continue; }
    const novo = html.replace(ancora, ancora + '\n' + BLOCO);
    fs.writeFileSync(arquivo, novo);
    tocados++;
  }
}

console.log(`[guarda-auth] tocados: ${tocados} · sem mudança: ${pulados} · ignorados (sem âncora): ${ignorados}`);
