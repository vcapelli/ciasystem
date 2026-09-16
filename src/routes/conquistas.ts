import { Hono } from 'hono'
import { resolverUsuariosParaDistribuicao, type CriterioDistribuicao } from '../services/distribuicao'

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
    titulo: string; descricao?: string; imagem_url: string; tipo_criterio?: string; valor_criterio?: number
  }>()

  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema cadastram conquistas' }, 403)
  }
  if (!body.titulo?.trim() || !body.imagem_url?.trim()) return c.json({ erro: 'titulo e imagem_url são obrigatórios' }, 400)

  // tipo_criterio/valor_criterio são resquício do rastreamento
  // automático antigo — hoje a distribuição é sempre manual/em massa
  // (ver /distribuir), então usamos 'manual'/0 como padrão.
  const { meta } = await c.env.DB.prepare(
    `INSERT INTO conquistas (titulo, descricao, imagem_url, tipo_criterio, valor_criterio, criado_por_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(body.titulo.trim(), body.descricao ?? null, body.imagem_url.trim(), body.tipo_criterio ?? 'manual', body.valor_criterio ?? 0, usuarioId).run()

  return c.json({ id: meta.last_row_id }, 201)
})

conquistas.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM conquistas WHERE ativo = 1`).all()
  return c.json(results)
})

conquistas.delete('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam conquistas' }, 403)
  await c.env.DB.prepare(`UPDATE conquistas SET ativo = 0 WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

// POST /conquistas/:id/distribuir — concede em massa, conforme o
// critério escolhido (mesmo mecanismo de emblemas/honrarias).
conquistas.post('/:id/distribuir', async (c) => {
  const usuarioId = c.get('usuarioId')
  const conquistaId = c.req.param('id')
  const body = await c.req.json<{
    criterio: CriterioDistribuicao; grupo_id?: number; dias?: number; aula_id?: number
    usuario_ids?: number[]; valor_atingido?: number
  }>()

  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema distribuem conquistas' }, 403)
  }

  const alvos = await resolverUsuariosParaDistribuicao(c.env.DB, body.criterio, body)
  let concedidos = 0
  for (const alvoId of alvos) {
    const { meta } = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO usuario_conquistas (conquista_id, usuario_id, valor_atingido) VALUES (?, ?, ?)`
    ).bind(conquistaId, alvoId, body.valor_atingido ?? 1).run()
    if (meta.changes > 0) concedidos++
  }

  return c.json({ ok: true, alvos_encontrados: alvos.length, concedidos })
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
