import { Hono } from 'hono'
import { podeNaCategoria } from '../services/forum'
import { resolverAutor } from '../services/autor'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const forum = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

forum.post('/categorias', async (c) => {
  const usuarioId = c.get('usuarioId')
  const { nome, descricao, categoria_pai_id, ordem } = await c.req.json<{
    nome: string; descricao?: string; categoria_pai_id?: number; ordem?: number
  }>()

  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema criam categorias' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO forum_categorias (nome, descricao, categoria_pai_id, ordem) VALUES (?, ?, ?, ?)`
  ).bind(nome, descricao ?? null, categoria_pai_id ?? null, ordem ?? 0).run()

  return c.json({ id: meta.last_row_id }, 201)
})

forum.get('/categorias', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM forum_categorias WHERE ativo = 1 ORDER BY ordem`).all()
  return c.json(results)
})

forum.post('/topicos', async (c) => {
  const usuarioId = c.get('usuarioId')
  const { categoria_id, titulo, requerimento_id, postar_como_conta_id } = await c.req.json<{
    categoria_id: number; titulo: string; requerimento_id?: number; postar_como_conta_id?: number
  }>()

  let autor
  try {
    autor = await resolverAutor(c.env.DB, usuarioId, postar_como_conta_id)
  } catch (err) {
    return c.json({ erro: err instanceof Error ? err.message : 'erro ao resolver autor' }, 403)
  }

  const pode = await podeNaCategoria(c.env.DB, usuarioId, categoria_id, 'postar')
  if (!pode) return c.json({ erro: 'sem permissão para postar nesta categoria' }, 403)

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO forum_topicos (categoria_id, titulo, autor_id, requerimento_id) VALUES (?, ?, ?, ?)`
  ).bind(categoria_id, titulo, autor.autorId, requerimento_id ?? null).run()

  const topicoId = meta.last_row_id

  if (requerimento_id) {
    await c.env.DB.prepare(`UPDATE requerimentos SET forum_topico_id = ? WHERE id = ?`).bind(topicoId, requerimento_id).run()
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

  const { results: posts } = await c.env.DB.prepare(`SELECT * FROM forum_posts WHERE topico_id = ? ORDER BY criado_em`).bind(id).all()

  return c.json({ ...topico, posts })
})

forum.post('/topicos/:id/posts', async (c) => {
  const usuarioId = c.get('usuarioId')
  const topicoId = c.req.param('id')
  const { conteudo, postar_como_conta_id } = await c.req.json<{ conteudo: string; postar_como_conta_id?: number }>()

  let autor
  try {
    autor = await resolverAutor(c.env.DB, usuarioId, postar_como_conta_id)
  } catch (err) {
    return c.json({ erro: err instanceof Error ? err.message : 'erro ao resolver autor' }, 403)
  }

  const topico = await c.env.DB.prepare(`SELECT categoria_id, trancado FROM forum_topicos WHERE id = ?`)
    .bind(topicoId).first<{ categoria_id: number; trancado: number }>()
  if (!topico) return c.json({ erro: 'tópico não encontrado' }, 404)
  if (topico.trancado) return c.json({ erro: 'tópico trancado' }, 403)

  const pode = await podeNaCategoria(c.env.DB, usuarioId, topico.categoria_id, 'postar')
  if (!pode) return c.json({ erro: 'sem permissão para postar nesta categoria' }, 403)

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO forum_posts (topico_id, autor_id, operado_por_id, conteudo) VALUES (?, ?, ?, ?)`
  ).bind(topicoId, autor.autorId, autor.operadoPorId, conteudo).run()

  await c.env.DB.prepare(`UPDATE forum_topicos SET atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
    .bind(topicoId).run()

  return c.json({ id: meta.last_row_id }, 201)
})

export default forum
