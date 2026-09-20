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
