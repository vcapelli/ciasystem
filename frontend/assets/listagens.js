// Módulo compartilhado das 7 páginas de /listagens/*.html — cada
// página só passa o tipo (bate com a chave usada no backend).

function formatarDataListagem(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${String(d.getDate()).padStart(2,'0')} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

const ICONE_PATENTE = {
  'Comandante-Geral': 'fa-solid fa-crown', 'Comandante': 'fa-solid fa-shield-halved',
  'Marechal': 'fa-solid fa-medal', 'General': 'fa-solid fa-star',
  'Coronel': 'fa-solid fa-star', 'Capitão': 'fa-solid fa-chevron-up',
  'Tenente': 'fa-solid fa-chevron-up', 'Aspirante a Oficial': 'fa-solid fa-graduation-cap',
  'Aluno': 'fa-solid fa-book', 'Subtenente': 'fa-solid fa-shield',
  '1º Sargento': 'fa-solid fa-shield', '2º Sargento': 'fa-solid fa-shield',
  '3º Sargento': 'fa-solid fa-shield', 'Cabo': 'fa-solid fa-user',
  'Soldado': 'fa-solid fa-user',
  // Corpo Executivo
  'Chanceler': 'fa-solid fa-crown', 'Presidente': 'fa-solid fa-shield-halved',
  'Acionista Majoritário': 'fa-solid fa-shield-halved', 'VIP': 'fa-solid fa-medal',
  'Vice-Presidente': 'fa-solid fa-medal', 'Superintendente': 'fa-solid fa-star',
  'Superintendente-Geral': 'fa-solid fa-star', 'Coordenador': 'fa-solid fa-chevron-up',
  'Coordenador-Geral': 'fa-solid fa-chevron-up', 'Inspetor': 'fa-solid fa-user-shield',
  'Inspetor-Geral': 'fa-solid fa-user-shield', 'Supervisor': 'fa-solid fa-user',
  'Supervisor-Geral': 'fa-solid fa-user',
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

  // Grupo pequeno o bastante (dezenas, não centenas) — busca a figure
  // de cada um em paralelo, igual já fazemos nos membros de um grupo.
  await Promise.all(
    itens.map(async (u) => {
      const r = await apiFetch(`/usuarios/nick/${encodeURIComponent(u.nick)}`);
      u.figure = r.ok ? (await r.json()).figure : null;
    })
  );

  raiz.innerHTML = `
    <input id="filtro-nick" type="text" placeholder="Buscar por nick…"
      class="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-dark placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent mb-5">
    <div id="lista-itens" class="space-y-5"></div>
  `;

  function renderLista(filtrados) {
    const container = document.getElementById('lista-itens');
    if (!filtrados.length) {
      container.innerHTML = '<p class="text-sm text-muted">Nenhum registro encontrado.</p>';
      return;
    }

    // Agrupa mantendo a ordem em que já vieram (o backend já ordena
    // por patente_ordem DESC), então o primeiro grupo que aparece é
    // sempre o de maior patente.
    const grupos = [];
    const indicePorPatente = {};
    for (const u of filtrados) {
      const chave = u.patente_nome || 'Sem patente/cargo';
      if (!(chave in indicePorPatente)) {
        indicePorPatente[chave] = grupos.length;
        grupos.push({ nome: chave, itens: [] });
      }
      grupos[indicePorPatente[chave]].itens.push(u);
    }

    container.innerHTML = grupos.map((g, i) => {
      const icone = ICONE_PATENTE[g.nome] || 'fa-solid fa-user';
      const destaque = i === 0; // maior patente do conjunto atual — barra em destaque
      return `
        <div class="bg-card border border-border rounded-2xl shadow-sm overflow-hidden" style="border-left: 4px solid ${destaque ? '#eaa506' : '#212529'}">
          <div class="flex items-center gap-3 px-4 py-3 bg-basebg border-b border-border">
            <span class="h-8 w-8 rounded-lg bg-border/60 flex items-center justify-center text-sm">
              <i class="${icone}"></i>
            </span>
            <p class="text-sm font-bold uppercase tracking-wide">${g.nome}</p>
          </div>
          <div class="divide-y divide-border">
            ${g.itens.map((u) => {
              const avatar = u.figure ? avatarUrl(u.figure, 'mini', '2') : null;
              return `
                <a href="/perfil/${u.nick}" class="flex items-center gap-3 px-4 py-2.5 hover:bg-basebg transition-colors">
                  <span class="h-8 w-8 rounded-full bg-basebg border border-border overflow-hidden inline-block shrink-0">
                    ${avatar ? `<img src="${avatar}" class="w-full h-[190%] object-cover object-top -mt-2" alt="">` : `<span class="w-full h-full flex items-center justify-center text-[0.65rem] font-bold">${u.nick.slice(0,2).toUpperCase()}</span>`}
                  </span>
                  <span class="text-sm text-muted">▸</span>
                  <span class="text-sm">${u.nick}${u.tag ? ` [${u.tag}]` : ' [---]'} ${formatarDataListagem(u.data_ultimo_ato_funcional)}</span>
                </a>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  renderLista(itens);

  document.getElementById('filtro-nick').addEventListener('input', (e) => {
    const termo = e.target.value.trim().toLowerCase();
    renderLista(termo ? itens.filter((u) => u.nick.toLowerCase().includes(termo)) : itens);
  });
}
