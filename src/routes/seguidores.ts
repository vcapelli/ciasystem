import { Hono } from 'hono'
import { notificar } from '../services/notificacoes'

type Bindings = { DB: D1Database }

const seguidores = new Hono<{ Bindings: Bindings }>()

// POST /seguidores — seguir
seguidores.post('/', async (c) => {
  const { seguidor_id, seguido_id } = await c.req.json<{ seguidor_id: number; seguido_id: number }>()

  if (seguidor_id === seguido_id) return c.json({ erro: 'não é possível seguir a si mesmo' }, 400)

  try {
    await c.env.DB.prepare(`INSERT INTO seguidores (seguidor_id, seguido_id) VALUES (?, ?)`)
      .bind(seguidor_id, seguido_id)
      .run()
  } catch {
    return c.json({ erro: 'já segue este usuário' }, 409)
  }

  const seguidor = await c.env.DB.prepare(`SELECT nick FROM usuarios WHERE id = ?`).bind(seguidor_id).first<{ nick: string }>()
  await notificar(c.env.DB, seguido_id, 'seguidor_novo', `${seguidor?.nick ?? 'Alguém'} começou a seguir você`, {
    referenciaTipo: 'usuario', referenciaId: seguidor_id,
  })

  return c.json({ ok: true }, 201)
})

// DELETE /seguidores — deixar de seguir
seguidores.delete('/', async (c) => {
  const { seguidor_id, seguido_id } = await c.req.json<{ seguidor_id: number; seguido_id: number }>()
  await c.env.DB.prepare(`DELETE FROM seguidores WHERE seguidor_id = ? AND seguido_id = ?`)
    .bind(seguidor_id, seguido_id)
    .run()
  return c.json({ ok: true })
})

// GET /seguidores/usuario/:id/seguidores — quem segue esse usuário
seguidores.get('/usuario/:id/seguidores', async (c) => {
  const usuarioId = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.nick FROM seguidores s JOIN usuarios u ON u.id = s.seguidor_id WHERE s.seguido_id = ?`
  ).bind(usuarioId).all()
  return c.json(results)
})

// GET /seguidores/usuario/:id/seguindo — quem esse usuário segue
seguidores.get('/usuario/:id/seguindo', async (c) => {
  const usuarioId = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.nick FROM seguidores s JOIN usuarios u ON u.id = s.seguido_id WHERE s.seguidor_id = ?`
  ).bind(usuarioId).all()
  return c.json(results)
})

export default seguidores
