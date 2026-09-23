// layout.js — monta navbar + sidebar em qualquer página autenticada.
// Depende de api.js já ter sido carregado antes deste script.
//
// A navegação principal fica fixa aqui (as páginas que estamos
// construindo) — itens extras cadastrados via /menu (Fase 3, gerido
// pelos administradores do sistema) aparecem numa seção à parte no
// fim da sidebar, sem precisar reescrever esse arquivo toda vez que
// alguém cadastrar um link novo.

const NAV_PRINCIPAL = [
  { titulo: 'Início', url: '/index.html', icone: 'fa-solid fa-house' },
  { titulo: 'Feed', url: '/feed.html', icone: 'fa-solid fa-comments' },
  { titulo: 'Membros', url: '/membros.html', icone: 'fa-solid fa-users' },
  { titulo: 'Grupos', url: '/grupos.html', icone: 'fa-solid fa-building' },
  { titulo: 'Documentos', url: '/documentos.html', icone: 'fa-solid fa-file-lines' },
  { titulo: 'E-mail', url: '/email.html', icone: 'fa-solid fa-envelope' },
  { titulo: 'Notícias', url: '/noticias.html', icone: 'fa-solid fa-bullhorn' },
  { titulo: 'Diário Oficial', url: '/diario-oficial.html', icone: 'fa-solid fa-book-bookmark' },
  {
    titulo: 'Requerimentos', icone: 'fa-solid fa-file-pen', filhos: [
      { titulo: 'Instrução Inicial', url: '/requerimentos/instrucao-inicial.html' },
      { titulo: 'Contratação', url: '/requerimentos/contratacao.html' },
      { titulo: 'Integração', url: '/requerimentos/integracao.html', somenteAdmin: true },
      { titulo: 'Corpo de Praças', url: '/requerimentos/corpo-de-pracas.html' },
      { titulo: 'Corpo de Oficiais', url: '/requerimentos/corpo-de-oficiais.html' },
      { titulo: 'Corpo Executivo', url: '/requerimentos/corpo-executivo.html' },
      { titulo: 'Transferência de Conta', url: '/requerimentos/transferencia-conta.html' },
      { titulo: 'TAGs', url: '/requerimentos/tags.html' },
      { titulo: 'Desligamentos', url: '/requerimentos/desligamentos.html' },
      { titulo: 'Reforma', url: '/requerimentos/reforma.html' },
      { titulo: 'Exoneração', url: '/requerimentos/exoneracao.html' },
      { titulo: 'Gratificação', url: '/requerimentos/gratificacao.html' },
    ],
  },
  {
    titulo: 'Listagens', icone: 'fa-solid fa-list', filhos: [
      { titulo: 'Soldados', url: '/listagens/soldados.html' },
      { titulo: 'Corpo de Praças', url: '/listagens/corpo-de-pracas.html' },
      { titulo: 'Corpo de Oficiais', url: '/listagens/corpo-de-oficiais.html' },
      { titulo: 'Corpo Executivo', url: '/listagens/corpo-executivo.html' },
      { titulo: 'TAGs', url: '/listagens/tags.html' },
      { titulo: 'Reformados', url: '/listagens/reformados.html' },
      { titulo: 'Desligados', url: '/listagens/desligados.html' },
      { titulo: 'Exonerados', url: '/listagens/exonerados.html' },
      { titulo: 'Gratificação', url: '/listagens/gratificacao.html' },
    ],
  },
];

function iniciais(nick) {
  return (nick || '?').slice(0, 2).toUpperCase();
}

