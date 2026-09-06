import { Hono } from 'hono'

type Bindings = { DB: D1Database }

const cursos = new Hono<{ Bindings: Bindings }>()

// GET /cursos — catálogo (CFSd, SUP, CFC... já populado na Fase 1b)
cursos.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM cursos ORDER BY nome`).all()
  return c.json(results)
})

// POST /cursos/historico — registra conclusão de curso pra um usuário
cursos.post('/historico', async (c) => {
  const body = await c.req.json<{
    usuario_id: number
    curso_id: number
    data_conclusao: string
    certificado_por_id?: number
  }>()

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO historico_cursos (usuario_id, curso_id, data_conclusao, certificado_por_id) VALUES (?, ?, ?, ?)`
  )
    .bind(body.usuario_id, body.curso_id, body.data_conclusao, body.certificado_por_id ?? null)
    .run()

  return c.json({ id: meta.last_row_id }, 201)
})

cursos.get('/usuario/:usuarioId/historico', async (c) => {
  const usuarioId = c.req.param('usuarioId')
  const { results } = await c.env.DB.prepare(
    `SELECT hc.*, c.codigo, c.nome AS curso_nome
     FROM historico_cursos hc JOIN cursos c ON c.id = hc.curso_id
     WHERE hc.usuario_id = ? ORDER BY hc.data_conclusao DESC`
  )
    .bind(usuarioId)
    .all()
  return c.json(results)
})

// --- Certificados especiais (CFO, CQ, CCJ), com validade ---

cursos.post('/certificados', async (c) => {
  const body = await c.req.json<{
    usuario_id: number
    tipo: 'CFO' | 'CQ' | 'CCJ'
    concedido_por_id?: number
    data_concessao: string
    valido_ate?: string
  }>()

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO certificados (usuario_id, tipo, concedido_por_id, data_concessao, valido_ate)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(body.usuario_id, body.tipo, body.concedido_por_id ?? null, body.data_concessao, body.valido_ate ?? null)
    .run()

  return c.json({ id: meta.last_row_id }, 201)
})

cursos.get('/usuario/:usuarioId/certificados', async (c) => {
  const usuarioId = c.req.param('usuarioId')
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM certificados WHERE usuario_id = ? AND ativo = 1 ORDER BY data_concessao DESC`
  )
    .bind(usuarioId)
    .all()
  return c.json(results)
})

export default cursos
