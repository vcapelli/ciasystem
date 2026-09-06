import { Hono } from 'hono'

type Bindings = { DB: D1Database }

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId)
    .first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

const tickets = new Hono<{ Bindings: Bindings }>()

// POST /tickets — abre um ticket (a descrição também já vira a primeira mensagem)
tickets.post('/', async (c) => {
  const body = await c.req.json<{ autor_id: number; titulo: string; descricao: string }>()

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO tickets_suporte (autor_id, titulo, descricao) VALUES (?, ?, ?)`
  )
    .bind(body.autor_id, body.titulo, body.descricao)
    .run()

  const ticketId = meta.last_row_id

  await c.env.DB.prepare(
    `INSERT INTO ticket_mensagens (ticket_id, autor_id, conteudo) VALUES (?, ?, ?)`
  )
    .bind(ticketId, body.autor_id, body.descricao)
    .run()

  return c.json({ id: ticketId }, 201)
})

// GET /tickets?status=aberto&autor_id=123
tickets.get('/', async (c) => {
  const status = c.req.query('status')
  const autorId = c.req.query('autor_id')

  const condicoes: string[] = []
  const params: (string | number)[] = []
  if (status) { condicoes.push('status = ?'); params.push(status) }
  if (autorId) { condicoes.push('autor_id = ?'); params.push(autorId) }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM tickets_suporte ${where} ORDER BY criado_em DESC`
  ).bind(...params).all()

  return c.json(results)
})

// GET /tickets/:id — detalhe com a thread de mensagens
tickets.get('/:id', async (c) => {
  const id = c.req.param('id')

  const ticket = await c.env.DB.prepare(`SELECT * FROM tickets_suporte WHERE id = ?`).bind(id).first()
  if (!ticket) return c.json({ erro: 'não encontrado' }, 404)

  const { results: mensagens } = await c.env.DB.prepare(
    `SELECT * FROM ticket_mensagens WHERE ticket_id = ? ORDER BY criado_em`
  ).bind(id).all()

  return c.json({ ...ticket, mensagens })
})

// POST /tickets/:id/mensagens — autor do ticket ou qualquer admin do sistema
tickets.post('/:id/mensagens', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ autor_id: number; conteudo: string }>()

  const ticket = await c.env.DB.prepare(`SELECT autor_id, status FROM tickets_suporte WHERE id = ?`)
    .bind(id)
    .first<{ autor_id: number; status: string }>()
  if (!ticket) return c.json({ erro: 'ticket não encontrado' }, 404)
  if (ticket.status === 'encerrado') return c.json({ erro: 'ticket encerrado' }, 403)

  const admin = await ehAdmin(c.env.DB, body.autor_id)
  if (ticket.autor_id !== body.autor_id && !admin) {
    return c.json({ erro: 'só o autor do ticket ou um administrador podem responder' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO ticket_mensagens (ticket_id, autor_id, conteudo) VALUES (?, ?, ?)`
  )
    .bind(id, body.autor_id, body.conteudo)
    .run()

  // Primeira resposta de um admin move o ticket de 'aberto' pra 'em_andamento'.
  if (admin && ticket.status === 'aberto') {
    await c.env.DB.prepare(`UPDATE tickets_suporte SET status = 'em_andamento' WHERE id = ?`).bind(id).run()
  }

  return c.json({ id: meta.last_row_id }, 201)
})

// POST /tickets/:id/encerrar — só admin do sistema
tickets.post('/:id/encerrar', async (c) => {
  const id = c.req.param('id')
  const { encerrado_por_id } = await c.req.json<{ encerrado_por_id: number }>()

  if (!(await ehAdmin(c.env.DB, encerrado_por_id))) {
    return c.json({ erro: 'só administradores do sistema encerram tickets' }, 403)
  }

  await c.env.DB.prepare(
    `UPDATE tickets_suporte SET status = 'encerrado', encerrado_por_id = ?, encerrado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(encerrado_por_id, id).run()

  return c.json({ ok: true })
})

export default tickets