// ---------- Contenção de <iframe> em HTML de conteúdo ----------
//
// Documentos, notícias, e-mails, diário oficial etc. são escritos em
// HTML puro (editor-html.js) e depois jogados direto num innerHTML pra
// qualquer um ler. Isso abre brecha pra alguém colar algo como:
//   <iframe src="..." style="position:fixed;z-index:99999999;
//     width:100%;height:100%"></iframe>
// e sequestrar a tela inteira (fake login, clickjacking, etc).
//
// Uma regra de CSS não resolve: `!important` no `style` inline do
// próprio elemento tem prioridade sobre `!important` vindo de uma
// folha de estilo externa (mesmo nível de importância, e o inline
// sempre vence a comparação de especificidade/origem que vem depois).
// Então em vez de tentar competir em CSS, a gente reescreve a MESMA
// declaração inline via JS (`style.setProperty(prop, valor,
// 'important')`) — não é mais uma disputa de cascata, é a gente
// sobrescrevendo por último o que já está ali.
//
// Roda uma vez ao carregar a página e depois fica de olho via
// MutationObserver (novos elementos inseridos + qualquer tentativa de
// reescrever o `style` de um iframe já existente), então cobre
// qualquer lugar que hoje ou no futuro jogue HTML de usuário num
// innerHTML, sem precisar mexer em cada página uma por uma.
const IFRAME_ESTILO_TRAVADO = {
  position: 'static',
  top: 'auto',
  right: 'auto',
  bottom: 'auto',
  left: 'auto',
  inset: 'auto',
  'z-index': '0',
  width: '100%',
  'max-width': '100%',
  height: '400px',
  'max-height': '70vh',
  transform: 'none',
};

function conterIframe(iframe) {
  if (!(iframe instanceof HTMLIFrameElement)) return;
  for (const [propriedade, valor] of Object.entries(IFRAME_ESTILO_TRAVADO)) {
    iframe.style.setProperty(propriedade, valor, 'important');
  }
}

function ativarProtecaoIframes() {
  document.querySelectorAll('iframe').forEach(conterIframe);

  const observer = new MutationObserver((mutacoes) => {
    for (const mutacao of mutacoes) {
      if (mutacao.type === 'attributes') {
        conterIframe(mutacao.target);
        continue;
      }
      mutacao.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.tagName === 'IFRAME') conterIframe(node);
        node.querySelectorAll?.('iframe').forEach(conterIframe);
      });
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style'],
  });
}

function renderNavbar(me, logoUrl) {
  return `
    <nav class="sticky top-0 z-20 bg-dark text-white h-[72px] px-6 pr-28 flex items-center justify-between relative shadow-md">
      <a href="/index.html" class="flex items-center gap-3 shrink-0 z-10">
        <div class="h-8 w-8 rounded-lg bg-accent/25 flex items-center justify-center text-accent font-black text-sm overflow-hidden">
          ${logoUrl ? `<img src="${logoUrl}" class="w-full h-full object-contain" alt="Logo">` : 'CIA'}
        </div>
        <span class="font-display font-bold uppercase tracking-wide text-sm">CIASystem</span>
      </a>
      <div class="flex items-center gap-4 z-10">
        <div class="relative">
          <button id="btn-notificacoes" class="relative text-white/80 hover:text-accent transition-colors">
            <i class="fa-solid fa-bell text-lg"></i>
            <span id="badge-notificacoes" class="hidden absolute -top-1.5 -right-2 h-4 min-w-[16px] px-1 rounded-full bg-red-500 text-white text-[0.6rem] font-bold flex items-center justify-center leading-none">0</span>
          </button>
          <div id="painel-notificacoes" class="hidden absolute top-full right-0 mt-3 w-80 bg-card text-dark border border-border rounded-2xl shadow-lg overflow-hidden"></div>
        </div>
        <a href="/perfil/${me.nick}" class="text-sm text-white/80 hover:text-accent transition-colors">
          ${me.nick}
        </a>
      </div>
      ${me.figure ? `
      <div class="absolute top-0 right-6 h-full w-20 overflow-hidden">
        <img src="${avatarUrl(me.figure, 'mini')}" class="absolute inset-0 w-full h-full object-cover object-center" alt="">
      </div>
      ` : ''}
    </nav>
  `;
}

