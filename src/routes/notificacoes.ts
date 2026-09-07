import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const notificacoes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// GET /notificacoes/usuario/:id — só o próprio usuário ou admin
notificacoes.get('/usuario/:id', async (c) => {
  const usuarioAutenticado = c.get('usuarioId')
  const id = c.req.param('id')
  const lidas = c.req.query('lidas')

  if (Number(id) !== usuarioAutenticado && !(await ehAdmin(c.env.DB, usuarioAutenticado))) {
    return c.json({ erro: 'só é possível ver as próprias notificações' }, 403)
  }

  let sql = `SELECT * FROM notificacoes WHERE usuario_id = ?`
  if (lidas === 'false') sql += ` AND lido_em IS NULL`
  sql += ` ORDER BY criado_em DESC`

  const { results } = await c.env.DB.prepare(sql).bind(id).all()
  return c.json(results)
})

// PATCH /notificacoes/:id/lida — só o dono da notificação
notificacoes.patch('/:id/lida', async (c) => {
  const usuarioAutenticado = c.get('usuarioId')
  const id = c.req.param('id')

  await c.env.DB.prepare(
    `UPDATE notificacoes SET lido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND usuario_id = ? AND lido_em IS NULL`
  ).bind(id, usuarioAutenticado).run()

  return c.json({ ok: true })
})

export default notificacoes
