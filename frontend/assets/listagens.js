// Módulo compartilhado das páginas de /listagens/*.html — o backend
// já devolve tudo agrupado (patentes vazias inclusas, ou os grupos
// fixos de status); esse módulo só desenha.

const ICONE_PATENTE = {
  'Comandante-Geral': 'fa-solid fa-crown', 'Comandante': 'fa-solid fa-shield-halved',
  'Marechal': 'fa-solid fa-medal', 'General': 'fa-solid fa-star',
  'Coronel': 'fa-solid fa-star', 'Capitão': 'fa-solid fa-chevron-up',
  'Tenente': 'fa-solid fa-chevron-up', 'Aspirante a Oficial': 'fa-solid fa-graduation-cap',
  'Aluno': 'fa-solid fa-book', 'Subtenente': 'fa-solid fa-shield',
  '1º Sargento': 'fa-solid fa-shield', '2º Sargento': 'fa-solid fa-shield',
  '3º Sargento': 'fa-solid fa-shield', 'Cabo': 'fa-solid fa-user',
  'Soldado': 'fa-solid fa-user',
  'Chanceler': 'fa-solid fa-crown', 'Presidente': 'fa-solid fa-shield-halved',
  'Acionista Majoritário': 'fa-solid fa-shield-halved', 'VIP': 'fa-solid fa-medal',
  'Vice-Presidente': 'fa-solid fa-medal', 'Superintendente': 'fa-solid fa-star',
  'Superintendente-Geral': 'fa-solid fa-star', 'Coordenador': 'fa-solid fa-chevron-up',
  'Coordenador-Geral': 'fa-solid fa-chevron-up', 'Inspetor': 'fa-solid fa-user-shield',
  'Inspetor-Geral': 'fa-solid fa-user-shield', 'Supervisor': 'fa-solid fa-user',
  'Supervisor-Geral': 'fa-solid fa-user',
  'Exoneração Temporária': 'fa-solid fa-hourglass-half', 'Exoneração Permanente': 'fa-solid fa-ban',
  'Desligamento Honroso': 'fa-solid fa-door-open', 'Desligamento Desonroso': 'fa-solid fa-door-closed',
  'Sem patente/cargo': 'fa-solid fa-question',
};

const COR_GRUPO = {
  dourado: '#eaa506',
  escuro: '#212529',
  amarelo: '#eab308',
  vermelho: '#ef4444',
  verde: '#22c55e',
};

// Se a abreviação do cargo estiver vazia, o próprio código do grupo
// já identifica (ex: cargo "Instrutor" sem abreviação no grupo
// Instrutores (INS) vira só "INS", não "algo.INS").
function computarAbreviacaoGrupo(g) {
  return g.nivel_abreviacao ? `${g.nivel_abreviacao}.${g.codigo}` : g.codigo;
}

function renderLinhaMembro(u, formatoExoneracao, tipo) {
  let identificacao;
  if (formatoExoneracao) {
    identificacao = `${u.nick} [${u.tag || '---'}] [${u.ultimo_autor_tag || '---'}] {${u.crime_nome || ''}} - ${formatarDataCurtaReq(u.ultimo_requerimento_em)} até ${u.exoneracao_ate ? formatarDataCurtaReq(u.exoneracao_ate) : 'Indeterminado'}`;
  } else {
    identificacao = u.ultimo_requerimento_em
      ? `${u.nick} [${(PREFIXO_IDENTIFICACAO_REQ[u.ultimo_tipo] ?? '')}${u.ultimo_autor_tag || u.tag || '---'}] ${formatarDataCurtaReq(u.ultimo_requerimento_em)}${u.apendiceAdvertencias || ''}`
      : `${u.nick}${u.tag ? ` [${u.tag}]` : ' [---]'}`;
  }

  const mostrarGrupos = (tipo === 'corpo-de-oficiais' || tipo === 'corpo-executivo') && u.grupos?.length;
  if (mostrarGrupos) {
    identificacao += ` - ${u.grupos.map(computarAbreviacaoGrupo).join('/')}`;
  }

  return `
    <div class="flex items-center gap-3 px-4 py-3">
      <span class="h-11 w-11 rounded-full bg-basebg border border-border overflow-hidden inline-block shrink-0">
        ${u.figure ? `<img src="${avatarUrl(u.figure, 'mini', '2')}" class="w-full h-[190%] object-cover object-top -mt-3" alt="">` : `<span class="w-full h-full flex items-center justify-center text-sm font-bold">${u.nick.slice(0,2).toUpperCase()}</span>`}
      </span>
      <span class="text-base">${identificacao}</span>
    </div>
  `;
}

