/**
 * Página Protótipo — montagem do menu lateral + topo.
 * O conteúdo principal é estático (HTML/SVG no index.html).
 */
(async () => {
  if (!Autenticacao.protegerPagina("../../login/", "admin", "../")) return;
  const usuario = Autenticacao.usuarioAtual();

  const raiz = "../../../";
  new MenuLateral({ usuario, raiz, paginaAtiva: "prototipo" }).montar("#menu-lateral");
  new MenuTopo({ titulo: "Protótipo", raiz }).montar("#menu-topo");
})();
