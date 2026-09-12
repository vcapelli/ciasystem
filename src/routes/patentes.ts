import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const patentes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// GET /patentes?corpo=militar|executivo — lista pra popular seletores
// de patente/cargo destino nos formulários de requerimento.
patentes.get('/', async (c) => {
  const corpo = c.req.query('corpo')

  const query = corpo
    ? c.env.DB.prepare(`SELECT * FROM patentes WHERE ativo = 1 AND corpo = ? ORDER BY ordem`).bind(corpo)
    : c.env.DB.prepare(`SELECT * FROM patentes WHERE ativo = 1 ORDER BY corpo, ordem`)

  const { results } = await query.all()
  return c.json(results)
})

// POST /patentes — cria uma patente/cargo novo. Só admin. `ordem` é
// obrigatório e precisa ser único dentro do corpo — o admin escolhe
// onde entra na escada (dá pra reordenar via PATCH depois).
patentes.post('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam a hierarquia' }, 403)

  const body = await c.req.json<{
    corpo: 'militar' | 'executivo'
    sub_corpo?: 'pracas' | 'pracas_especiais' | 'oficiais' | null
    nome: string
    ordem: number
    vagas?: number | null
    valor_compra_raros?: number | null
  }>()

  if (!body.corpo || !body.nome || body.ordem == null) {
    return c.json({ erro: 'corpo, nome e ordem são obrigatórios' }, 400)
  }

  try {
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO patentes (corpo, sub_corpo, nome, ordem, vagas, valor_compra_raros) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(body.corpo, body.sub_corpo ?? null, body.nome, body.ordem, body.vagas ?? null, body.valor_compra_raros ?? null).run()
    return c.json({ id: meta.last_row_id }, 201)
  } catch {
    return c.json({ erro: 'já existe uma patente/cargo com essa ordem nesse corpo' }, 409)
  }
})

// PATCH /patentes/:id — edita nome/ordem/vagas/valor de compra. Só admin.
patentes.patch('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam a hierarquia' }, 403)

  const body = await c.req.json<{ nome?: string; ordem?: number; vagas?: number | null; valor_compra_raros?: number | null; cor?: string | null }>()
  const campos: string[] = []
  const valores: unknown[] = []
  if (body.nome !== undefined) { campos.push('nome = ?'); valores.push(body.nome) }
  if (body.ordem !== undefined) { campos.push('ordem = ?'); valores.push(body.ordem) }
  if (body.vagas !== undefined) { campos.push('vagas = ?'); valores.push(body.vagas) }
  if (body.valor_compra_raros !== undefined) { campos.push('valor_compra_raros = ?'); valores.push(body.valor_compra_raros) }
  if (body.cor !== undefined) {
    if (body.cor !== null && !/^#[0-9a-fA-F]{6}$/.test(body.cor)) {
      return c.json({ erro: 'cor precisa ser um hex válido (#rrggbb)' }, 400)
    }
    campos.push('cor = ?'); valores.push(body.cor)
  }
  if (!campos.length) return c.json({ ok: true })

  try {
    await c.env.DB.prepare(`UPDATE patentes SET ${campos.join(', ')} WHERE id = ?`).bind(...valores, c.req.param('id')).run()
    return c.json({ ok: true })
  } catch {
    return c.json({ erro: 'já existe uma patente/cargo com essa ordem nesse corpo' }, 409)
  }
})

// DELETE /patentes/:id — desativa (soft delete). Bloqueia se alguém
// ainda ocupa essa patente — precisa mudar todo mundo de patente
// antes (via requerimento normal) pra depois poder desativar.
patentes.delete('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam a hierarquia' }, 403)

  const id = c.req.param('id')
  const emUso = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM usuarios WHERE patente_atual_id = ?`)
    .bind(id).first<{ total: number }>()
  if (emUso && emUso.total > 0) {
    return c.json({ erro: `${emUso.total} usuário(s) ainda ocupam essa patente/cargo — remaneje antes de desativar` }, 409)
  }

  await c.env.DB.prepare(`UPDATE patentes SET ativo = 0 WHERE id = ?`).bind(id).run()
  return c.json({ ok: true })
})

export default patentes
