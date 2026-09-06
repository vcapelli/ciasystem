import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const menu = new Hono<{ Bindings: Bindings }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId)
    .first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// POST /menu — cria item (raiz ou submenu), restrito a admin do sistema
menu.post('/', async (c) => {
  const body = await c.req.json<{
    titulo: string
    url?: string
    pagina_customizada_id?: number
    icone?: string
    item_pai_id?: number
    ordem?: number
    grupo_restrito_id?: number
    patente_minima_id?: number
    criado_por_id: number
  }>()

  if (!(await ehAdmin(c.env.DB, body.criado_por_id))) {
    return c.json({ erro: 'só administradores do sistema gerenciam o menu' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO menu_itens
      (titulo, url, pagina_customizada_id, icone, item_pai_id, ordem, grupo_restrito_id, patente_minima_id, criado_por_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.titulo,
      body.url ?? null,
      body.pagina_customizada_id ?? null,
      body.icone ?? null,
      body.item_pai_id ?? null,
      body.ordem ?? 0,
      body.grupo_restrito_id ?? null,
      body.patente_minima_id ?? null,
      body.criado_por_id
    )
    .run()

  return c.json({ id: meta.last_row_id }, 201)
})

// GET /menu?usuario_id=123 — árvore de itens visíveis pra esse usuário
// (sem restrição de grupo/patente, ou que o usuário satisfaça).
menu.get('/', async (c) => {
  const usuarioId = c.req.query('usuario_id')

  const usuario = usuarioId
    ? await c.env.DB.prepare(`SELECT patente_atual_id FROM usuarios WHERE id = ?`)
        .bind(usuarioId)
        .first<{ patente_atual_id: number | null }>()
    : null

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM menu_itens WHERE ativo = 1 ORDER BY item_pai_id, ordem`
  ).all<{
    id: number
    titulo: string
    url: string | null
    pagina_customizada_id: number | null
    icone: string | null
    item_pai_id: number | null
    grupo_restrito_id: number | null
    patente_minima_id: number | null
  }>()

  const visiveis = []
  for (const item of results) {
    if (!usuarioId) {
      if (item.grupo_restrito_id === null && item.patente_minima_id === null) visiveis.push(item)
      continue
    }

    let ok = true
    if (item.grupo_restrito_id !== null) {
      const membro = await c.env.DB.prepare(
        `SELECT 1 FROM usuario_grupos WHERE usuario_id = ? AND grupo_id = ? AND ativo = 1`
      ).bind(usuarioId, item.grupo_restrito_id).first()
      ok = ok && membro !== null
    }
    if (ok && item.patente_minima_id !== null) {
      if (!usuario?.patente_atual_id) {
        ok = false
      } else {
        const cmp = await c.env.DB.prepare(
          `SELECT (p_alvo.ordem >= p_min.ordem AND p_alvo.corpo = p_min.corpo) AS ok
           FROM patentes p_alvo, patentes p_min WHERE p_alvo.id = ? AND p_min.id = ?`
        ).bind(usuario.patente_atual_id, item.patente_minima_id).first<{ ok: number }>()
        ok = ok && Boolean(cmp?.ok)
      }
    }
    if (ok) visiveis.push(item)
  }

  return c.json(visiveis)
})

export default menu
