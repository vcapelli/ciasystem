import { Hono } from 'hono'
import { podeGerirDocumento } from '../services/documentos'
import { notificar } from '../services/notificacoes'
import { registrarEvento } from '../services/logs'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const documentos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

documentos.post('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  const body = await c.req.json<{ titulo: string; tipo: string; conteudo_atual: string; slug: string }>()

  if (!(await podeGerirDocumento(c.env.DB, usuarioId, 'criar'))) {
    return c.json({ erro: 'sem permissão para criar documentos' }, 403)
  }

  if (!body.slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.slug)) {
    return c.json({ erro: 'slug precisa ser minúsculo, só letras/números/hífen (ex: constituicao-militar)' }, 400)
  }

  try {
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO documentos (titulo, tipo, conteudo_atual, slug) VALUES (?, ?, ?, ?)`
    ).bind(body.titulo, body.tipo, body.conteudo_atual, body.slug).run()
    return c.json({ id: meta.last_row_id, slug: body.slug }, 201)
  } catch {
    return c.json({ erro: 'já existe um documento com esse slug' }, 409)
  }
})

documentos.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM documentos ORDER BY titulo`).all()
  return c.json(results)
})

// Monta o resumo da última revisão IMPLEMENTADA de um documento — usado
// no rodapé da tela (número/data da revisão, data de implementação,
// comentários e os 3 aprovadores). `null` se o documento nunca foi revisado.
async function buscarUltimaRevisaoImplementada(db: D1Database, documentoId: number) {
  const revisao = await db.prepare(
    `SELECT id, numero_revisao, criado_em, implementado_em, autor_id
     FROM documento_revisoes
     WHERE documento_id = ? AND status = 'implementado'
     ORDER BY numero_revisao DESC LIMIT 1`
  ).bind(documentoId).first<{ id: number; numero_revisao: number; criado_em: string; implementado_em: string; autor_id: number }>()

  if (!revisao) return null

  const { results: aprovadores } = await db.prepare(
    `SELECT dra.papel, dra.usuario_id, dra.comentario, u.nick AS usuario_nick
     FROM documento_revisao_aprovadores dra LEFT JOIN usuarios u ON u.id = dra.usuario_id
     WHERE dra.revisao_id = ?`
  ).bind(revisao.id).all()

  return { ...revisao, aprovadores }
}

documentos.get('/slug/:slug', async (c) => {
  const doc = await c.env.DB.prepare(`SELECT * FROM documentos WHERE slug = ?`).bind(c.req.param('slug')).first<{ id: number }>()
  if (!doc) return c.json({ erro: 'não encontrado' }, 404)

  const ultimaRevisaoImplementada = await buscarUltimaRevisaoImplementada(c.env.DB, doc.id)
  return c.json({ ...doc, ultima_revisao_implementada: ultimaRevisaoImplementada })
})

// GET /documentos/slug/:slug/versao/:numero — visão somente-leitura de
// uma versão antiga JÁ IMPLEMENTADA (não confundir com uma revisão em
// andamento, que se acessa por id normalmente).
documentos.get('/slug/:slug/versao/:numero', async (c) => {
  const doc = await c.env.DB.prepare(`SELECT id, titulo, tipo FROM documentos WHERE slug = ?`)
    .bind(c.req.param('slug')).first<{ id: number; titulo: string; tipo: string }>()
  if (!doc) return c.json({ erro: 'documento não encontrado' }, 404)

  const revisao = await c.env.DB.prepare(
    `SELECT dr.*, au.nick AS autor_nick
     FROM documento_revisoes dr LEFT JOIN usuarios au ON au.id = dr.autor_id
     WHERE dr.documento_id = ? AND dr.numero_revisao = ? AND dr.status = 'implementado'`
  ).bind(doc.id, c.req.param('numero')).first()
  if (!revisao) return c.json({ erro: 'versão não encontrada' }, 404)

  const { results: aprovadores } = await c.env.DB.prepare(
    `SELECT dra.papel, dra.usuario_id, dra.comentario, u.nick AS usuario_nick
     FROM documento_revisao_aprovadores dra LEFT JOIN usuarios u ON u.id = dra.usuario_id
     WHERE dra.revisao_id = ?`
  ).bind((revisao as { id: number }).id).all()

  return c.json({ documento: doc, revisao: { ...revisao, aprovadores } })
})

documentos.get('/:id', async (c) => {
  const doc = await c.env.DB.prepare(`SELECT * FROM documentos WHERE id = ?`).bind(c.req.param('id')).first()
  if (!doc) return c.json({ erro: 'não encontrado' }, 404)
  return c.json(doc)
})

