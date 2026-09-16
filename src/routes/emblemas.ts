import { Hono } from 'hono'
import { resolverUsuariosParaDistribuicao, type CriterioDistribuicao } from '../services/distribuicao'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const emblemas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

emblemas.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM emblemas WHERE ativo = 1 ORDER BY criado_em DESC`).all()
  return c.json(results)
})

emblemas.post('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema cadastram emblemas' }, 403)

  const body = await c.req.json<{ titulo: string; descricao?: string; imagem_url: string }>()
  if (!body.titulo?.trim() || !body.imagem_url?.trim()) return c.json({ erro: 'titulo e imagem_url são obrigatórios' }, 400)

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO emblemas (titulo, descricao, imagem_url, criado_por_id) VALUES (?, ?, ?, ?)`
  ).bind(body.titulo.trim(), body.descricao ?? null, body.imagem_url.trim(), usuarioId).run()
  return c.json({ id: meta.last_row_id }, 201)
})

emblemas.delete('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam emblemas' }, 403)
  await c.env.DB.prepare(`UPDATE emblemas SET ativo = 0 WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

emblemas.get('/usuario/:usuarioId', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, ue.concedido_em, ue.motivo
     FROM usuario_emblemas ue JOIN emblemas e ON e.id = ue.emblema_id
     WHERE ue.usuario_id = ? ORDER BY ue.concedido_em DESC`
  ).bind(c.req.param('usuarioId')).all()
  return c.json(results)
})

// POST /emblemas/:id/distribuir — concede em massa, conforme o
// critério escolhido. Retrato do momento: quem se qualificar DEPOIS
// não recebe retroativamente (precisa distribuir de novo).
emblemas.post('/:id/distribuir', async (c) => {
  const concedidoPorId = c.get('usuarioId')
  const emblemaId = c.req.param('id')
  const body = await c.req.json<{
    criterio: CriterioDistribuicao; grupo_id?: number; dias?: number; aula_id?: number
    usuario_ids?: number[]; motivo?: string
  }>()

  if (!(await ehAdmin(c.env.DB, concedidoPorId))) return c.json({ erro: 'só administradores do sistema distribuem emblemas' }, 403)

  const alvos = await resolverUsuariosParaDistribuicao(c.env.DB, body.criterio, body)
  let concedidos = 0
  for (const usuarioId of alvos) {
    const { meta } = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO usuario_emblemas (emblema_id, usuario_id, concedido_por_id, motivo, origem_grupo_id)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(emblemaId, usuarioId, concedidoPorId, body.motivo ?? null, body.criterio === 'grupo' ? body.grupo_id ?? null : null).run()
    if (meta.changes > 0) concedidos++
  }

  return c.json({ ok: true, alvos_encontrados: alvos.length, concedidos })
})

export default emblemas
