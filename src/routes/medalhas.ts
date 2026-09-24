import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const medalhas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// TODO: checar os limites do doc-mestre antes de conceder (medalha
// temporária: máx. 30/dia e 700/mês por policial) — não implementado.
medalhas.post('/', async (c) => {
  const concedidaPorId = c.get('usuarioId')
  const body = await c.req.json<{
    usuario_id: number
    tipo: 'temporaria' | 'efetiva' | 'honraria_particular' | 'honra'
    motivo: string
    quantidade?: number
    expira_em?: string
  }>()

  if (body.usuario_id === concedidaPorId && !(await ehAdmin(c.env.DB, concedidaPorId))) {
    return c.json({ erro: 'você não pode conceder medalha a si mesmo' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO medalhas (usuario_id, tipo, motivo, quantidade, concedida_por_id, expira_em)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(body.usuario_id, body.tipo, body.motivo, body.quantidade ?? 1, concedidaPorId, body.expira_em ?? null).run()

  return c.json({ id: meta.last_row_id }, 201)
})

medalhas.get('/usuario/:usuarioId', async (c) => {
  const usuarioId = c.req.param('usuarioId')
  const { results } = await c.env.DB.prepare(`SELECT * FROM medalhas WHERE usuario_id = ? ORDER BY data_concessao DESC`)
    .bind(usuarioId).all()
  return c.json(results)
})

export default medalhas
