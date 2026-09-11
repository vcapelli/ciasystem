import { Hono } from 'hono'

type Bindings = { DB: D1Database }

const patentes = new Hono<{ Bindings: Bindings }>()

// GET /patentes?corpo=militar|executivo — lista pra popular seletores
// de patente/cargo destino nos formulários de requerimento.
patentes.get('/', async (c) => {
  const corpo = c.req.query('corpo')

  const query = corpo
    ? c.env.DB.prepare(`SELECT * FROM patentes WHERE ativo = 1 AND corpo = ? ORDER BY ordem`).bind(corpo)
    : c.env.DB.prepare(`SELECT * FROM patentes WHERE ativo = 1 ORDER BY corpo, ordem`)

  const { results } = await query.all()
  return c.json(results)
})

export default patentes
