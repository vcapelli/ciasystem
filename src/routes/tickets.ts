import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

const tickets = new Hono<{ Bindings: Bindings; Variables: Variables }>()

tickets.post('/', async (c) => {
  const autorId = c.get('usuarioId')
  const body = await c.req.json<{ titulo: string; descricao: string }>()

  const { meta } = await c.env.DB.prepare(`INSERT INTO tickets_suporte (autor_id, titulo, descricao) VALUES (?, ?, ?)`)
    .bind(autorId, body.titulo, body.descricao).run()

  const ticketId = meta.last_row_id

  await c.env.DB.prepare(`INSERT INTO ticket_mensagens (ticket_id, autor_id, conteudo) VALUES (?, ?, ?)`)
    .bind(ticketId, autorId, body.descricao).run()

  return c.json({ id: ticketId }, 201)
})

tickets.get('/', async (c) => {
  const usuarioAutenticado = c.get('usuarioId')
  const status = c.req.query('status')
  const autorId = c.req.query('autor_id')

  // Não-admin só enxerga os próprios tickets, mesmo sem filtro explícito.
  const admin = await ehAdmin(c.env.DB, usuarioAutenticado)
  const autorEfetivo = admin ? autorId : String(usuarioAutenticado)

  const condicoes: string[] = []
  const params: (string | number)[] = []
  if (status) { condicoes.push('status = ?'); params.push(status) }
  if (autorEfetivo) { condicoes.push('autor_id = ?'); params.push(autorEfetivo) }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''
  const { results } = await c.env.DB.prepare(`SELECT * FROM tickets_suporte ${where} ORDER BY criado_em DESC`)
    .bind(...params).all()

  return c.json(results)
})

tickets.get('/:id', async (c) => {
  const usuarioAutenticado = c.get('usuarioId')
  const id = c.req.param('id')

  const ticket = await c.env.DB.prepare(`SELECT * FROM tickets_suporte WHERE id = ?`).bind(id).first<{ autor_id: number }>()
  if (!ticket) return c.json({ erro: 'não encontrado' }, 404)

  if (ticket.autor_id !== usuarioAutenticado && !(await ehAdmin(c.env.DB, usuarioAutenticado))) {
    return c.json({ erro: 'sem acesso a este ticket' }, 403)
  }

  const { results: mensagens } = await c.env.DB.prepare(`SELECT * FROM ticket_mensagens WHERE ticket_id = ? ORDER BY criado_em`)
    .bind(id).all()

  return c.json({ ...ticket, mensagens })
})

tickets.post('/:id/mensagens', async (c) => {
  const autorId = c.get('usuarioId')
  const id = c.req.param('id')
  const { conteudo } = await c.req.json<{ conteudo: string }>()

  const ticket = await c.env.DB.prepare(`SELECT autor_id, status FROM tickets_suporte WHERE id = ?`)
    .bind(id).first<{ autor_id: number; status: string }>()
  if (!ticket) return c.json({ erro: 'ticket não encontrado' }, 404)
  if (ticket.status === 'encerrado') return c.json({ erro: 'ticket encerrado' }, 403)

  const admin = await ehAdmin(c.env.DB, autorId)
  if (ticket.autor_id !== autorId && !admin) {
    return c.json({ erro: 'só o autor do ticket ou um administrador podem responder' }, 403)
  }

  const { meta } = await c.env.DB.prepare(`INSERT INTO ticket_mensagens (ticket_id, autor_id, conteudo) VALUES (?, ?, ?)`)
    .bind(id, autorId, conteudo).run()

  if (admin && ticket.status === 'aberto') {
    await c.env.DB.prepare(`UPDATE tickets_suporte SET status = 'em_andamento' WHERE id = ?`).bind(id).run()
  }

  return c.json({ id: meta.last_row_id }, 201)
})

tickets.post('/:id/encerrar', async (c) => {
  const encerradoPorId = c.get('usuarioId')
  const id = c.req.param('id')

  if (!(await ehAdmin(c.env.DB, encerradoPorId))) {
    return c.json({ erro: 'só administradores do sistema encerram tickets' }, 403)
  }

  await c.env.DB.prepare(
    `UPDATE tickets_suporte SET status = 'encerrado', encerrado_por_id = ?, encerrado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(encerradoPorId, id).run()

  return c.json({ ok: true })
})

export default tickets
