import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const documentosPermissoes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// GET /documentos-permissoes — todas as concessões (usuário ou grupo)
// de criar/editar/deletar documentos. Só admin.
documentosPermissoes.get('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema veem isso' }, 403)

  const { results } = await c.env.DB.prepare(
    `SELECT dp.*, u.nick AS usuario_nick, g.nome AS grupo_nome, d.nick AS definido_por_nick
     FROM documentos_permissoes dp
     LEFT JOIN usuarios u ON u.id = dp.usuario_id
     LEFT JOIN grupos g ON g.id = dp.grupo_id
     LEFT JOIN usuarios d ON d.id = dp.definido_por_id
     ORDER BY dp.criado_em DESC`
  ).all()

  return c.json(results)
})

// POST /documentos-permissoes — concede criar/editar/deletar pra um
// usuário OU grupo. Só admin.
documentosPermissoes.post('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema concedem isso' }, 403)

  const body = await c.req.json<{
    usuario_id?: number
    grupo_id?: number
    pode_criar?: boolean
    pode_editar?: boolean
    pode_deletar?: boolean
  }>()

  if (!body.usuario_id && !body.grupo_id) return c.json({ erro: 'informe usuario_id ou grupo_id' }, 400)
  if (body.usuario_id && body.grupo_id) return c.json({ erro: 'só um dos dois: usuario_id ou grupo_id' }, 400)
  if (!body.pode_criar && !body.pode_editar && !body.pode_deletar) {
    return c.json({ erro: 'marque pelo menos uma permissão' }, 400)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO documentos_permissoes (usuario_id, grupo_id, pode_criar, pode_editar, pode_deletar, definido_por_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    body.usuario_id ?? null, body.grupo_id ?? null,
    body.pode_criar ? 1 : 0, body.pode_editar ? 1 : 0, body.pode_deletar ? 1 : 0, usuarioId
  ).run()

  return c.json({ id: meta.last_row_id }, 201)
})

// DELETE /documentos-permissoes/:id — só admin.
documentosPermissoes.delete('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema removem isso' }, 403)

  await c.env.DB.prepare(`DELETE FROM documentos_permissoes WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

export default documentosPermissoes
