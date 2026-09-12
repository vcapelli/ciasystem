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
  {
    titulo: 'Requerimentos', icone: 'fa-solid fa-file-pen', filhos: [
      { titulo: 'Instrução Inicial', url: '/requerimentos/instrucao-inicial.html' },
      { titulo: 'Contratação', url: '/requerimentos/contratacao.html' },
      { titulo: 'Corpo de Praças', url: '/requerimentos/corpo-de-pracas.html' },
      { titulo: 'Corpo de Oficiais', url: '/requerimentos/corpo-de-oficiais.html' },
      { titulo: 'Corpo Executivo', url: '/requerimentos/corpo-executivo.html' },
      { titulo: 'Transferência de Conta', url: '/requerimentos/transferencia-conta.html' },
      { titulo: 'TAGs', url: '/requerimentos/tags.html' },
      { titulo: 'Desligamentos', url: '/requerimentos/desligamentos.html' },
      { titulo: 'Reforma', url: '/requerimentos/reforma.html' },
      { titulo: 'Exoneração', url: '/requerimentos/exoneracao.html' },
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
    ],
  },
];

function iniciais(nick) {
  return (nick || '?').slice(0, 2).toUpperCase();
}

function renderNavbar(me, logoUrl) {
  return `
    <nav class="sticky top-0 z-20 bg-dark text-white h-[72px] px-6 pr-28 flex items-center justify-between relative overflow-hidden shadow-md">
      <a href="/index.html" class="flex items-center gap-3 shrink-0 z-10">
        <div class="h-8 w-8 rounded-lg bg-accent/25 flex items-center justify-center text-accent font-black text-sm overflow-hidden">
          ${logoUrl ? `<img src="${logoUrl}" class="w-full h-full object-contain" alt="Logo">` : 'CIA'}
        </div>
        <span class="font-display font-bold uppercase tracking-wide text-sm">CIASystem</span>
      </a>
      <a href="/perfil/${me.nick}" class="text-sm text-white/80 hover:text-accent transition-colors z-10">
        ${me.nick}
      </a>
      ${me.figure ? `
      <div class="absolute top-0 right-6 h-full w-20 overflow-hidden">
        <img src="${avatarUrl(me.figure, 'mini')}" class="absolute inset-0 w-full h-full object-cover object-center" alt="">
      </div>
      ` : ''}
    </nav>
  `;
}

function linkAtivo(url, paginaAtiva) {
  return url === paginaAtiva ? 'bg-accent/10 text-accent font-semibold' : 'text-muted hover:bg-black/5 hover:text-dark';
}

function renderItemMenu(item, paginaAtiva) {
  if (item.filhos) {
    const abrir = item.filhos.some((f) => f.url === paginaAtiva);
    return `
      <details class="group" ${abrir ? 'open' : ''}>
        <summary class="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer text-sm text-muted hover:bg-black/5 hover:text-dark transition-colors">
          <i class="${item.icone || ''} text-gray-400 w-4 text-center"></i><span>${item.titulo}</span>
        </summary>
        <div class="ml-6 mt-1 space-y-0.5">
          ${item.filhos.map((f) => `
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
      ${NAV_PRINCIPAL.map((item) => renderItemMenu(item, paginaAtiva)).join('')}
      ${souAdmin ? renderItemMenu({ titulo: 'Admin', url: '/admin.html', icone: 'fa-solid fa-user-shield' }, paginaAtiva) : ''}
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
    Auth.logout();
    return null;
  }

  const me = await meResp.json();
  const itensExtras = menuResp.ok ? await menuResp.json() : [];

  document.body.insertAdjacentHTML('afterbegin', renderNavbar(me, config.logo_url));

  const sidebarHost = document.getElementById('layout-sidebar');
  if (sidebarHost) sidebarHost.innerHTML = renderSidebar(itensExtras, paginaAtiva, me.administrador_sistema);

  document.getElementById('btn-logout')?.addEventListener('click', () => Auth.logout());

  return me;
}
