import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

const conquistas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

conquistas.post('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  const body = await c.req.json<{
    titulo: string; descricao?: string; imagem_url: string; tipo_criterio: string; valor_criterio: number
  }>()

  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema cadastram conquistas' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO conquistas (titulo, descricao, imagem_url, tipo_criterio, valor_criterio, criado_por_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(body.titulo, body.descricao ?? null, body.imagem_url, body.tipo_criterio, body.valor_criterio, usuarioId).run()

  return c.json({ id: meta.last_row_id }, 201)
})

conquistas.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM conquistas WHERE ativo = 1`).all()
  return c.json(results)
})

conquistas.post('/:id/conceder', async (c) => {
  const usuarioId = c.get('usuarioId')
  const conquistaId = c.req.param('id')
  const body = await c.req.json<{ usuario_id: number; valor_atingido: number }>()

  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema concedem conquistas' }, 403)
  }

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO usuario_conquistas (conquista_id, usuario_id, valor_atingido) VALUES (?, ?, ?)`
  ).bind(conquistaId, body.usuario_id, body.valor_atingido).run()

  return c.json({ ok: true })
})

conquistas.get('/usuario/:usuarioId', async (c) => {
  const usuarioId = c.req.param('usuarioId')
  const { results } = await c.env.DB.prepare(
    `SELECT co.*, uc.alcancado_em, uc.valor_atingido
     FROM usuario_conquistas uc JOIN conquistas co ON co.id = uc.conquista_id
     WHERE uc.usuario_id = ?`
  ).bind(usuarioId).all()
  return c.json(results)
})

export default conquistas