function renderGrupo(g, formatoExoneracao, tipo) {
  const icone = ICONE_PATENTE[g.titulo] || 'fa-solid fa-users';
  const cor = g.cor && g.cor.startsWith('#') ? g.cor : (COR_GRUPO[g.cor] || COR_GRUPO.escuro);
  return `
    <div class="bg-card border border-border rounded-2xl shadow-sm overflow-hidden" style="border-left: 4px solid ${cor}">
      <div class="flex items-center gap-3 px-4 py-3 bg-basebg border-b border-border">
        <span class="h-8 w-8 rounded-lg bg-border/60 flex items-center justify-center text-sm">
          <i class="${icone}"></i>
        </span>
        <p class="text-sm font-bold uppercase tracking-wide">${g.titulo}</p>
        <span class="text-xs text-muted ml-auto">${g.itens.length}</span>
      </div>
      <div class="divide-y divide-border">
        ${g.itens.length
          ? g.itens.map((u) => renderLinhaMembro(u, formatoExoneracao, tipo)).join('')
          : '<p class="text-sm text-muted px-4 py-3">Ninguém nessa patente/cargo no momento.</p>'}
      </div>
    </div>
  `;
}

async function montarListagem(tipo) {
  const raiz = document.getElementById('listagem-raiz');
  raiz.innerHTML = '<p class="text-sm text-muted">Carregando…</p>';

  const resp = await apiFetch(`/listagens/${tipo}`);
  if (!resp.ok) {
    raiz.innerHTML = '<p class="text-sm text-red-400">Não foi possível carregar essa listagem.</p>';
    return;
  }
  const dados = await resp.json();

  if (dados.tipoVisual === 'flat') {
    // TAGs: lista única, nick + TAG + avatar.
    await Promise.all(
      dados.itens.map(async (u) => {
        const r = await apiFetch(`/usuarios/nick/${encodeURIComponent(u.nick)}`);
        u.figure = r.ok ? (await r.json()).figure : null;
      })
    );
    raiz.innerHTML = `
      <div class="bg-card border border-border rounded-2xl shadow-sm divide-y divide-border overflow-hidden">
        ${dados.itens.length
          ? dados.itens.map((u) => `
              <div class="flex items-center gap-3 px-4 py-3 text-base">
                <span class="h-11 w-11 rounded-full bg-basebg border border-border overflow-hidden inline-block shrink-0">
                  ${u.figure ? `<img src="${avatarUrl(u.figure, 'mini', '2')}" class="w-full h-[190%] object-cover object-top -mt-3" alt="">` : `<span class="w-full h-full flex items-center justify-center text-sm font-bold">${u.nick.slice(0,2).toUpperCase()}</span>`}
                </span>
                <span>${u.nick} <span class="text-muted">[${u.tag}]</span></span>
              </div>
            `).join('')
          : '<p class="text-sm text-muted p-4">Nenhum registro encontrado.</p>'}
      </div>
    `;
    return;
  }

  // Agrupado (patente ou status) — busca a figure de cada membro em
  // paralelo antes de desenhar (dá pra ter bastante gente aqui, mas é
  // uma tela só carregada sob demanda, então tudo bem). Nas listagens
  // de oficiais e executivo, busca também os grupos de cada um, pra
  // mostrar a abreviação do cargo interno ao lado da identificação.
  // Também busca advertências ativas, pra montar o apêndice
  // "{1 ADV: ... até ...}" — não se aplica ao formato de exoneração,
  // que já tem seu próprio bracket.
  const todosMembros = dados.grupos.flatMap((g) => g.itens);
  const buscarGrupos = tipo === 'corpo-de-oficiais' || tipo === 'corpo-executivo';
  await Promise.all(
    todosMembros.map(async (u) => {
      const r = await apiFetch(`/usuarios/nick/${encodeURIComponent(u.nick)}`);
      u.figure = r.ok ? (await r.json()).figure : null;
      if (buscarGrupos && u.id) {
        const rg = await apiFetch(`/grupos/usuario/${u.id}`);
        u.grupos = rg.ok ? await rg.json() : [];
      }
      if (!dados.formatoExoneracao && u.id) {
        u.apendiceAdvertencias = await buscarApendiceAdvertencias(u.id);
      }
    })
  );

  raiz.innerHTML = `<div class="space-y-5">${dados.grupos.map((g) => renderGrupo(g, dados.formatoExoneracao, tipo)).join('')}</div>`;
}
