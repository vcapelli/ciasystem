import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const crimes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// GET /crimes — lista pra fundamentação de punições/exonerações.
crimes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM crimes WHERE ativo = 1 ORDER BY nome COLLATE NOCASE`).all()
  return c.json(results)
})

// POST /crimes — cadastra uma nova infração. Só admin.
crimes.post('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema cadastram infrações' }, 403)

  const { nome } = await c.req.json<{ nome: string }>()
  if (!nome?.trim()) return c.json({ erro: 'nome é obrigatório' }, 400)

  try {
    const { meta } = await c.env.DB.prepare(`INSERT INTO crimes (nome) VALUES (?)`).bind(nome.trim()).run()
    return c.json({ id: meta.last_row_id }, 201)
  } catch {
    return c.json({ erro: 'já existe uma infração com esse nome' }, 409)
  }
})

// DELETE /crimes/:id — desativa (soft delete). Só admin.
crimes.delete('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema removem infrações' }, 403)

  await c.env.DB.prepare(`UPDATE crimes SET ativo = 0 WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

export default crimes
