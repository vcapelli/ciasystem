// Resolve, na hora, quem se qualifica pra receber uma distinção em
// massa (emblema, honraria ou conquista) — sem rastreamento contínuo,
// é um retrato de quem se encaixa no critério NESTE momento.

export type CriterioDistribuicao = 'grupo' | 'dias_na_policia' | 'curso_concluido' | 'todos_atuais' | 'manual'

export async function resolverUsuariosParaDistribuicao(
  db: D1Database,
  criterio: CriterioDistribuicao,
  params: { grupo_id?: number; dias?: number; aula_id?: number; usuario_ids?: number[] }
): Promise<number[]> {
  if (criterio === 'manual') {
    return params.usuario_ids ?? []
  }

  if (criterio === 'grupo') {
    if (!params.grupo_id) return []
    const { results } = await db.prepare(
      `SELECT usuario_id FROM usuario_grupos WHERE grupo_id = ? AND ativo = 1`
    ).bind(params.grupo_id).all<{ usuario_id: number }>()
    return results.map((r) => r.usuario_id)
  }

  if (criterio === 'curso_concluido') {
    if (!params.aula_id) return []
    const { results } = await db.prepare(
      `SELECT DISTINCT ra.usuario_id
       FROM grupo_aula_relatorio_alunos ra
       JOIN grupo_aula_relatorios r ON r.id = ra.relatorio_id
       WHERE r.aula_id = ? AND r.aprovado = 1`
    ).bind(params.aula_id).all<{ usuario_id: number }>()
    return results.map((r) => r.usuario_id)
  }

  if (criterio === 'dias_na_policia') {
    if (!params.dias) return []
    const { results } = await db.prepare(
      `SELECT ra.usuario_id AS usuario_id FROM (
         SELECT alvo.usuario_id,
           -- Integração carrega a data histórica real de ingresso em
           -- dados_especificos.data (ver src/services/efeitos.ts) —
           -- usa ela em vez de criado_em, que só reflete quando a
           -- migração foi feita. Os outros dois tipos não têm esse
           -- campo, então caem em criado_em normalmente.
           MIN(COALESCE(json_extract(r.dados_especificos, '$.data'), r.criado_em)) AS data_ingresso
         FROM requerimento_alvos alvo
         JOIN requerimentos r ON r.id = alvo.requerimento_id
         WHERE r.tipo IN ('instrucao_inicial', 'contratacao', 'integracao') AND alvo.status = 'aprovado'
         GROUP BY alvo.usuario_id
       ) ra
       WHERE (julianday('now') - julianday(ra.data_ingresso)) >= ?`
    ).bind(params.dias).all<{ usuario_id: number }>()
    return results.map((r) => r.usuario_id)
  }

  if (criterio === 'todos_atuais') {
    // Todo mundo com conta agora, exceto exonerado e desligado
    // desonroso — é um retrato do momento: quem criar conta amanhã
    // não recebe retroativamente.
    const { results } = await db.prepare(
      `SELECT id AS usuario_id FROM usuarios WHERE status NOT IN ('exonerado', 'desligado_desonroso')`
    ).all<{ usuario_id: number }>()
    return results.map((r) => r.usuario_id)
  }

  return []
}
