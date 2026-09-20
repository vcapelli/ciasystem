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