const ICONE_NOTIFICACAO = {
  mensagem: 'fa-solid fa-envelope', noticia: 'fa-solid fa-newspaper', noticia_grupo: 'fa-solid fa-newspaper',
  tweet_resposta: 'fa-solid fa-reply', tweet_curtida: 'fa-solid fa-heart', tweet_retweet: 'fa-solid fa-retweet',
  tweet_mencao: 'fa-solid fa-at', seguidor_novo: 'fa-solid fa-user-plus', requerimento_status: 'fa-solid fa-file-lines',
  documento_revisao: 'fa-solid fa-file-circle-check', documento_revisao_pendente: 'fa-solid fa-signature',
  emblema_recebido: 'fa-solid fa-medal', conquista_alcancada: 'fa-solid fa-trophy', sistema: 'fa-solid fa-gear',
};

async function montarNotificacoes(me) {
  const btn = document.getElementById('btn-notificacoes');
  const badge = document.getElementById('badge-notificacoes');
  const painel = document.getElementById('painel-notificacoes');
  if (!btn) return;

  async function atualizarBadge() {
    const r = await apiFetch(`/notificacoes/usuario/${me.id}?lidas=false`);
    const naoLidas = r.ok ? await r.json() : [];
    if (naoLidas.length) {
      badge.textContent = naoLidas.length > 9 ? '9+' : String(naoLidas.length);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  async function renderPainel() {
    const r = await apiFetch(`/notificacoes/usuario/${me.id}`);
    const lista = r.ok ? await r.json() : [];
    const recentes = lista.slice(0, 15);

    painel.innerHTML = `
      <div class="px-4 py-3 border-b border-border">
        <p class="text-sm font-bold">Notificações</p>
      </div>
      <div class="max-h-96 overflow-y-auto divide-y divide-border">
        ${recentes.length ? recentes.map((n) => `
          <div data-notif-id="${n.id}" data-caminho="${(n.corpo || '').startsWith('/') ? n.corpo : ''}"
            class="flex items-start gap-3 px-4 py-3 hover:bg-basebg transition-colors cursor-pointer ${!n.lido_em ? 'bg-accent/5' : ''}">
            <span class="h-8 w-8 rounded-full bg-basebg border border-border flex items-center justify-center text-accent shrink-0">
              <i class="${ICONE_NOTIFICACAO[n.tipo] || 'fa-solid fa-bell'} text-sm"></i>
            </span>
            <div class="min-w-0">
              <p class="text-sm ${!n.lido_em ? 'font-semibold' : ''}">${n.titulo}</p>
              ${n.corpo && !n.corpo.startsWith('/') ? `<p class="text-xs text-muted mt-0.5">${n.corpo}</p>` : ''}
              <p class="text-xs text-muted mt-0.5">${new Date(n.criado_em).toLocaleString('pt-BR')}</p>
            </div>
          </div>
        `).join('') : '<p class="text-sm text-muted px-4 py-6 text-center">Nenhuma notificação ainda.</p>'}
      </div>
    `;

    painel.querySelectorAll('[data-notif-id]').forEach((item) => {
      item.addEventListener('click', async () => {
        await apiFetch(`/notificacoes/${item.dataset.notifId}/lida`, { method: 'PATCH' });
        if (item.dataset.caminho) window.location.href = item.dataset.caminho;
        else { await atualizarBadge(); await renderPainel(); }
      });
    });
  }

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const abrindo = painel.classList.contains('hidden');
    painel.classList.toggle('hidden');
    if (abrindo) { await renderPainel(); await atualizarBadge(); }
  });
  document.addEventListener('click', (e) => {
    if (!painel.contains(e.target) && e.target !== btn) painel.classList.add('hidden');
  });

  atualizarBadge();
}

function linkAtivo(url, paginaAtiva) {
  return url === paginaAtiva ? 'bg-accent/10 text-accent font-semibold' : 'text-muted hover:bg-black/5 hover:text-dark';
}

