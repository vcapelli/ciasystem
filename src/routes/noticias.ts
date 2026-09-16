import { Hono } from 'hono'
import { podeGerirNoticia } from '../services/noticias'
import { resolverAutor } from '../services/autor'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const noticias = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /noticias/permissoes/minhas — o que o usuário atual pode fazer
// com notícias globais (pra decidir o que mostrar no frontend).
noticias.get('/permissoes/minhas', async (c) => {
  const usuarioId = c.get('usuarioId')
  const [podeEscrever, podePublicar] = await Promise.all([
    podeGerirNoticia(c.env.DB, usuarioId, 'escrever'),
    podeGerirNoticia(c.env.DB, usuarioId, 'publicar'),
  ])
  return c.json({ pode_escrever: podeEscrever, pode_publicar: podePublicar })
})

noticias.post('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  const body = await c.req.json<{
    titulo: string; resumo?: string; conteudo: string; imagem_capa_url?: string; postar_como_conta_id?: number
  }>()

  if (!(await podeGerirNoticia(c.env.DB, usuarioId, 'escrever'))) {
    return c.json({ erro: 'sem permissão para escrever notícias' }, 403)
  }

  let autor
  try {
    autor = await resolverAutor(c.env.DB, usuarioId, body.postar_como_conta_id)
  } catch (err) {
    return c.json({ erro: err instanceof Error ? err.message : 'erro ao resolver autor' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO noticias (titulo, resumo, conteudo, imagem_capa_url, autor_id, operado_por_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(body.titulo, body.resumo ?? null, body.conteudo, body.imagem_capa_url ?? null, autor.autorId, autor.operadoPorId).run()

  return c.json({ id: meta.last_row_id }, 201)
})

noticias.post('/:id/publicar', async (c) => {
  const usuarioId = c.get('usuarioId')
  const id = c.req.param('id')

  if (!(await podeGerirNoticia(c.env.DB, usuarioId, 'publicar'))) {
    return c.json({ erro: 'sem permissão para publicar notícias' }, 403)
  }

  await c.env.DB.prepare(
    `UPDATE noticias SET status = 'publicada', publicado_por_id = ?, publicado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(usuarioId, id).run()

  return c.json({ ok: true })
})

noticias.get('/', async (c) => {
  const status = c.req.query('status')
  const base = `
    SELECT n.*, u.nick AS autor_nick
    FROM noticias n JOIN usuarios u ON u.id = n.autor_id
  `
  const query = status
    ? c.env.DB.prepare(`${base} WHERE n.status = ? ORDER BY n.criado_em DESC`).bind(status)
    : c.env.DB.prepare(`${base} ORDER BY n.criado_em DESC`)
  const { results } = await query.all()
  return c.json(results)
})

noticias.get('/:id', async (c) => {
  const noticia = await c.env.DB.prepare(
    `SELECT n.*, u.nick AS autor_nick FROM noticias n JOIN usuarios u ON u.id = n.autor_id WHERE n.id = ?`
  ).bind(c.req.param('id')).first()
  if (!noticia) return c.json({ erro: 'não encontrada' }, 404)
  return c.json(noticia)
})

export default noticias
