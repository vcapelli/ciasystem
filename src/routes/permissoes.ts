import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const permissoes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// GET /permissoes-requerimentos — todas as concessões (usuário ou
// grupo) de aprovar/cancelar requerimentos. Só admin.
permissoes.get('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema veem isso' }, 403)

  const { results } = await c.env.DB.prepare(
    `SELECT rp.*, u.nick AS usuario_nick, g.nome AS grupo_nome, d.nick AS definido_por_nick
     FROM requerimentos_permissoes rp
     LEFT JOIN usuarios u ON u.id = rp.usuario_id
     LEFT JOIN grupos g ON g.id = rp.grupo_id
     LEFT JOIN usuarios d ON d.id = rp.definido_por_id
     ORDER BY rp.criado_em DESC`
  ).all()

  return c.json(results)
})

// POST /permissoes-requerimentos — concede aprovar/cancelar pra um
// usuário OU grupo (nunca os dois), opcionalmente restrito a um tipo
// (tipo NULL = vale pra todos). Só admin.
permissoes.post('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema concedem isso' }, 403)

  const body = await c.req.json<{
    usuario_id?: number
    grupo_id?: number
    tipo?: string | null
    pode_aprovar?: boolean
    pode_cancelar?: boolean
  }>()

  if (!body.usuario_id && !body.grupo_id) return c.json({ erro: 'informe usuario_id ou grupo_id' }, 400)
  if (body.usuario_id && body.grupo_id) return c.json({ erro: 'só um dos dois: usuario_id ou grupo_id' }, 400)
  if (!body.pode_aprovar && !body.pode_cancelar) return c.json({ erro: 'marque pelo menos aprovar ou cancelar' }, 400)

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO requerimentos_permissoes (usuario_id, grupo_id, tipo, pode_aprovar, pode_cancelar, definido_por_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    body.usuario_id ?? null, body.grupo_id ?? null, body.tipo || null,
    body.pode_aprovar ? 1 : 0, body.pode_cancelar ? 1 : 0, usuarioId
  ).run()

  return c.json({ id: meta.last_row_id }, 201)
})

// DELETE /permissoes-requerimentos/:id — só admin.
permissoes.delete('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema removem isso' }, 403)

  await c.env.DB.prepare(`DELETE FROM requerimentos_permissoes WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

export default permissoes
