import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const motivosGratificacao = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const VALORES_VALIDOS = [5, 10, 15, 20, 25, 50]

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// GET /motivos-gratificacao — lista pro formulário de requerimento de
// Gratificação (o valor de cada motivo já vem junto, é ele quem decide
// quanto o requerimento vai valer, não um campo livre).
motivosGratificacao.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM motivos_gratificacao WHERE ativo = 1 ORDER BY valor DESC, nome COLLATE NOCASE`
  ).all()
  return c.json(results)
})

// POST /motivos-gratificacao — cadastra um novo motivo. Só admin.
motivosGratificacao.post('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema cadastram motivos de gratificação' }, 403)
  }

  const { nome, valor } = await c.req.json<{ nome: string; valor: number }>()
  if (!nome?.trim()) return c.json({ erro: 'nome é obrigatório' }, 400)
  if (!VALORES_VALIDOS.includes(Number(valor))) {
    return c.json({ erro: `valor precisa ser um dos seguintes: ${VALORES_VALIDOS.join(', ')}` }, 400)
  }

  try {
    const { meta } = await c.env.DB.prepare(`INSERT INTO motivos_gratificacao (nome, valor) VALUES (?, ?)`)
      .bind(nome.trim(), Number(valor)).run()
    return c.json({ id: meta.last_row_id }, 201)
  } catch {
    return c.json({ erro: 'já existe um motivo com esse nome' }, 409)
  }
})

// DELETE /motivos-gratificacao/:id — desativa (soft delete). Só admin.
// Gratificações já concedidas com esse motivo continuam intactas
// (valor_gratificacao já está congelado no requerimento).
motivosGratificacao.delete('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema removem motivos de gratificação' }, 403)
  }

  await c.env.DB.prepare(`UPDATE motivos_gratificacao SET ativo = 0 WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

export default motivosGratificacao
