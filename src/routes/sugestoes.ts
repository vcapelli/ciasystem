import { Hono } from 'hono'

type Bindings = { DB: D1Database }

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId)
    .first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

const sugestoes = new Hono<{ Bindings: Bindings }>()

// POST /sugestoes — qualquer usuário envia
sugestoes.post('/', async (c) => {
  const body = await c.req.json<{ autor_id: number; titulo: string; descricao: string }>()

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO sugestoes (autor_id, titulo, descricao) VALUES (?, ?, ?)`
  )
    .bind(body.autor_id, body.titulo, body.descricao)
    .run()

  return c.json({ id: meta.last_row_id }, 201)
})

// GET /sugestoes?status=pendente
sugestoes.get('/', async (c) => {
  const status = c.req.query('status')
  const query = status
    ? c.env.DB.prepare(`SELECT * FROM sugestoes WHERE status = ? ORDER BY criado_em DESC`).bind(status)
    : c.env.DB.prepare(`SELECT * FROM sugestoes ORDER BY criado_em DESC`)
  const { results } = await query.all()
  return c.json(results)
})

// POST /sugestoes/:id/decidir — aprovar/rejeitar, restrito a admin do sistema
sugestoes.post('/:id/decidir', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ status: 'aprovada' | 'rejeitada'; motivo_decisao?: string; decidido_por_id: number }>()

  if (!(await ehAdmin(c.env.DB, body.decidido_por_id))) {
    return c.json({ erro: 'só administradores do sistema decidem sugestões' }, 403)
  }

  await c.env.DB.prepare(
    `UPDATE sugestoes SET status = ?, decidido_por_id = ?, motivo_decisao = ?, decidido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ?`
  )
    .bind(body.status, body.decidido_por_id, body.motivo_decisao ?? null, id)
    .run()

  return c.json({ ok: true })
})

export default sugestoes
