import { Hono } from 'hono'

type Bindings = { DB: D1Database }

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId)
    .first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

const conquistas = new Hono<{ Bindings: Bindings }>()

// POST /conquistas — cadastra no catálogo (admin do sistema)
conquistas.post('/', async (c) => {
  const body = await c.req.json<{
    titulo: string
    descricao?: string
    imagem_url: string
    tipo_criterio: string
    valor_criterio: number
    criado_por_id: number
  }>()

  if (!(await ehAdmin(c.env.DB, body.criado_por_id))) {
    return c.json({ erro: 'só administradores do sistema cadastram conquistas' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO conquistas (titulo, descricao, imagem_url, tipo_criterio, valor_criterio, criado_por_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(body.titulo, body.descricao ?? null, body.imagem_url, body.tipo_criterio, body.valor_criterio, body.criado_por_id)
    .run()

  return c.json({ id: meta.last_row_id }, 201)
})

conquistas.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM conquistas WHERE ativo = 1`).all()
  return c.json(results)
})

// POST /conquistas/:id/conceder — registro manual de quem já bateu a
// meta. O cálculo automático ("varrer usuários e checar critério") é
// um job de cron separado (TODO futuro) — este endpoint só grava o
// resultado, não calcula nada sozinho.
conquistas.post('/:id/conceder', async (c) => {
  const conquistaId = c.req.param('id')
  const body = await c.req.json<{ usuario_id: number; valor_atingido: number; concedido_por_id: number }>()

  if (!(await ehAdmin(c.env.DB, body.concedido_por_id))) {
    return c.json({ erro: 'só administradores do sistema (ou o job de cron) concedem conquistas' }, 403)
  }

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO usuario_conquistas (conquista_id, usuario_id, valor_atingido) VALUES (?, ?, ?)`
  )
    .bind(conquistaId, body.usuario_id, body.valor_atingido)
    .run()

  return c.json({ ok: true })
})

conquistas.get('/usuario/:usuarioId', async (c) => {
  const usuarioId = c.req.param('usuarioId')
  const { results } = await c.env.DB.prepare(
    `SELECT co.*, uc.alcancado_em, uc.valor_atingido
     FROM usuario_conquistas uc JOIN conquistas co ON co.id = uc.conquista_id
     WHERE uc.usuario_id = ?`
  )
    .bind(usuarioId)
    .all()
  return c.json(results)
})

export default conquistas
