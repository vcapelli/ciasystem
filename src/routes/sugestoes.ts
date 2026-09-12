import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

const sugestoes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

sugestoes.post('/', async (c) => {
  const autorId = c.get('usuarioId')
  const body = await c.req.json<{ titulo: string; descricao: string }>()

  const { meta } = await c.env.DB.prepare(`INSERT INTO sugestoes (autor_id, titulo, descricao) VALUES (?, ?, ?)`)
    .bind(autorId, body.titulo, body.descricao).run()

  return c.json({ id: meta.last_row_id }, 201)
})

sugestoes.get('/', async (c) => {
  const status = c.req.query('status')
  const base = `SELECT s.*, a.nick AS autor_nick, d.nick AS decidido_por_nick
     FROM sugestoes s
     LEFT JOIN usuarios a ON a.id = s.autor_id
     LEFT JOIN usuarios d ON d.id = s.decidido_por_id`
  const query = status
    ? c.env.DB.prepare(`${base} WHERE s.status = ? ORDER BY s.criado_em DESC`).bind(status)
    : c.env.DB.prepare(`${base} ORDER BY s.criado_em DESC`)
  const { results } = await query.all()
  return c.json(results)
})

sugestoes.post('/:id/decidir', async (c) => {
  const decididoPorId = c.get('usuarioId')
  const id = c.req.param('id')
  const body = await c.req.json<{ status: 'aprovada' | 'rejeitada'; motivo_decisao?: string }>()

  if (!(await ehAdmin(c.env.DB, decididoPorId))) {
    return c.json({ erro: 'só administradores do sistema decidem sugestões' }, 403)
  }

  await c.env.DB.prepare(
    `UPDATE sugestoes SET status = ?, decidido_por_id = ?, motivo_decisao = ?, decidido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(body.status, decididoPorId, body.motivo_decisao ?? null, id).run()

  return c.json({ ok: true })
})

export default sugestoes
