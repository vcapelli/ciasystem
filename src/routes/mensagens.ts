import { Hono } from 'hono'
import { notificar } from '../services/notificacoes'

type Bindings = { DB: D1Database }

const mensagens = new Hono<{ Bindings: Bindings }>()

// POST /mensagens — envia pra 1 ou mais destinatários
mensagens.post('/', async (c) => {
  const body = await c.req.json<{
    remetente_id: number
    operado_por_id?: number
    assunto: string
    corpo: string
    destinatarios: number[]
  }>()

  if (!body.destinatarios?.length) return c.json({ erro: 'ao menos 1 destinatário é obrigatório' }, 400)

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO mensagens (remetente_id, operado_por_id, assunto, corpo) VALUES (?, ?, ?, ?)`
  )
    .bind(body.remetente_id, body.operado_por_id ?? null, body.assunto, body.corpo)
    .run()

  const mensagemId = meta.last_row_id

  for (const destinatarioId of body.destinatarios) {
    await c.env.DB.prepare(`INSERT INTO mensagem_destinatarios (mensagem_id, destinatario_id) VALUES (?, ?)`)
      .bind(mensagemId, destinatarioId)
      .run()

    await notificar(c.env.DB, destinatarioId, 'mensagem', `Nova mensagem: ${body.assunto}`, {
      referenciaTipo: 'mensagem',
      referenciaId: Number(mensagemId),
    })
  }

  return c.json({ id: mensagemId }, 201)
})

// GET /mensagens/usuario/:id — caixa de entrada
mensagens.get('/usuario/:id', async (c) => {
  const usuarioId = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.remetente_id, m.assunto, m.corpo, m.enviado_em, md.lido_em, md.arquivado
     FROM mensagem_destinatarios md JOIN mensagens m ON m.id = md.mensagem_id
     WHERE md.destinatario_id = ? AND md.apagado = 0
     ORDER BY m.enviado_em DESC`
  ).bind(usuarioId).all()
  return c.json(results)
})

// GET /mensagens/usuario/:id/enviadas
mensagens.get('/usuario/:id/enviadas', async (c) => {
  const usuarioId = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM mensagens WHERE remetente_id = ? AND apagado_pelo_remetente = 0 ORDER BY enviado_em DESC`
  ).bind(usuarioId).all()
  return c.json(results)
})

// PATCH /mensagens/:id/lida — marca como lida (só o destinatário)
mensagens.patch('/:id/lida', async (c) => {
  const mensagemId = c.req.param('id')
  const { destinatario_id } = await c.req.json<{ destinatario_id: number }>()

  await c.env.DB.prepare(
    `UPDATE mensagem_destinatarios SET lido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE mensagem_id = ? AND destinatario_id = ? AND lido_em IS NULL`
  ).bind(mensagemId, destinatario_id).run()

  return c.json({ ok: true })
})

export default mensagens
