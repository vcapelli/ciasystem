// Worker mínimo do frontend: serve os arquivos estáticos normalmente,
// mas pra URLs com parâmetro (ex: /perfil/vcapelli) sempre entrega o
// mesmo HTML compartilhado por baixo, SEM mudar o que aparece na
// barra de endereço do navegador — a página em si lê o nick/sigla/nome
// direto de `location.pathname` via JavaScript.
//
// Isso substitui o `_redirects` (que não se comportou como esperado
// nesse produto) por reescrita feita no próprio código do Worker,
// que é garantida pelo runtime, não por um recurso de config que
// pode não estar disponível.

const REESCRITAS = [
  { prefixo: '/perfil/', arquivo: '/perfil-dashboard.html' },
  // outras entram aqui conforme construímos os próximos lotes:
  // { prefixo: '/grupos/', arquivo: '/grupos-dashboard.html' },
  // { prefixo: '/documentos/', arquivo: '/documento-ver.html' },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    for (const regra of REESCRITAS) {
      if (url.pathname.startsWith(regra.prefixo) && url.pathname !== regra.prefixo) {
        const urlInterna = new URL(regra.arquivo, url);
        return env.ASSETS.fetch(new Request(urlInterna, request));
      }
    }

    return env.ASSETS.fetch(request);
  },
};
