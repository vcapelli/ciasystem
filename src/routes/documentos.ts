import { Hono } from 'hono'
import { podeGerirDocumento } from '../services/documentos'
import { notificar } from '../services/notificacoes'
import { registrarEvento } from '../services/logs'

type Bindings = { DB: D1Database }

const documentos = new Hono<{ Bindings: Bindings }>()

// POST /documentos — cria o documento vigente inicial
documentos.post('/', async (c) => {
  const body = await c.req.json<{
    titulo: string
    tipo: string
    conteudo_atual: string
    criado_por_id: number
  }>()

  if (!(await podeGerirDocumento(c.env.DB, body.criado_por_id, 'criar'))) {
    return c.json({ erro: 'sem permissão para criar documentos' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO documentos (titulo, tipo, conteudo_atual) VALUES (?, ?, ?)`
  )
    .bind(body.titulo, body.tipo, body.conteudo_atual)
    .run()

  return c.json({ id: meta.last_row_id }, 201)
})

documentos.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM documentos ORDER BY titulo`).all()
  return c.json(results)
})

documentos.get('/:id', async (c) => {
  const doc = await c.env.DB.prepare(`SELECT * FROM documentos WHERE id = ?`).bind(c.req.param('id')).first()
  if (!doc) return c.json({ erro: 'não encontrado' }, 404)
  return c.json(doc)
})

// POST /documentos/:id/revisoes — abre uma "solicitação de alteração":
// cria a cópia editável e já define os 3 aprovadores (autor entra
// automaticamente como aprovado, já que é quem está propondo).
documentos.post('/:id/revisoes', async (c) => {
  const documentoId = c.req.param('id')
  const body = await c.req.json<{
    conteudo_proposto?: string
    autor_id: number
    revisor_id: number
    administrador_forum_id: number
    descricao_inicial: string
  }>()

  const doc = await c.env.DB.prepare(`SELECT conteudo_atual, numero_revisao_atual FROM documentos WHERE id = ?`)
    .bind(documentoId)
    .first<{ conteudo_atual: string; numero_revisao_atual: number }>()
  if (!doc) return c.json({ erro: 'documento não encontrado' }, 404)

  if (!(await podeGerirDocumento(c.env.DB, body.autor_id, 'editar'))) {
    return c.json({ erro: 'sem permissão para editar documentos' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO documento_revisoes (documento_id, numero_revisao, conteudo_proposto, status, autor_id)
     VALUES (?, ?, ?, 'em_aprovacao', ?)`
  )
    .bind(documentoId, doc.numero_revisao_atual + 1, body.conteudo_proposto ?? doc.conteudo_atual, body.autor_id)
    .run()

  const revisaoId = meta.last_row_id

  await c.env.DB.prepare(
    `INSERT INTO documento_revisao_aprovadores (revisao_id, papel, usuario_id, status, decidido_em)
     VALUES (?, 'autor', ?, 'aprovado', strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
  ).bind(revisaoId, body.autor_id).run()

  await c.env.DB.prepare(
    `INSERT INTO documento_revisao_aprovadores (revisao_id, papel, usuario_id) VALUES (?, 'revisor', ?)`
  ).bind(revisaoId, body.revisor_id).run()

  await c.env.DB.prepare(
    `INSERT INTO documento_revisao_aprovadores (revisao_id, papel, usuario_id) VALUES (?, 'administrador_forum', ?)`
  ).bind(revisaoId, body.administrador_forum_id).run()

  await c.env.DB.prepare(
    `INSERT INTO documento_revisao_historico (revisao_id, descricao, criado_por_id) VALUES (?, ?, ?)`
  ).bind(revisaoId, body.descricao_inicial, body.autor_id).run()

  await c.env.DB.prepare(`UPDATE documentos SET status = 'em_revisao' WHERE id = ?`).bind(documentoId).run()

  return c.json({ id: revisaoId }, 201)
})

documentos.get('/:id/revisoes', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM documento_revisoes WHERE documento_id = ? ORDER BY numero_revisao DESC`
  ).bind(c.req.param('id')).all()
  return c.json(results)
})

documentos.get('/:id/revisoes/:revisaoId', async (c) => {
  const revisaoId = c.req.param('revisaoId')

  const revisao = await c.env.DB.prepare(`SELECT * FROM documento_revisoes WHERE id = ?`).bind(revisaoId).first()
  if (!revisao) return c.json({ erro: 'revisão não encontrada' }, 404)

  const { results: aprovadores } = await c.env.DB.prepare(
    `SELECT * FROM documento_revisao_aprovadores WHERE revisao_id = ?`
  ).bind(revisaoId).all()

  const { results: historico } = await c.env.DB.prepare(
    `SELECT * FROM documento_revisao_historico WHERE revisao_id = ? ORDER BY criado_em`
  ).bind(revisaoId).all()

  return c.json({ ...revisao, aprovadores, historico })
})

// POST /documentos/:id/revisoes/:revisaoId/historico — mais uma
// entrada de "o que foi alterado" (o autor pode ir ajustando o
// rascunho antes/durante a aprovação).
documentos.post('/:id/revisoes/:revisaoId/historico', async (c) => {
  const revisaoId = c.req.param('revisaoId')
  const body = await c.req.json<{ descricao: string; criado_por_id: number; conteudo_proposto?: string }>()

  await c.env.DB.prepare(
    `INSERT INTO documento_revisao_historico (revisao_id, descricao, criado_por_id) VALUES (?, ?, ?)`
  ).bind(revisaoId, body.descricao, body.criado_por_id).run()

  if (body.conteudo_proposto) {
    await c.env.DB.prepare(`UPDATE documento_revisoes SET conteudo_proposto = ? WHERE id = ?`)
      .bind(body.conteudo_proposto, revisaoId)
      .run()
  }

  return c.json({ ok: true }, 201)
})

// POST /documentos/:id/revisoes/:revisaoId/aprovadores/:papel/decidir
// — revisor ou administrador_forum aprova/reprova. Quando os 3 papéis
// estiverem 'aprovado', a revisão vira 'aprovado' (ainda falta
// agendar). Qualquer reprovação já reprova a revisão inteira.
documentos.post('/:id/revisoes/:revisaoId/aprovadores/:papel/decidir', async (c) => {
  const { revisaoId, papel } = c.req.param()
  const body = await c.req.json<{ status: 'aprovado' | 'reprovado'; comentario?: string }>()

  if (papel === 'autor') return c.json({ erro: 'o papel autor já é aprovado automaticamente na abertura' }, 400)

  await c.env.DB.prepare(
    `UPDATE documento_revisao_aprovadores
     SET status = ?, comentario = ?, decidido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE revisao_id = ? AND papel = ?`
  ).bind(body.status, body.comentario ?? null, revisaoId, papel).run()

  if (body.status === 'reprovado') {
    await c.env.DB.prepare(`UPDATE documento_revisoes SET status = 'reprovado' WHERE id = ?`).bind(revisaoId).run()
    return c.json({ ok: true, status_revisao: 'reprovado' })
  }

  const { results } = await c.env.DB.prepare(
    `SELECT status FROM documento_revisao_aprovadores WHERE revisao_id = ?`
  ).bind(revisaoId).all<{ status: string }>()

  const todosAprovados = results.length === 3 && results.every((r) => r.status === 'aprovado')
  if (todosAprovados) {
    await c.env.DB.prepare(`UPDATE documento_revisoes SET status = 'aprovado' WHERE id = ?`).bind(revisaoId).run()
  }

  return c.json({ ok: true, status_revisao: todosAprovados ? 'aprovado' : 'em_aprovacao' })
})

// POST /documentos/:id/revisoes/:revisaoId/agendar — só o
// administrador_forum aprovador dessa revisão pode agendar, e só
// depois que os 3 papéis já aprovaram.
documentos.post('/:id/revisoes/:revisaoId/agendar', async (c) => {
  const revisaoId = c.req.param('revisaoId')
  const body = await c.req.json<{ agendado_para: string; agendado_por_id: number }>()

  const revisao = await c.env.DB.prepare(`SELECT status FROM documento_revisoes WHERE id = ?`)
    .bind(revisaoId)
    .first<{ status: string }>()
  if (!revisao) return c.json({ erro: 'revisão não encontrada' }, 404)
  if (revisao.status !== 'aprovado') {
    return c.json({ erro: `revisão precisa estar 'aprovado' pelos 3 papéis antes de agendar (está '${revisao.status}')` }, 400)
  }

  const ehAdministradorForum = await c.env.DB.prepare(
    `SELECT 1 FROM documento_revisao_aprovadores WHERE revisao_id = ? AND papel = 'administrador_forum' AND usuario_id = ?`
  ).bind(revisaoId, body.agendado_por_id).first()
  if (!ehAdministradorForum) return c.json({ erro: 'só o administrador do fórum designado nesta revisão pode agendar' }, 403)

  await c.env.DB.prepare(
    `UPDATE documento_revisoes SET status = 'agendado', agendado_para = ?, agendado_por_id = ? WHERE id = ?`
  ).bind(body.agendado_para, body.agendado_por_id, revisaoId).run()

  return c.json({ ok: true })
})

// POST /documentos/:id/revisoes/:revisaoId/implementar — sobrescreve
// o conteúdo vigente do documento. Chamado no horário agendado (job
// de cron futuro) ou manualmente por quem tem permissão.
documentos.post('/:id/revisoes/:revisaoId/implementar', async (c) => {
  const documentoId = c.req.param('id')
  const revisaoId = c.req.param('revisaoId')

  const revisao = await c.env.DB.prepare(
    `SELECT conteudo_proposto, numero_revisao, status, autor_id FROM documento_revisoes WHERE id = ? AND documento_id = ?`
  ).bind(revisaoId, documentoId).first<{ conteudo_proposto: string; numero_revisao: number; status: string; autor_id: number }>()

  if (!revisao) return c.json({ erro: 'revisão não encontrada' }, 404)
  if (revisao.status !== 'agendado') {
    return c.json({ erro: `revisão precisa estar 'agendado' antes de implementar (está '${revisao.status}')` }, 400)
  }

  await c.env.DB.prepare(
    `UPDATE documentos SET conteudo_atual = ?, numero_revisao_atual = ?, status = 'vigente', atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(revisao.conteudo_proposto, revisao.numero_revisao, documentoId).run()

  await c.env.DB.prepare(
    `UPDATE documento_revisoes SET status = 'implementado', implementado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(revisaoId).run()

  await notificar(c.env.DB, revisao.autor_id, 'documento_revisao', 'Sua revisão de documento foi implementada', {
    referenciaTipo: 'documento_revisao',
    referenciaId: Number(revisaoId),
  })

  await registrarEvento(c.env.DB, null, 'documento_revisao_implementada', {
    referenciaTipo: 'documento',
    referenciaId: Number(documentoId),
    detalhes: { revisao_id: Number(revisaoId), numero_revisao: revisao.numero_revisao },
  })

  return c.json({ ok: true })
})

export default documentos
