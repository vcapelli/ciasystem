import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const requisitos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// GET /requisitos-patente?patente_id=X — requisitos pra chegar
// naquela patente/cargo. Sem filtro, devolve todos (o painel de admin
// busca todos de uma vez e agrupa no cliente).
requisitos.get('/', async (c) => {
  const patenteId = c.req.query('patente_id')

  const base = `
    SELECT rp.*, c.nome AS curso_nome, g.nome AS grupo_nome
    FROM requisitos_patente rp
    LEFT JOIN cursos c ON c.id = rp.curso_id
    LEFT JOIN grupos g ON g.id = rp.grupo_id
  `
  const query = patenteId
    ? c.env.DB.prepare(`${base} WHERE rp.patente_id = ? ORDER BY rp.criado_em`).bind(patenteId)
    : c.env.DB.prepare(`${base} ORDER BY rp.patente_id, rp.criado_em`)

  const { results } = await query.all()
  return c.json(results)
})

// POST /requisitos-patente — adiciona um requisito a uma patente. Só admin.
requisitos.post('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam requisitos' }, 403)

  const body = await c.req.json<{
    patente_id: number
    tipo: 'tempo_na_patente' | 'tempo_na_policia' | 'curso' | 'certificado' | 'grupo' | 'outro'
    dias?: number
    curso_id?: number
    certificado_tipo?: 'CFO' | 'CQ' | 'CCJ'
    grupo_id?: number
    descricao?: string
  }>()

  if (!body.patente_id || !body.tipo) return c.json({ erro: 'patente_id e tipo são obrigatórios' }, 400)

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO requisitos_patente (patente_id, tipo, dias, curso_id, certificado_tipo, grupo_id, descricao)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    body.patente_id, body.tipo, body.dias ?? null, body.curso_id ?? null,
    body.certificado_tipo ?? null, body.grupo_id ?? null, body.descricao ?? null
  ).run()

  return c.json({ id: meta.last_row_id }, 201)
})

// DELETE /requisitos-patente/:id — remove de vez (não é histórico,
// pode apagar). Só admin.
requisitos.delete('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam requisitos' }, 403)

  await c.env.DB.prepare(`DELETE FROM requisitos_patente WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

export default requisitos
