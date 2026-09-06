// Checagem de permissão de notícias globais — mesmo padrão de
// requerimentos_permissoes/documentos_permissoes: por usuário OU por
// grupo (dinâmico via usuario_grupos), concedido pelos administradores
// do sistema.

export type AcaoNoticia = 'escrever' | 'publicar'

export async function podeGerirNoticia(
  db: D1Database,
  usuarioId: number,
  acao: AcaoNoticia
): Promise<boolean> {
  const sistema = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId)
    .first<{ administrador_sistema: number }>()
  if (sistema?.administrador_sistema) return true

  const coluna = acao === 'escrever' ? 'pode_escrever' : 'pode_publicar'

  const row = await db
    .prepare(
      `SELECT 1
       FROM noticias_permissoes np
       LEFT JOIN usuario_grupos ug
         ON ug.grupo_id = np.grupo_id AND ug.usuario_id = ? AND ug.ativo = 1
       WHERE (np.usuario_id = ? OR ug.usuario_id IS NOT NULL)
         AND np.${coluna} = 1
       LIMIT 1`
    )
    .bind(usuarioId, usuarioId)
    .first()

  return row !== null
}