documentos.post('/:id/revisoes', async (c) => {
  const autorId = c.get('usuarioId')
  const documentoId = c.req.param('id')
  const body = await c.req.json<{
    conteudo_proposto?: string
    revisor_id: number
    administrador_forum_id: number
    descricao_inicial: string
  }>()

  const doc = await c.env.DB.prepare(`SELECT conteudo_atual, numero_revisao_atual FROM documentos WHERE id = ?`)
    .bind(documentoId).first<{ conteudo_atual: string; numero_revisao_atual: number }>()
  if (!doc) return c.json({ erro: 'documento não encontrado' }, 404)

  if (!(await podeGerirDocumento(c.env.DB, autorId, 'editar'))) {
    return c.json({ erro: 'sem permissão para editar documentos' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO documento_revisoes (documento_id, numero_revisao, conteudo_proposto, status, autor_id)
     VALUES (?, ?, ?, 'em_aprovacao', ?)`
  ).bind(documentoId, doc.numero_revisao_atual + 1, body.conteudo_proposto ?? doc.conteudo_atual, autorId).run()

  const revisaoId = meta.last_row_id

  await c.env.DB.prepare(
    `INSERT INTO documento_revisao_aprovadores (revisao_id, papel, usuario_id, status, decidido_em)
     VALUES (?, 'autor', ?, 'aprovado', strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
  ).bind(revisaoId, autorId).run()

  await c.env.DB.prepare(
    `INSERT INTO documento_revisao_aprovadores (revisao_id, papel, usuario_id) VALUES (?, 'revisor', ?)`
  ).bind(revisaoId, body.revisor_id).run()

  await c.env.DB.prepare(
    `INSERT INTO documento_revisao_aprovadores (revisao_id, papel, usuario_id) VALUES (?, 'administrador_forum', ?)`
  ).bind(revisaoId, body.administrador_forum_id).run()

  await c.env.DB.prepare(
    `INSERT INTO documento_revisao_historico (revisao_id, descricao, criado_por_id) VALUES (?, ?, ?)`
  ).bind(revisaoId, body.descricao_inicial, autorId).run()

  await c.env.DB.prepare(`UPDATE documentos SET status = 'em_revisao' WHERE id = ?`).bind(documentoId).run()

  return c.json({ id: revisaoId }, 201)
})

documentos.get('/:id/revisoes', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT dr.*, au.nick AS autor_nick
     FROM documento_revisoes dr
     LEFT JOIN usuarios au ON au.id = dr.autor_id
     WHERE dr.documento_id = ? ORDER BY dr.numero_revisao DESC`
  ).bind(c.req.param('id')).all()
  return c.json(results)
})

documentos.get('/:id/revisoes/:revisaoId', async (c) => {
  const revisaoId = c.req.param('revisaoId')

  const revisao = await c.env.DB.prepare(
    `SELECT dr.*, au.nick AS autor_nick
     FROM documento_revisoes dr LEFT JOIN usuarios au ON au.id = dr.autor_id
     WHERE dr.id = ?`
  ).bind(revisaoId).first()
  if (!revisao) return c.json({ erro: 'revisão não encontrada' }, 404)

  const { results: aprovadores } = await c.env.DB.prepare(
    `SELECT dra.*, u.nick AS usuario_nick
     FROM documento_revisao_aprovadores dra LEFT JOIN usuarios u ON u.id = dra.usuario_id
     WHERE dra.revisao_id = ?`
  ).bind(revisaoId).all()

  const { results: historico } = await c.env.DB.prepare(
    `SELECT drh.*, u.nick AS criado_por_nick
     FROM documento_revisao_historico drh LEFT JOIN usuarios u ON u.id = drh.criado_por_id
     WHERE drh.revisao_id = ? ORDER BY drh.criado_em`
  ).bind(revisaoId).all()

  return c.json({ ...revisao, aprovadores, historico })
})

documentos.post('/:id/revisoes/:revisaoId/historico', async (c) => {
  const criadoPorId = c.get('usuarioId')
  const revisaoId = c.req.param('revisaoId')
  const body = await c.req.json<{ descricao: string; conteudo_proposto?: string }>()

  await c.env.DB.prepare(
    `INSERT INTO documento_revisao_historico (revisao_id, descricao, criado_por_id) VALUES (?, ?, ?)`
  ).bind(revisaoId, body.descricao, criadoPorId).run()

  if (body.conteudo_proposto) {
    await c.env.DB.prepare(`UPDATE documento_revisoes SET conteudo_proposto = ? WHERE id = ?`)
      .bind(body.conteudo_proposto, revisaoId).run()
  }

  return c.json({ ok: true }, 201)
})

// POST /documentos/:id/revisoes/:revisaoId/aprovadores/:papel/decidir —
// só quem foi designado como esse papel nessa revisão pode decidir.
documentos.post('/:id/revisoes/:revisaoId/aprovadores/:papel/decidir', async (c) => {
  const usuarioId = c.get('usuarioId')
  const { revisaoId, papel } = c.req.param()
  const body = await c.req.json<{ status: 'aprovado' | 'reprovado'; comentario?: string }>()

  if (papel === 'autor') return c.json({ erro: 'o papel autor já é aprovado automaticamente na abertura' }, 400)

  const aprovador = await c.env.DB.prepare(
    `SELECT usuario_id FROM documento_revisao_aprovadores WHERE revisao_id = ? AND papel = ?`
  ).bind(revisaoId, papel).first<{ usuario_id: number }>()

  if (!aprovador) return c.json({ erro: 'papel não encontrado nesta revisão' }, 404)
  if (aprovador.usuario_id !== usuarioId) {
    return c.json({ erro: `só o usuário designado como '${papel}' nesta revisão pode decidir` }, 403)
  }

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

documentos.post('/:id/revisoes/:revisaoId/agendar', async (c) => {
  const usuarioId = c.get('usuarioId')
  const revisaoId = c.req.param('revisaoId')
  const body = await c.req.json<{ agendado_para: string }>()

  const revisao = await c.env.DB.prepare(`SELECT status FROM documento_revisoes WHERE id = ?`)
    .bind(revisaoId).first<{ status: string }>()
  if (!revisao) return c.json({ erro: 'revisão não encontrada' }, 404)
  if (revisao.status !== 'aprovado') {
    return c.json({ erro: `revisão precisa estar 'aprovado' pelos 3 papéis antes de agendar (está '${revisao.status}')` }, 400)
  }

  const ehAdministradorForum = await c.env.DB.prepare(
    `SELECT 1 FROM documento_revisao_aprovadores WHERE revisao_id = ? AND papel = 'administrador_forum' AND usuario_id = ?`
  ).bind(revisaoId, usuarioId).first()
  if (!ehAdministradorForum) return c.json({ erro: 'só o administrador do fórum designado nesta revisão pode agendar' }, 403)

  await c.env.DB.prepare(
    `UPDATE documento_revisoes SET status = 'agendado', agendado_para = ?, agendado_por_id = ? WHERE id = ?`
  ).bind(body.agendado_para, usuarioId, revisaoId).run()

  return c.json({ ok: true })
})

// POST /documentos/:id/revisoes/:revisaoId/implementar — só o
// administrador do fórum designado, ou um admin do sistema.
documentos.post('/:id/revisoes/:revisaoId/implementar', async (c) => {
  const usuarioId = c.get('usuarioId')
  const documentoId = c.req.param('id')
  const revisaoId = c.req.param('revisaoId')

  const revisao = await c.env.DB.prepare(
    `SELECT conteudo_proposto, numero_revisao, status, autor_id FROM documento_revisoes WHERE id = ? AND documento_id = ?`
  ).bind(revisaoId, documentoId).first<{ conteudo_proposto: string; numero_revisao: number; status: string; autor_id: number }>()

  if (!revisao) return c.json({ erro: 'revisão não encontrada' }, 404)
  if (revisao.status !== 'agendado') {
    return c.json({ erro: `revisão precisa estar 'agendado' antes de implementar (está '${revisao.status}')` }, 400)
  }

  const admin = await c.env.DB.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  const ehAdministradorForum = await c.env.DB.prepare(
    `SELECT 1 FROM documento_revisao_aprovadores WHERE revisao_id = ? AND papel = 'administrador_forum' AND usuario_id = ?`
  ).bind(revisaoId, usuarioId).first()

  if (!admin?.administrador_sistema && !ehAdministradorForum) {
    return c.json({ erro: 'só o administrador do fórum designado nesta revisão, ou um admin do sistema, pode implementar' }, 403)
  }

  await c.env.DB.prepare(
    `UPDATE documentos SET conteudo_atual = ?, numero_revisao_atual = ?, status = 'vigente', atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(revisao.conteudo_proposto, revisao.numero_revisao, documentoId).run()

  await c.env.DB.prepare(
    `UPDATE documento_revisoes SET status = 'implementado', implementado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(revisaoId).run()

  await notificar(c.env.DB, revisao.autor_id, 'documento_revisao', 'Sua revisão de documento foi implementada', {
    referenciaTipo: 'documento_revisao', referenciaId: Number(revisaoId),
  })

  await registrarEvento(c.env.DB, usuarioId, 'documento_revisao_implementada', {
    referenciaTipo: 'documento', referenciaId: Number(documentoId),
    detalhes: { revisao_id: Number(revisaoId), numero_revisao: revisao.numero_revisao },
  })

  return c.json({ ok: true })
})

export default documentos
