// layout.js — monta navbar + sidebar em qualquer página autenticada.
// Depende de api.js já ter sido carregado antes deste script.
//
// A navegação principal fica fixa aqui (as páginas que estamos
// construindo) — itens extras cadastrados via /menu (Fase 3, gerido
// pelos administradores do sistema) aparecem numa seção à parte no
// fim da sidebar, sem precisar reescrever esse arquivo toda vez que
// alguém cadastrar um link novo.

const NAV_PRINCIPAL = [
  { titulo: 'Início', url: '/index.html', icone: '🏠' },
  { titulo: 'Feed', url: '/feed.html', icone: '🗨️' },
  { titulo: 'Membros', url: '/membros.html', icone: '👥' },
  { titulo: 'Grupos', url: '/grupos.html', icone: '🏢' },
  { titulo: 'Documentos', url: '/documentos.html', icone: '📄' },
  { titulo: 'E-mail', url: '/email.html', icone: '✉️' },
  {
    titulo: 'Requerimentos', icone: '📝', filhos: [
      { titulo: 'Instrução Inicial', url: '/requerimentos/instrucao-inicial.html' },
      { titulo: 'Corpo de Praças', url: '/requerimentos/corpo-de-pracas.html' },
      { titulo: 'Corpo de Oficiais', url: '/requerimentos/corpo-de-oficiais.html' },
      { titulo: 'Corpo Executivo', url: '/requerimentos/corpo-executivo.html' },
      { titulo: 'TAGs', url: '/requerimentos/tags.html' },
      { titulo: 'Desligamentos', url: '/requerimentos/desligamentos.html' },
      { titulo: 'Reforma', url: '/requerimentos/reforma.html' },
      { titulo: 'Exoneração', url: '/requerimentos/exoneracao.html' },
    ],
  },
  {
    titulo: 'Listagens', icone: '📋', filhos: [
      { titulo: 'Soldados', url: '/listagens/soldados.html' },
      { titulo: 'Corpo de Praças', url: '/listagens/corpo-de-pracas.html' },
      { titulo: 'Corpo de Oficiais', url: '/listagens/corpo-de-oficiais.html' },
      { titulo: 'Corpo Executivo', url: '/listagens/corpo-executivo.html' },
      { titulo: 'TAGs', url: '/listagens/tags.html' },
      { titulo: 'Reformados', url: '/listagens/reformados.html' },
      { titulo: 'Exonerados', url: '/listagens/exonerados.html' },
    ],
  },
];

function iniciais(nick) {
  return (nick || '?').slice(0, 2).toUpperCase();
}

function renderNavbar(me) {
  return `
    <nav class="sticky top-0 z-20 bg-card/90 backdrop-blur border-b border-border px-6 py-3 flex items-center justify-between">
      <a href="/index.html" class="flex items-center gap-3">
        <div class="h-8 w-8 rounded-lg bg-amber/20 flex items-center justify-center text-amber font-bold text-sm">CIA</div>
        <span class="font-semibold">CIASystem</span>
      </a>
      <div class="flex items-center gap-4">
        <a href="/perfil/${me.nick}" class="flex items-center gap-2 text-sm hover:text-amber transition-colors">
          <span class="h-7 w-7 rounded-full bg-border flex items-center justify-center text-xs font-semibold">${iniciais(me.nick)}</span>
          <span class="text-muted">${me.nick}${me.patente_nome ? ` · ${me.patente_nome}` : ''}</span>
        </a>
        ${me.administrador_sistema ? '<a href="/admin.html" class="text-sm text-muted hover:text-white transition-colors">Admin</a>' : ''}
        <button id="btn-logout" class="text-sm text-muted hover:text-white transition-colors">Sair</button>
      </div>
    </nav>
  `;
}

function linkAtivo(url, paginaAtiva) {
  return url === paginaAtiva ? 'bg-amber/15 text-amber' : 'text-muted hover:bg-white/5 hover:text-white';
}

function renderItemMenu(item, paginaAtiva) {
  if (item.filhos) {
    const abrir = item.filhos.some((f) => f.url === paginaAtiva);
    return `
      <details class="group" ${abrir ? 'open' : ''}>
        <summary class="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer text-sm text-muted hover:bg-white/5 hover:text-white transition-colors">
          <span>${item.icone || ''}</span><span>${item.titulo}</span>
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
      <span>${item.icone || ''}</span><span>${item.titulo}</span>
    </a>
  `;
}

function renderSidebar(itensExtras, paginaAtiva) {
  const extras = (itensExtras || []).filter((i) => !i.item_pai_id);
  return `
    <div class="space-y-1">
      ${NAV_PRINCIPAL.map((item) => renderItemMenu(item, paginaAtiva)).join('')}
    </div>
    ${extras.length ? `
      <div class="mt-6 pt-4 border-t border-border">
        <p class="px-3 text-xs uppercase tracking-wide text-muted mb-2">Mais</p>
        <div class="space-y-1">
          ${extras.map((item) => `
            <a href="${item.url || '#'}" class="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-muted hover:bg-white/5 hover:text-white transition-colors">
              <span>${item.icone || '🔗'}</span><span>${item.titulo}</span>
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

  const [meResp, menuResp] = await Promise.all([apiFetch('/usuarios/me'), apiFetch('/menu')]);

  if (!meResp.ok) {
    Auth.logout();
    return null;
  }

  const me = await meResp.json();
  const itensExtras = menuResp.ok ? await menuResp.json() : [];

  document.body.insertAdjacentHTML('afterbegin', renderNavbar(me));

  const sidebarHost = document.getElementById('layout-sidebar');
  if (sidebarHost) sidebarHost.innerHTML = renderSidebar(itensExtras, paginaAtiva);

  document.getElementById('btn-logout')?.addEventListener('click', () => Auth.logout());

  return me;
}
