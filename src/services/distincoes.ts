// Service compartilhado por Emblemas e Honrarias — são estruturalmente
// idênticos (catálogo + concessão individual ou em grupo), então em
// vez de duplicar a lógica duas vezes, parametrizo pelo tipo.

export type TipoDistincao = 'emblemas' | 'honrarias'

interface TabelasDistincao {
  catalogo: string
  concessao: string
  colunaId: string
}

// Nomes de tabela vêm só daqui (nunca de input do usuário) — seguro
// interpolar direto na query.
const TABELAS: Record<TipoDistincao, TabelasDistincao> = {
  emblemas: { catalogo: 'emblemas', concessao: 'usuario_emblemas', colunaId: 'emblema_id' },
  honrarias: { catalogo: 'honrarias', concessao: 'usuario_honrarias', colunaId: 'honraria_id' },
}

export function tabelasDe(tipo: TipoDistincao): TabelasDistincao {
  return TABELAS[tipo]
}

export type AlvoConcessao = { usuarioId: number } | { grupoId: number }

/**
 * Concede a distinção a 1 usuário, ou a todos os membros ATIVOS de um
 * grupo (explode em N linhas individuais — origem_grupo_id fica só
 * pra rastreabilidade, não afeta quem já recebeu se sair do grupo
 * depois). `INSERT OR IGNORE` respeita o UNIQUE(distincao_id, usuario_id)
 * — reconceder pra quem já tem não duplica nem dá erro.
 */
export async function conceder(
  db: D1Database,
  tipo: TipoDistincao,
  distincaoId: number,
  alvo: AlvoConcessao,
  concedidoPorId: number,
  motivo?: string
): Promise<number[]> {
  const t = tabelasDe(tipo)
  let usuarioIds: number[]
  let origemGrupoId: number | null = null

  if ('usuarioId' in alvo) {
    usuarioIds = [alvo.usuarioId]
  } else {
    origemGrupoId = alvo.grupoId
    const { results } = await db
      .prepare(`SELECT usuario_id FROM usuario_grupos WHERE grupo_id = ? AND ativo = 1`)
      .bind(alvo.grupoId)
      .all<{ usuario_id: number }>()
    usuarioIds = results.map((r) => r.usuario_id)
  }

  for (const usuarioId of usuarioIds) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO ${t.concessao} (${t.colunaId}, usuario_id, concedido_por_id, motivo, origem_grupo_id)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(distincaoId, usuarioId, concedidoPorId, motivo ?? null, origemGrupoId)
      .run()
  }

  return usuarioIds
}
