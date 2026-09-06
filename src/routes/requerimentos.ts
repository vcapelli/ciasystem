import { Hono } from 'hono'
import { gerarTagRequerimento } from '../services/requerimentos'
import type { CriarRequerimentoInput } from '../types/requerimentos'

type Bindings = {
  DB: D1Database
}

const requerimentos = new Hono<{ Bindings: Bindings }>()

// POST /requerimentos — cria um requerimento com N alvos (+ anexos, se houver)
requerimentos.post('/', async (c) => {
  const body = await c.req.json<CriarRequerimentoInput>()

  if (!body.tipo || !body.autor_id || !body.alvos?.length) {
    return c.json({ erro: 'tipo, autor_id e ao menos 1 alvo são obrigatórios' }, 400)
  }

  // TODO: checar requerimentos_permissoes / diretrizes_hierarquia
  // antes de criar, conforme o tipo (ex: só quem tem PRO/CFO cria
  // promoção; ver services/requerimentos.ts).

  const tagRequerimento = gerarTagRequerimento(body.tipo)

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO requerimentos
      (tipo, autor_id, tag_requerimento, dados_especificos, crime_id, fundamentacao, autorizado_por_id, tag_aplicada)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.tipo,
      body.autor_id,
      tagRequerimento,
      body.dados_especificos ? JSON.stringify(body.dados_especificos) : null,
      body.crime_id ?? null,
      body.fundamentacao ?? null,
      body.autorizado_por_id ?? null,
      body.tag_aplicada ?? null
    )
    .run()

  const requerimentoId = meta.last_row_id

  // 1 linha em requerimento_alvos por alvo informado
  for (const usuarioId of body.alvos) {
    await c.env.DB.prepare(
      `INSERT INTO requerimento_alvos (requerimento_id, usuario_id) VALUES (?, ?)`
    )
      .bind(requerimentoId, usuarioId)
      .run()
  }

  // anexos de prova/imagem, se houver
  if (body.anexos?.length) {
    for (const [ordem, url] of body.anexos.entries()) {
      await c.env.DB.prepare(
        `INSERT INTO requerimento_anexos (requerimento_id, url, ordem) VALUES (?, ?, ?)`
      )
        .bind(requerimentoId, url, ordem)
        .run()
    }
  }

  // TODO: dispara logs_eventos ('requerimento_criado', referencia_tipo='requerimento', referencia_id=requerimentoId)

  return c.json({ id: requerimentoId, tag_requerimento: tagRequerimento }, 201)
})

// GET /requerimentos?status=pendente — lista com os alvos aninhados
requerimentos.get('/', async (c) => {
  const status = c.req.query('status')

  const query = status
    ? c.env.DB.prepare(`SELECT * FROM requerimentos WHERE status = ? ORDER BY criado_em DESC`).bind(status)
    : c.env.DB.prepare(`SELECT * FROM requerimentos ORDER BY criado_em DESC`)

  const { results } = await query.all()
  return c.json(results)
})

// GET /requerimentos/:id — detalhe com alvos e anexos
requerimentos.get('/:id', async (c) => {
  const id = c.req.param('id')

  const requerimento = await c.env.DB.prepare(`SELECT * FROM requerimentos WHERE id = ?`).bind(id).first()
  if (!requerimento) return c.json({ erro: 'não encontrado' }, 404)

  const { results: alvos } = await c.env.DB.prepare(
    `SELECT * FROM requerimento_alvos WHERE requerimento_id = ?`
  ).bind(id).all()

  const { results: anexos } = await c.env.DB.prepare(
    `SELECT * FROM requerimento_anexos WHERE requerimento_id = ? ORDER BY ordem`
  ).bind(id).all()

  return c.json({ ...requerimento, alvos, anexos })
})

// POST /requerimentos/:id/alvos/:alvoId/decidir — aprova/reprova 1 alvo específico
requerimentos.post('/:id/alvos/:alvoId/decidir', async (c) => {
  const { id, alvoId } = c.req.param()
  const { status, decidido_por_id, motivo_recusa } = await c.req.json<{
    status: 'aprovado' | 'reprovado'
    decidido_por_id: number
    motivo_recusa?: string
  }>()

  // TODO: checar requerimentos_permissoes.pode_aprovar antes de seguir.

  await c.env.DB.prepare(
    `UPDATE requerimento_alvos
     SET status = ?, decidido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'), decidido_por_id = ?, motivo_recusa = ?
     WHERE id = ? AND requerimento_id = ?`
  )
    .bind(status, decidido_por_id, motivo_recusa ?? null, alvoId, id)
    .run()

  // TODO: se status = 'aprovado' → gravar em `historico` + aplicar o
  // efeito real (mudar patente/status do usuário etc, conforme o tipo).
  // TODO: recalcular requerimentos.status geral a partir dos alvos
  // (ex: só vira 'aprovado' quando todos os alvos estiverem decididos).

  return c.json({ ok: true })
})

export default requerimentos
