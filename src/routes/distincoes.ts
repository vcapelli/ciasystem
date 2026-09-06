import { Hono } from 'hono'
import { conceder, tabelasDe, type TipoDistincao } from '../services/distincoes'

type Bindings = { DB: D1Database }

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId)
    .first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

/**
 * Monta um router idêntico pra Emblemas e Honrarias — o único
 * parâmetro que muda entre os dois é `tipo`.
 */
export function criarRotaDistincao(tipo: TipoDistincao) {
  const { catalogo, concessao, colunaId } = tabelasDe(tipo)
  const router = new Hono<{ Bindings: Bindings }>()

  router.post('/', async (c) => {
    const body = await c.req.json<{ titulo: string; descricao?: string; imagem_url: string; criado_por_id: number }>()

    if (!(await ehAdmin(c.env.DB, body.criado_por_id))) {
      return c.json({ erro: 'só administradores do sistema cadastram' }, 403)
    }

    const { meta } = await c.env.DB.prepare(
      `INSERT INTO ${catalogo} (titulo, descricao, imagem_url, criado_por_id) VALUES (?, ?, ?, ?)`
    )
      .bind(body.titulo, body.descricao ?? null, body.imagem_url, body.criado_por_id)
      .run()

    return c.json({ id: meta.last_row_id }, 201)
  })

  router.get('/', async (c) => {
    const { results } = await c.env.DB.prepare(`SELECT * FROM ${catalogo} WHERE ativo = 1`).all()
    return c.json(results)
  })

  router.post('/:id/conceder', async (c) => {
    const distincaoId = Number(c.req.param('id'))
    const body = await c.req.json<{
      usuario_id?: number
      grupo_id?: number
      concedido_por_id: number
      motivo?: string
    }>()

    if (!(await ehAdmin(c.env.DB, body.concedido_por_id))) {
      return c.json({ erro: 'só administradores do sistema concedem' }, 403)
    }
    if (!body.usuario_id && !body.grupo_id) {
      return c.json({ erro: 'informe usuario_id ou grupo_id' }, 400)
    }

    const alvo = body.usuario_id ? { usuarioId: body.usuario_id } : { grupoId: body.grupo_id! }
    const concedidos = await conceder(c.env.DB, tipo, distincaoId, alvo, body.concedido_por_id, body.motivo)

    return c.json({ concedido_a: concedidos })
  })

  router.get('/usuario/:usuarioId', async (c) => {
    const usuarioId = c.req.param('usuarioId')
    const { results } = await c.env.DB.prepare(
      `SELECT d.*, ud.concedido_em, ud.motivo
       FROM ${concessao} ud JOIN ${catalogo} d ON d.id = ud.${colunaId}
       WHERE ud.usuario_id = ?`
    )
      .bind(usuarioId)
      .all()
    return c.json(results)
  })

  return router
}
