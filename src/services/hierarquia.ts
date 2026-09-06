// Checagem de hierarquia — SEMPRE roda no Worker, nunca confia em dado
// vindo do cliente (ver seção 5 do doc-mestre / Art. 2º da Seção III
// da Constituição Militar).

export type AcaoHierarquia = 'promover' | 'rebaixar' | 'advertir' | 'demitir' | 'exonerar' | 'licenciar'

export interface ResultadoPodeAgir {
  permitido: boolean
  requerCfoOuPro: boolean
}

/**
 * Verifica se `patenteOrigemId` pode executar `acao` sobre alguém com
 * `patenteAlvoId`, consultando `diretrizes_hierarquia`.
 *
 * Uma mesma patente pode ter mais de uma linha pra mesma ação (uma pra
 * teto dentro do próprio corpo, outra pra teto no corpo oposto) — por
 * isso o filtro por `pl.corpo = alvo.corpo` na query, em vez de pegar
 * a primeira linha que aparecer.
 *
 * IMPORTANTE: até a Fase 1b, `diretrizes_hierarquia` só tem linhas
 * seed para 'promover' | 'rebaixar' | 'demitir' — a Constituição não
 * define teto explícito pra 'advertir' | 'exonerar' | 'licenciar'
 * separadamente. Chamar esta função com essas 3 ações vai sempre
 * retornar `permitido: false` até isso ser decidido e populado
 * (perguntar pro Vitor se usam o mesmo teto de promover/rebaixar/demitir
 * ou se têm regra própria antes de habilitar essas ações).
 */
export async function podeAgirSobre(
  db: D1Database,
  acao: AcaoHierarquia,
  patenteOrigemId: number,
  patenteAlvoId: number
): Promise<ResultadoPodeAgir> {
  const alvo = await db
    .prepare(`SELECT ordem, corpo FROM patentes WHERE id = ?`)
    .bind(patenteAlvoId)
    .first<{ ordem: number; corpo: string }>()

  if (!alvo) return { permitido: false, requerCfoOuPro: false }

  const diretriz = await db
    .prepare(
      `SELECT dh.requer_pro_ou_cfo AS requer_pro_ou_cfo, pl.ordem AS ordem_limite
       FROM diretrizes_hierarquia dh
       JOIN patentes pl ON pl.id = dh.patente_limite_id
       WHERE dh.patente_origem_id = ? AND dh.acao = ? AND pl.corpo = ?`
    )
    .bind(patenteOrigemId, acao, alvo.corpo)
    .first<{ requer_pro_ou_cfo: number; ordem_limite: number }>()

  if (!diretriz) return { permitido: false, requerCfoOuPro: false }

  // "até onde pode agir" = qualquer patente com ordem <= ao teto,
  // dentro do mesmo corpo do teto (já filtrado na query acima).
  const permitido = alvo.ordem <= diretriz.ordem_limite

  return { permitido, requerCfoOuPro: Boolean(diretriz.requer_pro_ou_cfo) }
}

/**
 * Verifica se `usuarioId` tem a competência de promotor pro seu corpo
 * (Art. 2º §1º da Seção III da Constituição): PRO concluído (Corpo
 * Militar) ou CFO ativo/não expirado (Corpo Executivo).
 */
export async function possuiCompetenciaDePromotor(
  db: D1Database,
  usuarioId: number,
  corpo: string
): Promise<boolean> {
  if (corpo === 'militar') {
    const row = await db
      .prepare(
        `SELECT 1 FROM historico_cursos hc
         JOIN cursos c ON c.id = hc.curso_id
         WHERE hc.usuario_id = ? AND c.codigo = 'PRO' LIMIT 1`
      )
      .bind(usuarioId)
      .first()
    return row !== null
  }

  const row = await db
    .prepare(
      `SELECT 1 FROM certificados
       WHERE usuario_id = ? AND tipo = 'CFO' AND ativo = 1
         AND (valido_ate IS NULL OR valido_ate > strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       LIMIT 1`
    )
    .bind(usuarioId)
    .first()
  return row !== null
}
