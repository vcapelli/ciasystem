import { Hono } from 'hono'
import { ehAdminDoGrupo } from '../services/grupos'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const cursos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

cursos.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM cursos ORDER BY nome`).all()
  return c.json(results)
})

cursos.post('/historico', async (c) => {
  const certificadoPorId = c.get('usuarioId')
  const body = await c.req.json<{ usuario_id: number; curso_id: number; data_conclusao: string }>()

  const curso = await c.env.DB.prepare(`SELECT id, grupo_responsavel_id FROM cursos WHERE id = ?`)
    .bind(body.curso_id).first<{ id: number; grupo_responsavel_id: number | null }>()
  if (!curso) return c.json({ erro: 'curso não encontrado' }, 404)

  if (body.usuario_id === certificadoPorId) {
    const podeAutoConceder = curso.grupo_responsavel_id !== null
      ? await ehAdminDoGrupo(c.env.DB, certificadoPorId, curso.grupo_responsavel_id)
      : await ehAdmin(c.env.DB, certificadoPorId)
    if (!podeAutoConceder) {
      return c.json({ erro: 'você não pode conceder curso a si mesmo' }, 403)
    }
  }

  if (curso.grupo_responsavel_id !== null) {
    if (!(await ehAdminDoGrupo(c.env.DB, certificadoPorId, curso.grupo_responsavel_id))) {
      return c.json({ erro: 'só administradores do grupo responsável concedem este curso' }, 403)
    }
  } else {
    if (!(await ehAdmin(c.env.DB, certificadoPorId))) {
      return c.json({ erro: 'só administradores do sistema concedem este curso' }, 403)
    }
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO historico_cursos (usuario_id, curso_id, data_conclusao, certificado_por_id) VALUES (?, ?, ?, ?)`
  ).bind(body.usuario_id, body.curso_id, body.data_conclusao, certificadoPorId).run()

  return c.json({ id: meta.last_row_id }, 201)
})

cursos.get('/usuario/:usuarioId/historico', async (c) => {
  const usuarioId = c.req.param('usuarioId')
  const { results } = await c.env.DB.prepare(
    `SELECT hc.*, c.codigo, c.nome AS curso_nome
     FROM historico_cursos hc JOIN cursos c ON c.id = hc.curso_id
     WHERE hc.usuario_id = ? ORDER BY hc.data_conclusao DESC`
  ).bind(usuarioId).all()
  return c.json(results)
})

cursos.post('/certificados', async (c) => {
  const concedidoPorId = c.get('usuarioId')

  if (!(await ehAdmin(c.env.DB, concedidoPorId))) {
    return c.json({ erro: 'só administradores do sistema concedem certificados' }, 403)
  }

  const body = await c.req.json<{ usuario_id: number; tipo: 'CFO' | 'CQ' | 'CCJ'; data_concessao: string; valido_ate?: string }>()

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO certificados (usuario_id, tipo, concedido_por_id, data_concessao, valido_ate)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(body.usuario_id, body.tipo, concedidoPorId, body.data_concessao, body.valido_ate ?? null).run()

  return c.json({ id: meta.last_row_id }, 201)
})

cursos.get('/usuario/:usuarioId/certificados', async (c) => {
  const usuarioId = c.req.param('usuarioId')
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM certificados WHERE usuario_id = ? AND ativo = 1 ORDER BY data_concessao DESC`
  ).bind(usuarioId).all()
  return c.json(results)
})

export default cursos
