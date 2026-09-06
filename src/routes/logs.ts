import { Hono } from 'hono'

type Bindings = { DB: D1Database }

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId)
    .first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

const logs = new Hono<{ Bindings: Bindings }>()

// GET /logs?usuario_id=&ip=&tipo_evento=&admin_id=<quem está consultando>
// Restrito a admin do sistema — é dado sensível de auditoria.
logs.get('/', async (c) => {
  const adminId = Number(c.req.query('admin_id'))
  if (!adminId || !(await ehAdmin(c.env.DB, adminId))) {
    return c.json({ erro: 'só administradores do sistema consultam logs' }, 403)
  }

  const usuarioId = c.req.query('usuario_id')
  const ip = c.req.query('ip')
  const tipoEvento = c.req.query('tipo_evento')

  const condicoes: string[] = []
  const params: (string | number)[] = []
  if (usuarioId) { condicoes.push('usuario_id = ?'); params.push(usuarioId) }
  if (ip) { condicoes.push('ip = ?'); params.push(ip) }
  if (tipoEvento) { condicoes.push('tipo_evento = ?'); params.push(tipoEvento) }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM logs_eventos ${where} ORDER BY criado_em DESC LIMIT 200`
  ).bind(...params).all()

  return c.json(results)
})

export default logs
