import { Hono } from 'hono'

type Bindings = { DB: D1Database }

const notificacoes = new Hono<{ Bindings: Bindings }>()

// GET /notificacoes/usuario/:id?lidas=false
notificacoes.get('/usuario/:id', async (c) => {
  const usuarioId = c.req.param('id')
  const lidas = c.req.query('lidas')

  let sql = `SELECT * FROM notificacoes WHERE usuario_id = ?`
  if (lidas === 'false') sql += ` AND lido_em IS NULL`
  sql += ` ORDER BY criado_em DESC`

  const { results } = await c.env.DB.prepare(sql).bind(usuarioId).all()
  return c.json(results)
})

// PATCH /notificacoes/:id/lida
notificacoes.patch('/:id/lida', async (c) => {
  await c.env.DB.prepare(
    `UPDATE notificacoes SET lido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND lido_em IS NULL`
  ).bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

export default notificacoes
