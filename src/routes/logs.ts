import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

const logs = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /logs?usuario_id=&ip=&tipo_evento= — restrito a admin do sistema.
logs.get('/', async (c) => {
  const usuarioAutenticado = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioAutenticado))) {
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
    `SELECT le.*, u.nick AS usuario_nick FROM logs_eventos le
     LEFT JOIN usuarios u ON u.id = le.usuario_id
     ${where.replace(/\b(usuario_id|ip|tipo_evento)\b/g, 'le.$1')}
     ORDER BY le.criado_em DESC LIMIT 200`
  ).bind(...params).all()

  return c.json(results)
})

export default logs
