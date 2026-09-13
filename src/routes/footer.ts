import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const footer = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// ---------- Links úteis ----------

footer.get('/links', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM footer_links ORDER BY ordem, id`).all()
  return c.json(results)
})

footer.post('/links', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam o footer' }, 403)

  const body = await c.req.json<{ titulo: string; url: string; ordem?: number }>()
  if (!body.titulo?.trim() || !body.url?.trim()) return c.json({ erro: 'titulo e url são obrigatórios' }, 400)

  const { meta } = await c.env.DB.prepare(`INSERT INTO footer_links (titulo, url, ordem) VALUES (?, ?, ?)`)
    .bind(body.titulo.trim(), body.url.trim(), body.ordem ?? 0).run()
  return c.json({ id: meta.last_row_id }, 201)
})

footer.patch('/links/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam o footer' }, 403)

  const body = await c.req.json<{ titulo?: string; url?: string; ordem?: number }>()
  const campos: string[] = []
  const valores: unknown[] = []
  if (body.titulo !== undefined) { campos.push('titulo = ?'); valores.push(body.titulo.trim()) }
  if (body.url !== undefined) { campos.push('url = ?'); valores.push(body.url.trim()) }
  if (body.ordem !== undefined) { campos.push('ordem = ?'); valores.push(body.ordem) }
  if (!campos.length) return c.json({ ok: true })

  await c.env.DB.prepare(`UPDATE footer_links SET ${campos.join(', ')} WHERE id = ?`).bind(...valores, c.req.param('id')).run()
  return c.json({ ok: true })
})

footer.delete('/links/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam o footer' }, 403)

  await c.env.DB.prepare(`DELETE FROM footer_links WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

// ---------- Redes sociais ----------

footer.get('/redes-sociais', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM footer_redes_sociais ORDER BY ordem, id`).all()
  return c.json(results)
})

footer.post('/redes-sociais', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam o footer' }, 403)

  const body = await c.req.json<{ nome: string; url: string; icone?: string; ordem?: number }>()
  if (!body.nome?.trim() || !body.url?.trim()) return c.json({ erro: 'nome e url são obrigatórios' }, 400)

  const { meta } = await c.env.DB.prepare(`INSERT INTO footer_redes_sociais (nome, url, icone, ordem) VALUES (?, ?, ?, ?)`)
    .bind(body.nome.trim(), body.url.trim(), body.icone ?? null, body.ordem ?? 0).run()
  return c.json({ id: meta.last_row_id }, 201)
})

footer.patch('/redes-sociais/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam o footer' }, 403)

  const body = await c.req.json<{ nome?: string; url?: string; icone?: string | null; ordem?: number }>()
  const campos: string[] = []
  const valores: unknown[] = []
  if (body.nome !== undefined) { campos.push('nome = ?'); valores.push(body.nome.trim()) }
  if (body.url !== undefined) { campos.push('url = ?'); valores.push(body.url.trim()) }
  if (body.icone !== undefined) { campos.push('icone = ?'); valores.push(body.icone) }
  if (body.ordem !== undefined) { campos.push('ordem = ?'); valores.push(body.ordem) }
  if (!campos.length) return c.json({ ok: true })

  await c.env.DB.prepare(`UPDATE footer_redes_sociais SET ${campos.join(', ')} WHERE id = ?`).bind(...valores, c.req.param('id')).run()
  return c.json({ ok: true })
})

footer.delete('/redes-sociais/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam o footer' }, 403)

  await c.env.DB.prepare(`DELETE FROM footer_redes_sociais WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

export default footer
