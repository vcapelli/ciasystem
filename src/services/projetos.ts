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

// Cargo mínimo (grupo_niveis.id) da hierarquia interna do grupo que
// pode votar, ou null se não foi restringido (admin > Permissões >
// "Cargo mínimo que vota" — padrão: qualquer membro ativo vota).
export async function buscarNivelMinimoVotantesProjetos(db: D1Like): Promise<number | null> {
  const config = await db.prepare(`SELECT valor FROM configuracoes_sistema WHERE chave = 'projetos_nivel_minimo_votante_id'`)
    .first<{ valor: string | null }>()
  const id = config?.valor ? Number(config.valor) : null
  return id && !Number.isNaN(id) ? id : null
}

// Quem pode votar: membro ativo do grupo responsável e, se houver um
// cargo mínimo configurado, só quem estiver nesse cargo ou acima na
// hierarquia interna do grupo (mesma lógica de nivel_minimo_id já
// usada nas aulas de grupo — compara pela `ordem`). Isso é só pra
// votação: não afeta quem pode ser responsável, nem o parecer dele,
// que sempre conta como voto independente do cargo (decisão original
// do módulo).
export async function podeVotarProjetos(db: D1Like, usuarioId: number, grupoId: number): Promise<boolean> {
  const membro = await db.prepare(
    `SELECT gn.ordem FROM usuario_grupos ug JOIN grupo_niveis gn ON gn.id = ug.nivel_id
     WHERE ug.usuario_id = ? AND ug.grupo_id = ? AND ug.ativo = 1`
  ).bind(usuarioId, grupoId).first<{ ordem: number }>()
  if (!membro) return false

  const nivelMinimoId = await buscarNivelMinimoVotantesProjetos(db)
  if (!nivelMinimoId) return true

  const minimo = await db.prepare(`SELECT ordem FROM grupo_niveis WHERE id = ?`).bind(nivelMinimoId).first<{ ordem: number }>()
  if (!minimo) return true // config aponta pra um cargo que não existe mais — não trava ninguém

  return membro.ordem >= minimo.ordem
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
