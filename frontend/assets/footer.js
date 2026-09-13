// footer.js — monta o rodapé do sistema dentro de #layout-footer.
// Se auto-monta sozinho (não precisa chamar nada manualmente na
// página) — só precisa existir <div id="layout-footer"></div> dentro
// do <main>, e este script carregado depois de api.js.

async function montarFooter() {
  const raiz = document.getElementById('layout-footer');
  if (!raiz) return;

  // Heartbeat: marca "online agora" — uma vez ao carregar a página, e
  // depois a cada 2 minutos enquanto a aba ficar aberta.
  apiFetch('/usuarios/heartbeat', { method: 'POST' }).catch(() => {});
  setInterval(() => apiFetch('/usuarios/heartbeat', { method: 'POST' }).catch(() => {}), 120000);

  const [config, linksResp, redesResp, onlineResp] = await Promise.all([
    buscarConfiguracoes(),
    apiFetch('/footer/links'),
    apiFetch('/footer/redes-sociais'),
    apiFetch('/usuarios/online'),
  ]);
  const links = linksResp.ok ? await linksResp.json() : [];
  const redes = redesResp.ok ? await redesResp.json() : [];
  const usuariosOnline = onlineResp.ok ? await onlineResp.json() : [];

  await Promise.all(usuariosOnline.map(async (u) => {
    try {
      const r = await apiFetch(`/usuarios/nick/${encodeURIComponent(u.nick)}`);
      u.figure = r.ok ? (await r.json()).figure : null;
    } catch { u.figure = null; }
  }));

  const nomeSistema = config.nome_sistema || 'CIASystem';
  const anoAtual = new Date().getFullYear();

  function renderAvatarOnline(u) {
    const avatar = u.figure ? avatarUrl(u.figure, 'mini', '2') : null;
    return `
      <div class="group relative">
        <a href="/perfil/${u.nick}" class="h-9 w-9 rounded-full bg-basebg border border-border overflow-hidden inline-block">
          ${avatar
            ? `<img src="${avatar}" class="w-full h-[190%] object-cover object-top -mt-2 transition-transform duration-300 group-hover:-translate-y-[6px]" alt="">`
            : `<span class="w-full h-full flex items-center justify-center text-[0.65rem] font-bold">${u.nick.slice(0,2).toUpperCase()}</span>`}
        </a>
        <span class="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap bg-dark text-white text-[0.65rem] px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity">${u.nick}</span>
      </div>
    `;
  }

  function renderLinksUteis() {
    return links.length
      ? `<ul class="space-y-1.5">${links.map((l) => `<li><a href="${l.url}" class="text-xs text-muted hover:text-accent transition-colors">${l.titulo}</a></li>`).join('')}</ul>`
      : '<p class="text-xs text-muted">—</p>';
  }

  function renderRedesSociais() {
    return redes.length
      ? `<div class="flex gap-3">${redes.map((r) => `
          <a href="${r.url}" target="_blank" rel="noopener" title="${r.nome}" class="h-8 w-8 rounded-lg bg-basebg border border-border flex items-center justify-center text-muted hover:text-accent transition-colors">
            <i class="${r.icone || 'fa-solid fa-link'}"></i>
          </a>
        `).join('')}</div>`
      : '<p class="text-xs text-muted">—</p>';
  }

  if (config.footer_estilo === 'estilo2') {
    const alinhamento = { esquerda: 'justify-start', centro: 'justify-center', direita: 'justify-end' }[config.footer_estilo2_imagem_alinhamento] || 'justify-center';
    raiz.innerHTML = `
      <footer class="mt-12 bg-basebg border-t border-border pt-8 pb-6 space-y-6">
        ${config.footer_estilo2_imagem_url ? `
          <div class="flex ${alinhamento}">
            <img src="${config.footer_estilo2_imagem_url}" class="max-h-16 object-contain" alt="">
          </div>
        ` : ''}

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div>
            <p class="text-sm text-muted">${config.footer_estilo2_texto_simples || ''}</p>
          </div>
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Links úteis</h3>
            ${renderLinksUteis()}
          </div>
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Redes sociais</h3>
            ${renderRedesSociais()}
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted pt-4 border-t border-border">
          <p>© ${anoAtual} ${nomeSistema}. Todos os direitos reservados.</p>
          <p class="sm:text-right">Desenvolvido por vcapelli</p>
        </div>
      </footer>
    `;
    return;
  }

  // Estilo 1 (padrão)
  raiz.innerHTML = `
    <footer class="mt-12 bg-basebg border-t border-border pt-8 pb-6 space-y-6">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div class="flex items-center gap-2.5">
          <div class="h-9 w-9 rounded-lg bg-accent/25 flex items-center justify-center text-accent font-black text-sm overflow-hidden shrink-0">
            ${config.logo_url ? `<img src="${config.logo_url}" class="w-full h-full object-contain" alt="Logo">` : nomeSistema.slice(0,3).toUpperCase()}
          </div>
          <span class="font-display font-bold text-sm">${nomeSistema}</span>
        </div>
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Links úteis</h3>
          ${renderLinksUteis()}
        </div>
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Online agora (${usuariosOnline.length})</h3>
          <div class="flex flex-wrap gap-2">
            ${usuariosOnline.length ? usuariosOnline.map(renderAvatarOnline).join('') : '<p class="text-xs text-muted">Ninguém além de você.</p>'}
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-muted pt-4 border-t border-border">
        <p>© ${anoAtual} ${nomeSistema}. Todos os direitos reservados.</p>
        <p class="sm:text-center">v${config.versao_sistema || '1.0.0'}</p>
        <p class="sm:text-right">Desenvolvido por vcapelli</p>
      </div>

      ${config.footer_frase_html ? `<div class="text-xs text-muted text-center pt-4 border-t border-border">${config.footer_frase_html}</div>` : ''}
    </footer>
  `;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', montarFooter);
} else {
  montarFooter();
}
