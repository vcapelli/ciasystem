// Checagem de permissão de documentos — mesmo padrão de
// requerimentos_permissoes: por usuário OU por grupo (dinâmico via
// usuario_grupos), concedido pelos administradores do sistema.

export type AcaoDocumento = 'criar' | 'editar' | 'deletar'

export async function podeGerirDocumento(
  db: D1Database,
  usuarioId: number,
  acao: AcaoDocumento
): Promise<boolean> {
  const sistema = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId)
    .first<{ administrador_sistema: number }>()
  if (sistema?.administrador_sistema) return true

  const coluna = acao === 'criar' ? 'pode_criar' : acao === 'editar' ? 'pode_editar' : 'pode_deletar'

  const row = await db
    .prepare(
      `SELECT 1
       FROM documentos_permissoes dp
       LEFT JOIN usuario_grupos ug
         ON ug.grupo_id = dp.grupo_id AND ug.usuario_id = ? AND ug.ativo = 1
       WHERE (dp.usuario_id = ? OR ug.usuario_id IS NOT NULL)
         AND dp.${coluna} = 1
       LIMIT 1`
    )
    .bind(usuarioId, usuarioId)
    .first()

  return row !== null
}
