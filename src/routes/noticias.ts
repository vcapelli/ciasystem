import { Hono } from 'hono'
import { podeGerirNoticia } from '../services/noticias'

type Bindings = { DB: D1Database }

const noticias = new Hono<{ Bindings: Bindings }>()

// POST /noticias — cria rascunho (checa pode_escrever)
noticias.post('/', async (c) => {
  const body = await c.req.json<{
    titulo: string
    resumo?: string
    conteudo: string
    imagem_capa_url?: string
    autor_id: number
    operado_por_id?: number
  }>()

  if (!(await podeGerirNoticia(c.env.DB, body.autor_id, 'escrever'))) {
    return c.json({ erro: 'sem permissão para escrever notícias' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO noticias (titulo, resumo, conteudo, imagem_capa_url, autor_id, operado_por_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(body.titulo, body.resumo ?? null, body.conteudo, body.imagem_capa_url ?? null, body.autor_id, body.operado_por_id ?? null)
    .run()

  return c.json({ id: meta.last_row_id }, 201)
})

// POST /noticias/:id/publicar — checa pode_publicar (separado de escrever)
noticias.post('/:id/publicar', async (c) => {
  const id = c.req.param('id')
  const { publicado_por_id } = await c.req.json<{ publicado_por_id: number }>()

  if (!(await podeGerirNoticia(c.env.DB, publicado_por_id, 'publicar'))) {
    return c.json({ erro: 'sem permissão para publicar notícias' }, 403)
  }

  await c.env.DB.prepare(
    `UPDATE noticias SET status = 'publicada', publicado_por_id = ?, publicado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(publicado_por_id, id).run()

  return c.json({ ok: true })
})

noticias.get('/', async (c) => {
  const status = c.req.query('status')
  const query = status
    ? c.env.DB.prepare(`SELECT * FROM noticias WHERE status = ? ORDER BY criado_em DESC`).bind(status)
    : c.env.DB.prepare(`SELECT * FROM noticias ORDER BY criado_em DESC`)
  const { results } = await query.all()
  return c.json(results)
})

noticias.get('/:id', async (c) => {
  const noticia = await c.env.DB.prepare(`SELECT * FROM noticias WHERE id = ?`).bind(c.req.param('id')).first()
  if (!noticia) return c.json({ erro: 'não encontrada' }, 404)
  return c.json(noticia)
})

export default noticias
