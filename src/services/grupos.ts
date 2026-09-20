// Checagem de admin interno de grupo — reaproveitada por registros,
// aulas e páginas do hub (todas exigem a mesma coisa: ser membro
// ATIVO do grupo com administrador_grupo = 1, ou administrador_sistema).

import type { D1Like } from '../types/db'

export async function ehAdminDoGrupo(db: D1Like, usuarioId: number, grupoId: number): Promise<boolean> {
  const sistema = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId)
    .first<{ administrador_sistema: number }>()
  if (sistema?.administrador_sistema) return true

  const membro = await db.prepare(
    `SELECT 1 FROM usuario_grupos WHERE usuario_id = ? AND grupo_id = ? AND ativo = 1 AND administrador_grupo = 1`
  ).bind(usuarioId, grupoId).first()

  return membro !== null
}
