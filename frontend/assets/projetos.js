// Helpers compartilhados pelas páginas do módulo de Projetos/Propostas
// (/projetos.html e /projeto-detalhe.html, servida em /projetos/:id).

const TIPOS_PROJETO = {
  projeto: 'Projeto', proposta: 'Proposta', correcao: 'Correção', sugestao: 'Sugestão',
};

const STATUS_PROJETO = {
  aberto: { label: 'Aberto', badge: 'bg-gray-500/15 text-gray-600' },
  em_analise: { label: 'Em análise', badge: 'bg-blue-500/15 text-blue-600' },
  em_votacao: { label: 'Em votação', badge: 'bg-purple-500/15 text-purple-600' },
  aguardando_implementacao: { label: 'Aguardando implementação', badge: 'bg-amber-500/15 text-amber-600' },
  concluido: { label: 'Concluído', badge: 'bg-green-500/15 text-green-600' },
  arquivado: { label: 'Arquivado', badge: 'bg-red-500/15 text-red-600' },
};

function escapeHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

function formatarDataProjeto(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR');
}

function badgeStatusProjeto(status) {
  const s = STATUS_PROJETO[status] || { label: status, badge: 'bg-gray-500/15 text-gray-600' };
  return `<span class="text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${s.badge}">${s.label}</span>`;
}

function badgeTipoProjeto(tipo) {
  return `<span class="text-xs font-medium px-2 py-0.5 rounded-full bg-basebg border border-border text-muted whitespace-nowrap">${TIPOS_PROJETO[tipo] || tipo}</span>`;
}

// Busca o grupo responsável pelos projetos configurado no admin (aba
// Permissões) — devolve { id, nome, slug, ... } ou null se ainda não
// foi configurado. Usado pra montar o seletor de responsável e pra
// decidir se as ações de administrador do grupo aparecem na tela.
async function buscarGrupoResponsavelProjetos() {
  const [config, gruposResp] = await Promise.all([buscarConfiguracoes(), apiFetch('/grupos')]);
  const grupoId = config.projetos_grupo_responsavel_id ? Number(config.projetos_grupo_responsavel_id) : null;
  if (!grupoId) return null;
  const grupos = gruposResp.ok ? await gruposResp.json() : [];
  return grupos.find((g) => g.id === grupoId) || null;
}

// Se o usuário autenticado é administrador do grupo responsável (ou
// do sistema) — decide quem vê os botões de gestão (definir
// responsável, encerrar votação, arquivar/desarquivar).
async function souAdminDoGrupoResponsavel(grupoResponsavelId) {
  if (!grupoResponsavelId) return false;
  const resp = await apiFetch('/grupos/onde-sou-admin');
  const grupos = resp.ok ? await resp.json() : [];
  return grupos.some((g) => g.id === grupoResponsavelId);
}

// Membros ativos do grupo responsável (pra montar o seletor de
// responsável e checar quem pode votar).
async function buscarMembrosGrupoResponsavel(grupoSlug) {
  const resp = await apiFetch(`/grupos/${grupoSlug}/membros`);
  return resp.ok ? await resp.json() : [];
}

// Busca a figure (avatar Habblet) de um nick — mesmo padrão usado nas
// páginas de documentos (documento-dashboard.html).
async function buscarFigureProjeto(nick) {
  if (!nick) return null;
  try {
    const r = await apiFetch(`/usuarios/nick/${encodeURIComponent(nick)}`);
    return r.ok ? (await r.json()).figure : null;
  } catch { return null; }
}

// Avatar circular (mesmo recorte de cabeça usado no rodapé de
// assinaturas de documentos, modo 'mini' com -mt-3 e o "salto" no
// hover) ao lado de um bloco de texto: "Label: nick" (só o "Label:" em
// semibold, o nick em peso normal) e, embaixo, uma linha extra opcional
// (ex: "Definido em ..."). Usado pro autor e responsável do processo.
function avatarComLabelHtml(label, nick, figure, linhaExtra) {
  const inicial = (nick || '?').slice(0, 2).toUpperCase();
  return `
    <div class="flex items-center gap-3">
      <div class="text-center shrink-0">
        <span class="h-12 w-12 mx-auto rounded-full bg-basebg border border-border overflow-hidden inline-block">
          ${figure
            ? `<img src="${avatarUrl(figure, 'mini', '2')}" class="w-full h-[190%] object-cover object-top -mt-3 transition-transform duration-300 hover:-translate-y-[10px]" alt="">`
            : `<span class="w-full h-full flex items-center justify-center text-xs font-bold">${inicial}</span>`}
        </span>
      </div>
      <div>
        <p class="text-xs mt-1"><span class="font-semibold">${label}:</span> ${nick || '—'}</p>
        ${linhaExtra ? `<p class="text-xs text-muted">${linhaExtra}</p>` : ''}
      </div>
    </div>
  `;
}

// Avatarzinho circular + nick, lado a lado — usado na lista de votos e
// na lista de processos, onde o espaço é mais compacto (inline em vez
// de empilhado). Sem tag: aqui mostramos só o nick da pessoa.
function avatarNickHtml(nick, figure, opts = {}) {
  const size = opts.size || 6;
  const nickClass = opts.bold ? 'font-semibold' : '';
  const inicial = (nick || '?').slice(0, 2).toUpperCase();
  return `<span class="inline-flex items-center gap-1.5 align-middle">
    <span class="h-${size} w-${size} rounded-full bg-basebg border border-border overflow-hidden inline-block align-middle shrink-0">
      ${figure
        ? `<img src="${avatarUrl(figure, 'mini', '2')}" class="w-full h-[190%] object-cover object-top -mt-1" alt="">`
        : `<span class="w-full h-full flex items-center justify-center text-[0.55rem] font-bold">${inicial}</span>`}
    </span>
    <span class="${nickClass}">${nick || '—'}</span>
  </span>`;
}
