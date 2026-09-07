import { Hono } from 'hono'
import { notificar } from '../services/notificacoes'
import { resolverAutor } from '../services/autor'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const mensagens = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

mensagens.post('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  const body = await c.req.json<{
    assunto: string; corpo: string; destinatarios: number[]; postar_como_conta_id?: number
  }>()

  if (!body.destinatarios?.length) return c.json({ erro: 'ao menos 1 destinatário é obrigatório' }, 400)

  let remetente
  try {
    remetente = await resolverAutor(c.env.DB, usuarioId, body.postar_como_conta_id)
  } catch (err) {
    return c.json({ erro: err instanceof Error ? err.message : 'erro ao resolver remetente' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO mensagens (remetente_id, operado_por_id, assunto, corpo) VALUES (?, ?, ?, ?)`
  ).bind(remetente.autorId, remetente.operadoPorId, body.assunto, body.corpo).run()

  const mensagemId = meta.last_row_id

  for (const destinatarioId of body.destinatarios) {
    await c.env.DB.prepare(`INSERT INTO mensagem_destinatarios (mensagem_id, destinatario_id) VALUES (?, ?)`)
      .bind(mensagemId, destinatarioId).run()

    await notificar(c.env.DB, destinatarioId, 'mensagem', `Nova mensagem: ${body.assunto}`, {
      referenciaTipo: 'mensagem', referenciaId: Number(mensagemId),
    })
  }

  return c.json({ id: mensagemId }, 201)
})

// GET /mensagens/usuario/:id — caixa de entrada, só do próprio usuário ou admin
mensagens.get('/usuario/:id', async (c) => {
  const usuarioAutenticado = c.get('usuarioId')
  const id = c.req.param('id')

  if (Number(id) !== usuarioAutenticado && !(await ehAdmin(c.env.DB, usuarioAutenticado))) {
    return c.json({ erro: 'só é possível ver a própria caixa de entrada' }, 403)
  }

  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.remetente_id, m.assunto, m.corpo, m.enviado_em, md.lido_em, md.arquivado
     FROM mensagem_destinatarios md JOIN mensagens m ON m.id = md.mensagem_id
     WHERE md.destinatario_id = ? AND md.apagado = 0
     ORDER BY m.enviado_em DESC`
  ).bind(id).all()
  return c.json(results)
})

mensagens.get('/usuario/:id/enviadas', async (c) => {
  const usuarioAutenticado = c.get('usuarioId')
  const id = c.req.param('id')

  if (Number(id) !== usuarioAutenticado && !(await ehAdmin(c.env.DB, usuarioAutenticado))) {
    return c.json({ erro: 'só é possível ver os próprios enviados' }, 403)
  }

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM mensagens WHERE remetente_id = ? AND apagado_pelo_remetente = 0 ORDER BY enviado_em DESC`
  ).bind(id).all()
  return c.json(results)
})

// PATCH /mensagens/:id/lida — só o próprio destinatário autenticado
mensagens.patch('/:id/lida', async (c) => {
  const destinatarioId = c.get('usuarioId')
  const mensagemId = c.req.param('id')

  await c.env.DB.prepare(
    `UPDATE mensagem_destinatarios SET lido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE mensagem_id = ? AND destinatario_id = ? AND lido_em IS NULL`
  ).bind(mensagemId, destinatarioId).run()

  return c.json({ ok: true })
})

export default mensagens
