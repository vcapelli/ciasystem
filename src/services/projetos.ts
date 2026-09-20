// Helpers de permissão/visibilidade do módulo de Projetos/Propostas —
// reaproveita ehAdminDoGrupo() (mesma flag de administrador de grupo já
// usada por registros/aulas/hub) e um único grupo global responsável,
// guardado em configuracoes_sistema (chave 'projetos_grupo_responsavel_id').

import { ehAdminDoGrupo } from './grupos'
import type { D1Like } from '../types/db'

export async function ehAdmin(db: D1Like, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// Retorna o id do grupo responsável configurado, ou null se ainda não
// foi definido (admin > Permissões > "Grupo responsável pelos projetos").
export async function buscarGrupoResponsavelProjetos(db: D1Like): Promise<number | null> {
  const config = await db.prepare(`SELECT valor FROM configuracoes_sistema WHERE chave = 'projetos_grupo_responsavel_id'`)
    .first<{ valor: string | null }>()
  const id = config?.valor ? Number(config.valor) : null
  return id && !Number.isNaN(id) ? id : null
}

export async function ehMembroAtivoDoGrupo(db: D1Like, usuarioId: number, grupoId: number): Promise<boolean> {
  const membro = await db.prepare(
    `SELECT 1 FROM usuario_grupos WHERE usuario_id = ? AND grupo_id = ? AND ativo = 1`
  ).bind(usuarioId, grupoId).first()
  return membro !== null
}

// Cargos (lista de grupo_niveis.id, guardada como JSON) da hierarquia
// interna do grupo que podem votar, ou null se não foi restringido
// (admin > Permissões > "Cargos que votam" — padrão: qualquer membro
// ativo vota). É uma lista EXATA, não um mínimo — dá pra deixar, por
// exemplo, só "Membro" marcado e nem Vice-Líder nem Líder votam, mesmo
// sendo hierarquicamente superiores.
export async function buscarNiveisVotantesProjetos(db: D1Like): Promise<number[] | null> {
  const config = await db.prepare(`SELECT valor FROM configuracoes_sistema WHERE chave = 'projetos_niveis_votantes_ids'`)
    .first<{ valor: string | null }>()
  if (!config?.valor) return null
  try {
    const ids = JSON.parse(config.valor)
    if (!Array.isArray(ids)) return null
    const validos = ids.map(Number).filter((n) => !Number.isNaN(n))
    return validos.length ? validos : null
  } catch {
    return null
  }
}

// Quem pode votar: membro ativo do grupo responsável e, se houver uma
// lista de cargos votantes configurada, só quem estiver EXATAMENTE em
// algum desses cargos. Isso é só pra votação: não afeta quem pode ser
// responsável, nem o parecer dele, que sempre conta como voto
// independente do cargo (decisão original do módulo).
export async function podeVotarProjetos(db: D1Like, usuarioId: number, grupoId: number): Promise<boolean> {
  const membro = await db.prepare(
    `SELECT nivel_id FROM usuario_grupos WHERE usuario_id = ? AND grupo_id = ? AND ativo = 1`
  ).bind(usuarioId, grupoId).first<{ nivel_id: number }>()
  if (!membro) return false

  const niveisVotantes = await buscarNiveisVotantesProjetos(db)
  if (!niveisVotantes) return true // sem restrição — qualquer membro ativo vota

  return niveisVotantes.includes(membro.nivel_id)
}

// Quantos membros do grupo têm direito de voto agora — todos os
// membros ativos, ou só quem estiver num dos cargos votantes
// configurados (ver buscarNiveisVotantesProjetos). Usado pra saber
// quando TODOS já votaram e a votação pode fechar sozinha.
export async function contarVotantesElegiveisProjetos(db: D1Like, grupoId: number): Promise<number> {
  const niveisVotantes = await buscarNiveisVotantesProjetos(db)
  if (!niveisVotantes) {
    const r = await db.prepare(`SELECT COUNT(*) AS total FROM usuario_grupos WHERE grupo_id = ? AND ativo = 1`)
      .bind(grupoId).first<{ total: number }>()
    return r?.total || 0
  }
  const placeholders = niveisVotantes.map(() => '?').join(',')
  const r = await db.prepare(
    `SELECT COUNT(*) AS total FROM usuario_grupos WHERE grupo_id = ? AND ativo = 1 AND nivel_id IN (${placeholders})`
  ).bind(grupoId, ...niveisVotantes).first<{ total: number }>()
  return r?.total || 0
}

// Quantos votos já registrados nesse processo vieram de gente
// elegível pra votar (ignora um voto "órfão" de alguém que saiu do
// grupo ou mudou de cargo depois de votar) — comparado com
// contarVotantesElegiveisProjetos() pra decidir o fechamento automático.
export async function contarVotosElegiveisProjeto(db: D1Like, projetoId: number, grupoId: number): Promise<number> {
  const niveisVotantes = await buscarNiveisVotantesProjetos(db)
  const filtroNivel = niveisVotantes ? `AND ug.nivel_id IN (${niveisVotantes.map(() => '?').join(',')})` : ''
  const params = niveisVotantes ? [grupoId, ...niveisVotantes, projetoId] : [grupoId, projetoId]
  const r = await db.prepare(
    `SELECT COUNT(*) AS total FROM projeto_votos pv
     JOIN usuario_grupos ug ON ug.usuario_id = pv.usuario_id AND ug.grupo_id = ? AND ug.ativo = 1 ${filtroNivel}
     WHERE pv.projeto_id = ?`
  ).bind(...params).first<{ total: number }>()
  return r?.total || 0
}

export type ResultadoFechamentoVotacao =
  | { status: 'fechado'; resultado: 'aprovado' | 'reprovado'; aprova: number; reprova: number }
  | { status: 'sem_votos' }
  | { status: 'empate' }

// Aplica o fechamento da votação (usado tanto pelo encerramento manual
// quanto pelo automático, quando todos os votantes elegíveis já
// votaram) — resolve aprovado/reprovado por maioria simples dos votos
// registrados, arquiva ou libera implementação. encerradoPorId null =
// fechamento automático do sistema (fica registrado como tal no
// histórico, já que votacao_encerrada_por_id aceita NULL).
export async function fecharVotacaoProjeto(
  db: D1Like,
  projetoId: number,
  encerradoPorId: number | null
): Promise<ResultadoFechamentoVotacao> {
  const contagem = await db.prepare(
    `SELECT
       SUM(CASE WHEN voto = 'aprova' THEN 1 ELSE 0 END) AS aprova,
       SUM(CASE WHEN voto = 'reprova' THEN 1 ELSE 0 END) AS reprova
     FROM projeto_votos WHERE projeto_id = ?`
  ).bind(projetoId).first<{ aprova: number | null; reprova: number | null }>()
  const aprova = contagem?.aprova || 0
  const reprova = contagem?.reprova || 0

  if (aprova === 0 && reprova === 0) return { status: 'sem_votos' }
  if (aprova === reprova) return { status: 'empate' }

  const resultado = aprova > reprova ? 'aprovado' : 'reprovado'
  const novoStatus = resultado === 'aprovado' ? 'aguardando_implementacao' : 'arquivado'

  await db.prepare(
    `UPDATE projetos SET
       votacao_encerrada_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'), votacao_encerrada_por_id = ?,
       votacao_resultado = ?, status = ?,
       arquivado_em = CASE WHEN ? = 'arquivado' THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') ELSE arquivado_em END,
       motivo_arquivamento = CASE WHEN ? = 'arquivado' THEN ? ELSE motivo_arquivamento END,
       atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ?`
  ).bind(
    encerradoPorId, resultado, novoStatus, novoStatus, novoStatus,
    `Reprovado em votação (${aprova} aprova / ${reprova} reprova)`, projetoId
  ).run()

  return { status: 'fechado', resultado, aprova, reprova }
}

// Quem pode ver a lista/detalhe de processos: administrador do sistema,
// ou membro ATIVO do grupo responsável configurado (mesmo o autor do
// processo, se não for membro do grupo, não vê — decisão explícita).
export async function podeVerProjetos(db: D1Like, usuarioId: number): Promise<boolean> {
  if (await ehAdmin(db, usuarioId)) return true
  const grupoId = await buscarGrupoResponsavelProjetos(db)
  if (!grupoId) return false
  return ehMembroAtivoDoGrupo(db, usuarioId, grupoId)
}

// Quem pode agir como "administrador do grupo responsável": definir/
// trocar responsável, encerrar votação, arquivar/desarquivar.
export async function ehAdminDoGrupoResponsavel(db: D1Like, usuarioId: number): Promise<boolean> {
  if (await ehAdmin(db, usuarioId)) return true
  const grupoId = await buscarGrupoResponsavelProjetos(db)
  if (!grupoId) return false
  return ehAdminDoGrupo(db, usuarioId, grupoId)
}

// Registra uma linha na timeline pública do processo (mesmo padrão de
// documento_revisao_historico). criadoPorId null = evento automático do
// sistema (ex: arquivamento por reprovação na votação).
export async function registrarHistoricoProjeto(
  db: D1Like,
  projetoId: number,
  descricao: string,
  criadoPorId: number | null
): Promise<void> {
  await db.prepare(
    `INSERT INTO projeto_historico (projeto_id, descricao, criado_por_id) VALUES (?, ?, ?)`
  ).bind(projetoId, descricao, criadoPorId).run()
}
