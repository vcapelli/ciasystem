import { Hono } from 'hono'

type Bindings = { DB: D1Database }

const crimes = new Hono<{ Bindings: Bindings }>()

// GET /crimes — lista pra fundamentação de punições/exonerações.
crimes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM crimes WHERE ativo = 1 ORDER BY nome COLLATE NOCASE`).all()
  return c.json(results)
})

export default crimes