function renderItemMenu(item, paginaAtiva, souAdmin) {
  if (item.filhos) {
    const filhosVisiveis = item.filhos.filter((f) => !f.somenteAdmin || souAdmin);
    const abrir = filhosVisiveis.some((f) => f.url === paginaAtiva);
    return `
      <details class="group" ${abrir ? 'open' : ''}>
        <summary class="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer text-sm text-muted hover:bg-black/5 hover:text-dark transition-colors">
          <i class="${item.icone || ''} text-gray-400 w-4 text-center"></i><span>${item.titulo}</span>
        </summary>
        <div class="ml-6 mt-1 space-y-0.5">
          ${filhosVisiveis.map((f) => `
            <a href="${f.url}" class="block px-3 py-1.5 rounded-lg text-sm transition-colors ${linkAtivo(f.url, paginaAtiva)}">${f.titulo}</a>
          `).join('')}
        </div>
      </details>
    `;
  }
  return `
    <a href="${item.url}" class="flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors ${linkAtivo(item.url, paginaAtiva)}">
      <i class="${item.icone || ''} text-gray-400 w-4 text-center"></i><span>${item.titulo}</span>
    </a>
  `;
}

function renderSidebar(itensExtras, paginaAtiva, souAdmin) {
  const extras = (itensExtras || []).filter((i) => !i.item_pai_id);
  return `
    <div class="space-y-1">
      ${NAV_PRINCIPAL.map((item) => renderItemMenu(item, paginaAtiva, souAdmin)).join('')}
      ${souAdmin ? renderItemMenu({ titulo: 'Admin', url: '/admin.html', icone: 'fa-solid fa-user-shield' }, paginaAtiva, souAdmin) : ''}
    </div>
    ${extras.length ? `
      <div class="mt-6 pt-4 border-t border-border">
        <p class="px-3 text-xs uppercase tracking-wide text-muted mb-2">Mais</p>
        <div class="space-y-1">
          ${extras.map((item) => `
            <a href="${item.url || '#'}" class="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-muted hover:bg-black/5 hover:text-dark transition-colors">
              <i class="${item.icone || 'fa-solid fa-link'} text-gray-400 w-4 text-center"></i><span>${item.titulo}</span>
            </a>
          `).join('')}
        </div>
      </div>
    ` : ''}
  `;
}

/**
 * Monta navbar + sidebar na página atual. Chamar no início de todo
 * script de página autenticada:
 *   const me = await montarLayout('/feed.html');
 * `paginaAtiva` é a URL exata do item de NAV_PRINCIPAL que deve ficar
 * destacado (inclusive dentro de submenus).
 */
async function montarLayout(paginaAtiva) {
  ativarProtecaoIframes();

  if (!Auth.estaLogado()) {
    window.location.href = '/login.html';
    return null;
  }

  const [meResp, menuResp, config] = await Promise.all([
    apiFetch('/usuarios/me'),
    apiFetch('/menu'),
    buscarConfiguracoes(),
  ]);

  if (!meResp.ok) {
    // 401 aqui é mesmo problema de sessão (apiFetch já tentou renovar
    // e falhou) — desloga de verdade. Qualquer outro status (500, 502,
    // 503, etc.) é a API fora do ar, não a sessão inválida: manter o
    // login e mandar pra tela de erro em vez de forçar um logout que
    // faria a pessoa digitar a senha de novo à toa.
    if (meResp.status === 401) {
      Auth.logout();
    } else {
      window.location.href = '/erro/500.html';
    }
    return null;
  }

  const me = await meResp.json();
  const itensExtras = menuResp.ok ? await menuResp.json() : [];

  document.body.insertAdjacentHTML('afterbegin', renderNavbar(me, config.logo_url));

  if (config.logo_url) {
    let iconeLink = document.querySelector('link[rel="icon"]');
    if (!iconeLink) {
      iconeLink = document.createElement('link');
      iconeLink.rel = 'icon';
      document.head.appendChild(iconeLink);
    }
    iconeLink.href = config.logo_url;
  }

  const sidebarHost = document.getElementById('layout-sidebar');
  if (sidebarHost) sidebarHost.innerHTML = renderSidebar(itensExtras, paginaAtiva, me.administrador_sistema);

  document.getElementById('btn-logout')?.addEventListener('click', () => Auth.logout());
  montarNotificacoes(me);

  return me;
}
