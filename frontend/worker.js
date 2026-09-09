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
  { prefixo: '/perfil/', arquivo: '/perfil-dashboard' },
  { prefixo: '/grupos/', arquivo: '/grupos-dashboard' },
  // outras entram aqui conforme construímos os próximos lotes:
  // { prefixo: '/documentos/', arquivo: '/documento-ver' },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    for (const regra of REESCRITAS) {
      if (url.pathname.startsWith(regra.prefixo) && url.pathname !== regra.prefixo) {
        const urlInterna = new URL(regra.arquivo, url);
        let resposta = await env.ASSETS.fetch(new Request(urlInterna, request));

        // Se o serviço de arquivos estáticos devolver um redirect (ex:
        // "URL limpa" apontando pra versão com/sem .html), segue esse
        // redirect POR DENTRO do Worker — nunca repassa pro navegador,
        // senão a URL visível muda e perdemos o parâmetro dinâmico.
        let tentativas = 0;
        while (resposta.status >= 300 && resposta.status < 400 && resposta.headers.get('Location') && tentativas < 5) {
          const proximaUrl = new URL(resposta.headers.get('Location'), url);
          resposta = await env.ASSETS.fetch(new Request(proximaUrl, request));
          tentativas++;
        }

        return resposta;
      }
    }

    return env.ASSETS.fetch(request);
  },
};
