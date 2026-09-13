import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const categorias = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

categorias.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM documentos_categorias ORDER BY ordem, nome`).all()
  return c.json(results)
})

categorias.post('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam categorias' }, 403)

  const body = await c.req.json<{ nome: string; banner_url?: string; ordem?: number }>()
  if (!body.nome?.trim()) return c.json({ erro: 'nome é obrigatório' }, 400)

  try {
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO documentos_categorias (nome, banner_url, ordem) VALUES (?, ?, ?)`
    ).bind(body.nome.trim(), body.banner_url ?? null, body.ordem ?? 0).run()
    return c.json({ id: meta.last_row_id }, 201)
  } catch {
    return c.json({ erro: 'já existe uma categoria com esse nome' }, 409)
  }
})

categorias.patch('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam categorias' }, 403)

  const body = await c.req.json<{ nome?: string; banner_url?: string | null; ordem?: number }>()
  const campos: string[] = []
  const valores: unknown[] = []
  if (body.nome !== undefined) { campos.push('nome = ?'); valores.push(body.nome.trim()) }
  if (body.banner_url !== undefined) { campos.push('banner_url = ?'); valores.push(body.banner_url) }
  if (body.ordem !== undefined) { campos.push('ordem = ?'); valores.push(body.ordem) }
  if (!campos.length) return c.json({ ok: true })

  try {
    await c.env.DB.prepare(`UPDATE documentos_categorias SET ${campos.join(', ')} WHERE id = ?`)
      .bind(...valores, c.req.param('id')).run()
    return c.json({ ok: true })
  } catch {
    return c.json({ erro: 'já existe uma categoria com esse nome' }, 409)
  }
})

// DELETE /documentos-categorias/:id — bloqueia se algum documento
// ainda estiver nela (precisa mover antes).
categorias.delete('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam categorias' }, 403)

  const id = c.req.param('id')
  const emUso = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM documentos WHERE categoria_id = ?`)
    .bind(id).first<{ total: number }>()
  if (emUso && emUso.total > 0) {
    return c.json({ erro: `${emUso.total} documento(s) ainda estão nessa categoria — mova antes de excluir` }, 409)
  }

  await c.env.DB.prepare(`DELETE FROM documentos_categorias WHERE id = ?`).bind(id).run()
  return c.json({ ok: true })
})

export default categorias
