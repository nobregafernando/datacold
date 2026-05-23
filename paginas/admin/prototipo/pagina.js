/**
 * Página Protótipo — montagem do menu lateral + topo.
 * O conteúdo principal é estático (HTML/SVG no index.html).
 */
(async () => {
  const usuario = Autenticacao.usuarioAtual();
  if (!usuario) { window.location.href = "../../login/login.html"; return; }

  const raiz = "../../../";
  new MenuLateral({ usuario, raiz, paginaAtiva: "prototipo" }).montar("#menu-lateral");
  new MenuTopo({ titulo: "Protótipo", raiz }).montar("#menu-topo");
})();
