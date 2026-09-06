// Controle de acesso do fórum por categoria. Uma categoria pode ter
// 0 ou mais regras em `forum_permissoes`; cada regra combina (com
// AND) as condições que tiver preenchidas (grupo e/ou patente
// mínima) — a categoria libera a ação se QUALQUER regra aplicável
// for satisfeita (OR entre regras). Sem nenhuma regra configurada,
// a categoria fica aberta pra ler/postar (mas não pra moderar).

export type AcaoForum = 'ler' | 'postar' | 'moderar'

export async function podeNaCategoria(
  db: D1Database,
  usuarioId: number,
  categoriaId: number,
  acao: AcaoForum
): Promise<boolean> {
  const coluna = acao === 'ler' ? 'pode_ler' : acao === 'postar' ? 'pode_postar' : 'pode_moderar'

  const { results } = await db
    .prepare(`SELECT grupo_id, patente_minima_id, ${coluna} AS permitido FROM forum_permissoes WHERE categoria_id = ?`)
    .bind(categoriaId)
    .all<{ grupo_id: number | null; patente_minima_id: number | null; permitido: number }>()

  if (results.length === 0) return acao !== 'moderar'

  const usuario = await db
    .prepare(`SELECT patente_atual_id FROM usuarios WHERE id = ?`)
    .bind(usuarioId)
    .first<{ patente_atual_id: number | null }>()

  for (const regra of results) {
    if (!regra.permitido) continue

    let satisfazGrupo = true
    if (regra.grupo_id !== null) {
      const membro = await db
        .prepare(`SELECT 1 FROM usuario_grupos WHERE usuario_id = ? AND grupo_id = ? AND ativo = 1`)
        .bind(usuarioId, regra.grupo_id)
        .first()
      satisfazGrupo = membro !== null
    }

    let satisfazPatente = true
    if (regra.patente_minima_id !== null) {
      if (!usuario?.patente_atual_id) {
        satisfazPatente = false
      } else {
        const cmp = await db
          .prepare(
            `SELECT (p_alvo.ordem >= p_min.ordem AND p_alvo.corpo = p_min.corpo) AS ok
             FROM patentes p_alvo, patentes p_min
             WHERE p_alvo.id = ? AND p_min.id = ?`
          )
          .bind(usuario.patente_atual_id, regra.patente_minima_id)
          .first<{ ok: number }>()
        satisfazPatente = Boolean(cmp?.ok)
      }
    }

    if (satisfazGrupo && satisfazPatente) return true
  }

  return false
}
