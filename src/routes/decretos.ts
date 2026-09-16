import { Hono } from 'hono'
import { ehAdminDoGrupo } from '../services/grupos'
import { resolverAutor } from '../services/autor'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const decretos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// --- Categorias (geridas só pelo admin do sistema) ---

decretos.get('/categorias', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM decretos_categorias ORDER BY ordem, nome`).all()
  return c.json(results)
})

decretos.post('/categorias', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam categorias' }, 403)

  const body = await c.req.json<{ nome: string; ordem?: number }>()
  if (!body.nome?.trim()) return c.json({ erro: 'nome é obrigatório' }, 400)

  try {
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO decretos_categorias (nome, ordem) VALUES (?, ?)`
    ).bind(body.nome.trim(), body.ordem ?? 0).run()
    return c.json({ id: meta.last_row_id }, 201)
  } catch {
    return c.json({ erro: 'já existe uma categoria com esse nome' }, 409)
  }
})

decretos.patch('/categorias/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam categorias' }, 403)

  const body = await c.req.json<{ nome?: string; ordem?: number }>()
  await c.env.DB.prepare(
    `UPDATE decretos_categorias SET nome = COALESCE(?, nome), ordem = COALESCE(?, ordem) WHERE id = ?`
  ).bind(body.nome ?? null, body.ordem ?? null, c.req.param('id')).run()
  return c.json({ ok: true })
})

decretos.delete('/categorias/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam categorias' }, 403)

  const id = c.req.param('id')
  if (id === '1') return c.json({ erro: 'a categoria "Geral" não pode ser excluída' }, 400)

  const emUso = await c.env.DB.prepare(`SELECT 1 FROM decretos WHERE categoria_id = ? LIMIT 1`).bind(id).first()
  if (emUso) return c.json({ erro: 'existem decretos nessa categoria — mova-os antes de excluir' }, 409)

  await c.env.DB.prepare(`DELETE FROM decretos_categorias WHERE id = ?`).bind(id).run()
  return c.json({ ok: true })
})

// --- Decretos ---

// POST /decretos — publica um decreto em nome de um grupo. Só admin
// DAQUELE grupo (ou admin do sistema, que ehAdminDoGrupo já cobre).
decretos.post('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  const body = await c.req.json<{
    grupo_id: number; categoria_id: number; titulo: string; resumo: string; conteudo: string; postar_como_conta_id?: number
  }>()

  if (!body.grupo_id || !body.categoria_id || !body.titulo?.trim() || !body.resumo?.trim() || !body.conteudo?.trim()) {
    return c.json({ erro: 'grupo, categoria, título, resumo e conteúdo são obrigatórios' }, 400)
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
    `INSERT INTO decretos (numero, ano, titulo, resumo, conteudo, grupo_id, categoria_id, autor_id, operado_por_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(numero, ano, body.titulo.trim(), body.resumo.trim(), body.conteudo.trim(), body.grupo_id, body.categoria_id, autor.autorId, autor.operadoPorId).run()

  return c.json({ id: meta.last_row_id, numero, ano }, 201)
})

// GET /decretos?pagina=N&categoria_id=N — lista paginada (10 por
// página), mais recente primeiro, com filtro opcional de categoria.
decretos.get('/', async (c) => {
  const pagina = Math.max(1, Number(c.req.query('pagina')) || 1)
  const categoriaId = c.req.query('categoria_id')
  const porPagina = 10
  const offset = (pagina - 1) * porPagina

  const base = `
    SELECT d.id, d.numero, d.ano, d.titulo, d.resumo, d.tipo, d.status, d.visualizacoes, d.criado_em,
           g.nome AS grupo_nome, g.imagem_url AS grupo_imagem_url,
           u.nick AS autor_nick, dc.id AS categoria_id, dc.nome AS categoria_nome
    FROM decretos d
    JOIN grupos g ON g.id = d.grupo_id
    JOIN usuarios u ON u.id = d.autor_id
    JOIN decretos_categorias dc ON dc.id = d.categoria_id
  `
  const query = categoriaId
    ? c.env.DB.prepare(`${base} WHERE d.categoria_id = ? ORDER BY d.criado_em DESC LIMIT ? OFFSET ?`).bind(categoriaId, porPagina, offset)
    : c.env.DB.prepare(`${base} ORDER BY d.criado_em DESC LIMIT ? OFFSET ?`).bind(porPagina, offset)

  const { results } = await query.all()

  const totalRow = categoriaId
    ? await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM decretos WHERE categoria_id = ?`).bind(categoriaId).first<{ n: number }>()
    : await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM decretos`).first<{ n: number }>()

  return c.json({ decretos: results, total: totalRow?.n ?? 0, pagina, por_pagina: porPagina })
})

// GET /decretos/:id — detalhe, soma uma visualização a cada leitura.
decretos.get('/:id', async (c) => {
  const id = c.req.param('id')

  await c.env.DB.prepare(`UPDATE decretos SET visualizacoes = visualizacoes + 1 WHERE id = ?`).bind(id).run()

  const decreto = await c.env.DB.prepare(
    `SELECT d.*, g.nome AS grupo_nome, g.slug AS grupo_slug, g.imagem_url AS grupo_imagem_url,
            u.nick AS autor_nick, dc.nome AS categoria_nome
     FROM decretos d
     JOIN grupos g ON g.id = d.grupo_id
     JOIN usuarios u ON u.id = d.autor_id
     JOIN decretos_categorias dc ON dc.id = d.categoria_id
     WHERE d.id = ?`
  ).bind(id).first()

  if (!decreto) return c.json({ erro: 'decreto não encontrado' }, 404)
  return c.json(decreto)
})

export default decretos
