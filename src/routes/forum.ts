import { Hono } from 'hono'
import { podeNaCategoria } from '../services/forum'

type Bindings = {
  DB: D1Database
}

const forum = new Hono<{ Bindings: Bindings }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId)
    .first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// --- Categorias (gestão restrita a administradores do sistema) ---

forum.post('/categorias', async (c) => {
  const { nome, descricao, categoria_pai_id, ordem, criado_por_id } = await c.req.json<{
    nome: string
    descricao?: string
    categoria_pai_id?: number
    ordem?: number
    criado_por_id: number
  }>()

  if (!(await ehAdmin(c.env.DB, criado_por_id))) {
    return c.json({ erro: 'só administradores do sistema criam categorias' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO forum_categorias (nome, descricao, categoria_pai_id, ordem) VALUES (?, ?, ?, ?)`
  )
    .bind(nome, descricao ?? null, categoria_pai_id ?? null, ordem ?? 0)
    .run()

  return c.json({ id: meta.last_row_id }, 201)
})

forum.get('/categorias', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM forum_categorias WHERE ativo = 1 ORDER BY ordem`
  ).all()
  return c.json(results)
})

// --- Tópicos ---

forum.post('/topicos', async (c) => {
  const { categoria_id, titulo, autor_id, requerimento_id } = await c.req.json<{
    categoria_id: number
    titulo: string
    autor_id: number
    requerimento_id?: number
  }>()

  const pode = await podeNaCategoria(c.env.DB, autor_id, categoria_id, 'postar')
  if (!pode) return c.json({ erro: 'sem permissão para postar nesta categoria' }, 403)

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO forum_topicos (categoria_id, titulo, autor_id, requerimento_id) VALUES (?, ?, ?, ?)`
  )
    .bind(categoria_id, titulo, autor_id, requerimento_id ?? null)
    .run()

  const topicoId = meta.last_row_id

  // Se o tópico nasceu de um requerimento, faz o vínculo de volta.
  if (requerimento_id) {
    await c.env.DB.prepare(`UPDATE requerimentos SET forum_topico_id = ? WHERE id = ?`)
      .bind(topicoId, requerimento_id)
      .run()
  }

  return c.json({ id: topicoId }, 201)
})

forum.get('/topicos', async (c) => {
  const categoriaId = c.req.query('categoria_id')
  const query = categoriaId
    ? c.env.DB.prepare(`SELECT * FROM forum_topicos WHERE categoria_id = ? ORDER BY fixado DESC, criado_em DESC`).bind(categoriaId)
    : c.env.DB.prepare(`SELECT * FROM forum_topicos ORDER BY fixado DESC, criado_em DESC`)
  const { results } = await query.all()
  return c.json(results)
})

forum.get('/topicos/:id', async (c) => {
  const id = c.req.param('id')

  const topico = await c.env.DB.prepare(`SELECT * FROM forum_topicos WHERE id = ?`).bind(id).first()
  if (!topico) return c.json({ erro: 'não encontrado' }, 404)

  await c.env.DB.prepare(`UPDATE forum_topicos SET visualizacoes = visualizacoes + 1 WHERE id = ?`).bind(id).run()

  const { results: posts } = await c.env.DB.prepare(
    `SELECT * FROM forum_posts WHERE topico_id = ? ORDER BY criado_em`
  ).bind(id).all()

  return c.json({ ...topico, posts })
})

// --- Posts ---

forum.post('/topicos/:id/posts', async (c) => {
  const topicoId = c.req.param('id')
  const { autor_id, operado_por_id, conteudo } = await c.req.json<{
    autor_id: number
    operado_por_id?: number
    conteudo: string
  }>()

  const topico = await c.env.DB.prepare(`SELECT categoria_id, trancado FROM forum_topicos WHERE id = ?`)
    .bind(topicoId)
    .first<{ categoria_id: number; trancado: number }>()

  if (!topico) return c.json({ erro: 'tópico não encontrado' }, 404)
  if (topico.trancado) return c.json({ erro: 'tópico trancado' }, 403)

  const pode = await podeNaCategoria(c.env.DB, operado_por_id ?? autor_id, topico.categoria_id, 'postar')
  if (!pode) return c.json({ erro: 'sem permissão para postar nesta categoria' }, 403)

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO forum_posts (topico_id, autor_id, operado_por_id, conteudo) VALUES (?, ?, ?, ?)`
  )
    .bind(topicoId, autor_id, operado_por_id ?? null, conteudo)
    .run()

  await c.env.DB.prepare(`UPDATE forum_topicos SET atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
    .bind(topicoId)
    .run()

  return c.json({ id: meta.last_row_id }, 201)
})

export default forum
