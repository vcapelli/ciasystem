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
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return false;

    const resposta = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!resposta.ok) {
      this.limparSessao();
      return false;
    }

    const dados = await resposta.json();
    this.salvarSessao(dados);
    return true;
  },
};

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
 * Monta a URL do avatar do Habblet a partir do `figure` (vem do backend,
 * que busca em api.habblet.city — nunca chamar essa API direto do
 * navegador, ela não libera CORS pra qualquer domínio).
 *
 * modo 'pose'  — corpo inteiro sentado, pro card de boas-vindas
 * modo 'cabeca' — só a cabeça, pra avatares pequenos (navbar, listas)
 */
function avatarUrl(figure, modo = 'cabeca', tamanho = 'm') {
  if (!figure) return null;
  const params = new URLSearchParams({ figure, img_format: 'png', size: tamanho });
  if (modo === 'pose') {
    params.set('action', 'sit,crr=256,wav');
    params.set('direction', '4');
    params.set('head_direction', '3');
    params.set('gesture', 'sml');
    params.set('headonly', '0');
  } else {
    params.set('headonly', '1');
    params.set('direction', '2');
    params.set('head_direction', '3');
  }
  return `https://imaging.habblet.city/avatarimage?${params.toString()}`;
}
