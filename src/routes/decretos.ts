import { Hono } from 'hono'
import { ehAdminDoGrupo } from '../services/grupos'
import { resolverAutor } from '../services/autor'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const decretos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// POST /decretos — publica um decreto em nome de um grupo. Só admin
// DAQUELE grupo (ou admin do sistema, que ehAdminDoGrupo já cobre).
decretos.post('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  const body = await c.req.json<{
    grupo_id: number; titulo: string; resumo: string; conteudo: string; postar_como_conta_id?: number
  }>()

  if (!body.grupo_id || !body.titulo?.trim() || !body.resumo?.trim() || !body.conteudo?.trim()) {
    return c.json({ erro: 'grupo, título, resumo e conteúdo são obrigatórios' }, 400)
  }
  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, body.grupo_id))) {
    return c.json({ erro: 'só administradores desse grupo publicam decretos em nome dele' }, 403)
  }

  let autor
  try {
    autor = await resolverAutor(c.env.DB, usuarioId, body.postar_como_conta_id)
  } catch (err) {
    return c.json({ erro: err instanceof Error ? err.message : 'erro ao resolver autor' }, 403)
  }

  const ano = new Date().getUTCFullYear()
  const ultimo = await c.env.DB.prepare(`SELECT COALESCE(MAX(numero), 0) AS max FROM decretos WHERE ano = ?`)
    .bind(ano).first<{ max: number }>()
  const numero = (ultimo?.max ?? 0) + 1

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO decretos (numero, ano, titulo, resumo, conteudo, grupo_id, autor_id, operado_por_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(numero, ano, body.titulo.trim(), body.resumo.trim(), body.conteudo.trim(), body.grupo_id, autor.autorId, autor.operadoPorId).run()

  return c.json({ id: meta.last_row_id, numero, ano }, 201)
})

// GET /decretos?pagina=N — lista paginada (10 por página), mais recente primeiro.
decretos.get('/', async (c) => {
  const pagina = Math.max(1, Number(c.req.query('pagina')) || 1)
  const porPagina = 10
  const offset = (pagina - 1) * porPagina

  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.numero, d.ano, d.titulo, d.resumo, d.tipo, d.status, d.visualizacoes, d.criado_em,
            g.nome AS grupo_nome, g.imagem_url AS grupo_imagem_url,
            u.nick AS autor_nick
     FROM decretos d
     JOIN grupos g ON g.id = d.grupo_id
     JOIN usuarios u ON u.id = d.autor_id
     ORDER BY d.criado_em DESC LIMIT ? OFFSET ?`
  ).bind(porPagina, offset).all()

  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM decretos`).first<{ n: number }>()

  return c.json({ decretos: results, total: totalRow?.n ?? 0, pagina, por_pagina: porPagina })
})

// GET /decretos/:id — detalhe, soma uma visualização a cada leitura.
decretos.get('/:id', async (c) => {
  const id = c.req.param('id')

  await c.env.DB.prepare(`UPDATE decretos SET visualizacoes = visualizacoes + 1 WHERE id = ?`).bind(id).run()

  const decreto = await c.env.DB.prepare(
    `SELECT d.*, g.nome AS grupo_nome, g.slug AS grupo_slug, g.imagem_url AS grupo_imagem_url, u.nick AS autor_nick
     FROM decretos d
     JOIN grupos g ON g.id = d.grupo_id
     JOIN usuarios u ON u.id = d.autor_id
     WHERE d.id = ?`
  ).bind(id).first()

  if (!decreto) return c.json({ erro: 'decreto não encontrado' }, 404)
  return c.json(decreto)
})

export default decretos
