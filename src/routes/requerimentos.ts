import { Hono } from 'hono'
import { gerarTagRequerimento, podeGerirRequerimento, acaoHierarquiaDoTipo } from '../services/requerimentos'
import { podeAgirSobre } from '../services/hierarquia'
import { aplicarEfeitoAprovacao, recalcularStatusRequerimento } from '../services/efeitos'
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

  const autor = await c.env.DB.prepare(
    `SELECT patente_atual_id, administrador_sistema FROM usuarios WHERE id = ?`
  ).bind(body.autor_id).first<{ patente_atual_id: number; administrador_sistema: number }>()

  if (!autor) return c.json({ erro: 'autor não encontrado' }, 404)

  // Checagem de hierarquia — só se aplica a tipos que representam uma
  // ação sobre a patente/status de outro usuário (promoção,
  // rebaixamento, advertência, desligamento, exoneração, licença).
  // Bypass total pra administrador_sistema.
  const acao = acaoHierarquiaDoTipo(body.tipo)
  if (acao && !autor.administrador_sistema) {
    for (const alvoId of body.alvos) {
      const alvo = await c.env.DB.prepare(`SELECT patente_atual_id FROM usuarios WHERE id = ?`)
        .bind(alvoId)
        .first<{ patente_atual_id: number }>()

      if (!alvo) return c.json({ erro: `alvo ${alvoId} não encontrado` }, 404)

      const { permitido, requerCfoOuPro } = await podeAgirSobre(
        c.env.DB,
        acao,
        autor.patente_atual_id,
        alvo.patente_atual_id
      )

      if (!permitido) {
        return c.json({ erro: `sem competência hierárquica para '${acao}' sobre o alvo ${alvoId}` }, 403)
      }

      if (requerCfoOuPro) {
        // TODO: checar se o autor tem PRO (Militar) ou CFO ativo
        // (Executivo) em `certificados` antes de liberar. Deixado
        // como TODO porque depende da Fase 4 (certificados) existir
        // com dado populado.
      }
    }
  }

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

  for (const usuarioId of body.alvos) {
    await c.env.DB.prepare(
      `INSERT INTO requerimento_alvos (requerimento_id, usuario_id) VALUES (?, ?)`
    )
      .bind(requerimentoId, usuarioId)
      .run()
  }

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

  const decisor = await c.env.DB.prepare(
    `SELECT administrador_sistema FROM usuarios WHERE id = ?`
  ).bind(decidido_por_id).first<{ administrador_sistema: number }>()

  if (!decisor) return c.json({ erro: 'usuário decisor não encontrado' }, 404)

  const requerimento = await c.env.DB.prepare(`SELECT tipo, dados_especificos FROM requerimentos WHERE id = ?`)
    .bind(id)
    .first<{ tipo: string; dados_especificos: string | null }>()

  if (!requerimento) return c.json({ erro: 'requerimento não encontrado' }, 404)

  if (!decisor.administrador_sistema) {
    const pode = await podeGerirRequerimento(c.env.DB, decidido_por_id, requerimento.tipo, 'aprovar')
    if (!pode) return c.json({ erro: 'sem permissão para gerir requerimentos deste tipo' }, 403)
  }

  const alvo = await c.env.DB.prepare(`SELECT usuario_id FROM requerimento_alvos WHERE id = ? AND requerimento_id = ?`)
    .bind(alvoId, id)
    .first<{ usuario_id: number }>()

  if (!alvo) return c.json({ erro: 'alvo não encontrado neste requerimento' }, 404)

  let detalhesHistorico: unknown = null

  // Aplica o efeito ANTES de confirmar a aprovação — se der erro (ex:
  // faltou patente_destino_id), não marca nada como aprovado.
  if (status === 'aprovado') {
    const dadosEspecificos = requerimento.dados_especificos ? JSON.parse(requerimento.dados_especificos) : null
    try {
      detalhesHistorico = await aplicarEfeitoAprovacao(c.env.DB, requerimento.tipo, alvo.usuario_id, dadosEspecificos)
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : 'erro ao aplicar efeito do requerimento'
      return c.json({ erro: mensagem }, 400)
    }
  }

  await c.env.DB.prepare(
    `UPDATE requerimento_alvos
     SET status = ?, decidido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'), decidido_por_id = ?, motivo_recusa = ?
     WHERE id = ? AND requerimento_id = ?`
  )
    .bind(status, decidido_por_id, motivo_recusa ?? null, alvoId, id)
    .run()

  // Historico só espelha ações efetivamente aprovadas (nunca reprovadas).
  if (status === 'aprovado') {
    await c.env.DB.prepare(
      `INSERT INTO historico (usuario_id, tipo_acao, requerimento_id, requerimento_alvo_id, executado_por_id, detalhes)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(alvo.usuario_id, requerimento.tipo, id, alvoId, decidido_por_id, JSON.stringify(detalhesHistorico))
      .run()
  }

  const statusGeral = await recalcularStatusRequerimento(c.env.DB, Number(id))

  // TODO: dispara logs_eventos ('requerimento_decidido', ...)

  return c.json({ ok: true, status_alvo: status, status_geral: statusGeral })
})

export default requerimentos
