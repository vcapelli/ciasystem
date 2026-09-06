import { Hono } from 'hono'

type Bindings = { DB: D1Database }

const medalhas = new Hono<{ Bindings: Bindings }>()

// POST /medalhas — concede medalha (temporaria/efetiva/honraria_particular/honra)
// TODO: checar os limites do doc-mestre antes de conceder (medalha
// temporária: máx. 30/dia e 700/mês por policial) — não implementado
// ainda, precisa somar quantidade das medalhas do dia/mês do alvo.
medalhas.post('/', async (c) => {
  const body = await c.req.json<{
    usuario_id: number
    tipo: 'temporaria' | 'efetiva' | 'honraria_particular' | 'honra'
    motivo: string
    quantidade?: number
    concedida_por_id: number
    expira_em?: string
  }>()

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO medalhas (usuario_id, tipo, motivo, quantidade, concedida_por_id, expira_em)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(body.usuario_id, body.tipo, body.motivo, body.quantidade ?? 1, body.concedida_por_id, body.expira_em ?? null)
    .run()

  return c.json({ id: meta.last_row_id }, 201)
})

medalhas.get('/usuario/:usuarioId', async (c) => {
  const usuarioId = c.req.param('usuarioId')
  const { results } = await c.env.DB.prepare(`SELECT * FROM medalhas WHERE usuario_id = ? ORDER BY data_concessao DESC`)
    .bind(usuarioId)
    .all()
  return c.json(results)
})

export default medalhas
