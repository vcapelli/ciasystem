// Módulo compartilhado das 7 páginas de /listagens/*.html — cada
// página só passa o tipo (bate com a chave usada no backend) e o título.

function formatarDataListagem(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${String(d.getDate()).padStart(2,'0')} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

const BADGE_STATUS_LISTAGEM = {
  ativo: 'bg-green-500/15 text-green-600',
  licenca: 'bg-accent/15 text-accent',
  reformado: 'bg-white/10 text-muted',
  desligado_honroso: 'bg-white/10 text-muted',
  desligado_desonroso: 'bg-red-500/15 text-red-600',
  exonerado: 'bg-red-500/15 text-red-600',
};

async function montarListagem(tipo) {
  const raiz = document.getElementById('listagem-raiz');
  raiz.innerHTML = '<p class="text-sm text-muted">Carregando…</p>';

  const resp = await apiFetch(`/listagens/${tipo}`);
  if (!resp.ok) {
    raiz.innerHTML = '<p class="text-sm text-red-400">Não foi possível carregar essa listagem.</p>';
    return;
  }
  const itens = await resp.json();

  raiz.innerHTML = `
    <input id="filtro-nick" type="text" placeholder="Buscar por nick…"
      class="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-dark placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-accent mb-4">
    <p class="text-xs text-muted mb-2">${itens.length} registro${itens.length === 1 ? '' : 's'}</p>
    <div id="lista-itens" class="bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden shadow-sm"></div>
  `;

  function renderLista(filtrados) {
    const container = document.getElementById('lista-itens');
    container.innerHTML = filtrados.length
      ? filtrados.map((u) => `
          <a href="/perfil/${u.nick}" class="flex items-center justify-between px-4 py-3 hover:bg-basebg transition-colors">
            <div>
              <p class="text-sm font-semibold">${u.nick}${u.tag ? ` <span class="text-muted font-normal">[${u.tag}]</span>` : ''}</p>
              <p class="text-xs text-muted mt-0.5">${u.patente_nome || '—'} · atualizado em ${formatarDataListagem(u.data_ultimo_ato_funcional)}</p>
            </div>
            <span class="text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${BADGE_STATUS_LISTAGEM[u.status] || 'bg-white/10'}">${(u.status || '').replace(/_/g, ' ')}</span>
          </a>
        `).join('')
      : '<p class="text-sm text-muted p-4">Nenhum registro encontrado.</p>';
  }

  renderLista(itens);

  document.getElementById('filtro-nick').addEventListener('input', (e) => {
    const termo = e.target.value.trim().toLowerCase();
    renderLista(termo ? itens.filter((u) => u.nick.toLowerCase().includes(termo)) : itens);
  });
}
