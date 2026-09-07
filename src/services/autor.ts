// Resolve quem é o "autor" de uma publicação (tweet, post de fórum,
// mensagem, notícia): normalmente é o próprio usuário autenticado,
// mas se ele estiver autorizado a operar uma conta oficial
// (conta_oficial_operadores) e pedir pra postar como ela, o autor
// registrado vira a conta oficial — com operado_por_id sempre
// guardando quem de fato apertou o botão.

export interface AutorResolvido {
  autorId: number
  operadoPorId: number | null
}

export async function resolverAutor(
  db: D1Database,
  usuarioAutenticado: number,
  postarComoContaId?: number
): Promise<AutorResolvido> {
  if (!postarComoContaId) {
    return { autorId: usuarioAutenticado, operadoPorId: null }
  }

  const autorizado = await db
    .prepare(`SELECT 1 FROM conta_oficial_operadores WHERE conta_id = ? AND usuario_id = ?`)
    .bind(postarComoContaId, usuarioAutenticado)
    .first()

  if (!autorizado) {
    throw new Error('você não está autorizado a operar esta conta oficial')
  }

  return { autorId: postarComoContaId, operadoPorId: usuarioAutenticado }
}
