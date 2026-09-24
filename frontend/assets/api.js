// Client de API compartilhado por todas as páginas do CIASystem.
// Guarda os tokens em localStorage e renova o access_token sozinho
// quando expira, usando o refresh_token — sem exigir login de novo
// a cada hora.

const API_BASE = 'https://api-rpg-dev.vitorcape.com.br'; // trocar por api-rpg.vitorcape.com.br em produção

const Auth = {
  getAccessToken: () => localStorage.getItem('cia_access_token'),
  getRefreshToken: () => localStorage.getItem('cia_refresh_token'),

  salvarSessao({ access_token, refresh_token }) {
    localStorage.setItem('cia_access_token', access_token);
    localStorage.setItem('cia_refresh_token', refresh_token);
  },

  limparSessao() {
    localStorage.removeItem('cia_access_token');
    localStorage.removeItem('cia_refresh_token');
  },

  estaLogado() {
    return Boolean(this.getRefreshToken());
  },

  async logout() {
    const refreshToken = this.getRefreshToken();
    this.limparSessao();
    if (refreshToken) {
      try {
        await fetch(`${API_BASE}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
      } catch {
        // já limpou local; se a chamada falhar, sem problema — o
        // refresh token expira sozinho em 30 dias.
      }
    }
    window.location.href = '/login.html';
  },

  async renovarSessao() {
    // Compartilha a MESMA renovação entre chamadas simultâneas: se
    // várias requisições pegam 401 ao mesmo tempo (comum agora que o
    // footer soma mais chamadas em toda página), cada uma tentando
    // renovar por conta própria faria a segunda usar um refresh_token
    // já consumido pela primeira — perdendo a sessão à toa. Com isso,
    // todas esperam a mesma promessa em andamento.
    if (this._renovacaoEmAndamento) return this._renovacaoEmAndamento;

    this._renovacaoEmAndamento = (async () => {
      const refreshToken = this.getRefreshToken();
      if (!refreshToken) return false;

      const resposta = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!resposta.ok) {
        // Antes de desistir, checa se outra aba já renovou com sucesso
        // enquanto essa chamada estava em voo — o backend rotaciona o
        // refresh_token, então a segunda tentativa a usar o token antigo
        // sempre recebe 401 mesmo a renovação tendo funcionado na outra
        // aba. Se o token salvo agora é diferente do que tentamos usar,
        // é exatamente esse caso: trata como sucesso silencioso, sem
        // limpar a sessão (que apagaria o token novo e derrubaria as duas
        // abas). Só limpa de verdade se o token continuar o mesmo.
        const refreshTokenAtual = this.getRefreshToken();
        if (refreshTokenAtual && refreshTokenAtual !== refreshToken) {
          return true;
        }
        this.limparSessao();
        return false;
      }

      const dados = await resposta.json();
      this.salvarSessao(dados);
      return true;
    })();

    try {
      return await this._renovacaoEmAndamento;
    } finally {
      this._renovacaoEmAndamento = null;
    }
  },
};

/**
 * Escapa texto livre de usuário antes de interpolar em innerHTML,
 * evitando XSS armazenado (nick, motto, bio, motivo, título etc.).
 * Mesma lógica usada em assets/projetos.js — promovida pra cá porque
 * api.js é carregado em toda página do sistema.
 */
function escapeHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

/**
 * Wrapper de fetch autenticado. Se o access_token expirou (401),
 * tenta renovar com o refresh_token e refaz a chamada UMA vez antes
 * de desistir e mandar pro login.
 */
async function apiFetch(caminho, opcoes = {}) {
  const chamar = () =>
    fetch(`${API_BASE}${caminho}`, {
      ...opcoes,
      headers: {
        'Content-Type': 'application/json',
        ...(opcoes.headers || {}),
        Authorization: `Bearer ${Auth.getAccessToken()}`,
      },
    });

  let resposta = await chamar();

  if (resposta.status === 401) {
    const renovou = await Auth.renovarSessao();
    if (renovou) {
      resposta = await chamar();
    } else {
      window.location.href = '/login.html';
      return resposta;
    }
  }

  return resposta;
}

/**
 * Configurações públicas do sistema (logo etc.) — endpoint sem
 * autenticação, então usa fetch puro em vez de apiFetch.
 */
async function buscarConfiguracoes() {
  try {
    const resposta = await fetch(`${API_BASE}/configuracoes`);
    return resposta.ok ? await resposta.json() : {};
  } catch {
    return {};
  }
}

/**
 * Igual a `buscarConfiguracoes()`, mas traz TODAS as chaves (não só
 * as marcadas como públicas) — exige estar logado. Use em telas que já
 * ficam atrás de `montarLayout()`/login e precisam de uma chave de
 * configuração operacional que não é pra vazar pra quem não tem conta
 * (ex: `projetos_grupo_responsavel_id`).
 */
async function buscarConfiguracoesAutenticadas() {
  try {
    const resposta = await apiFetch('/configuracoes/todas');
    return resposta.ok ? await resposta.json() : {};
  } catch {
    return {};
  }
}

/**
 * Monta a URL do avatar do Habblet a partir do `figure` (vem do backend,
 * que busca em api.habblet.city — nunca chamar essa API direto do
 * navegador, ela não libera CORS pra qualquer domínio).
 *
 * modo 'pose' — corpo inteiro sentado, pro card de boas-vindas
 * modo 'card' — corpo inteiro em pé, numa pose de destaque; usado no
 *   card de "novos membros" da home, sobre a moldura `.card-membro-fundo`.
 * modo 'mini' — corpo inteiro parado; usar dentro de um container
 *   pequeno com overflow-hidden + object-cover/object-top pra cortar
 *   só a cabeça via CSS (o parâmetro headonly não funciona direito
 *   nesse clone da API do Habblet).
 */
function avatarUrl(figure, modo = 'mini', direcao = '4') {
  if (!figure) return null;
  const params = new URLSearchParams({ figure, img_format: 'png' });
  if (modo === 'pose') {
    params.set('action', 'sit,crr=256,wav');
    params.set('direction', '4');
    params.set('head_direction', '3');
    params.set('gesture', 'sml');
    params.set('headonly', '0');
  } else if (modo === 'card') {
    params.set('action', 'std,crr=');
    params.set('gesture', 'sml');
    params.set('direction', direcao);
    params.set('head_direction', direcao);
    params.set('headonly', 'false');
    params.set('size', 'l');
    params.set('frame_num', '30');
  } else if (modo === 'grande') {
    // Corpo inteiro, de frente, tamanho grande — pra conferir farda/visual.
    params.set('size', 'l');
    params.set('direction', direcao);
    params.set('head_direction', direcao);
  } else {
    params.set('direction', direcao);
    params.set('head_direction', direcao);
    params.set('gesture', '0');
  }
  return `https://imaging.habblet.city/avatarimage?${params.toString()}`;
}
