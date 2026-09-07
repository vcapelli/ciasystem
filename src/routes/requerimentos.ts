import { Hono } from 'hono'
import { gerarTagRequerimento, podeGerirRequerimento, acaoHierarquiaDoTipo } from '../services/requerimentos'
import { podeAgirSobre, possuiCompetenciaDePromotor } from '../services/hierarquia'
import { aplicarEfeitoAprovacao, recalcularStatusRequerimento } from '../services/efeitos'
import { notificar } from '../services/notificacoes'
import { registrarEvento } from '../services/logs'
import type { CriarRequerimentoInput } from '../types/requerimentos'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const requerimentos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// POST /requerimentos — cria um requerimento com N alvos (+ anexos, se houver).
// autor_id é sempre o usuário autenticado (nunca vem do corpo).
requerimentos.post('/', async (c) => {
  const autorId = c.get('usuarioId')
  const body = await c.req.json<CriarRequerimentoInput>()

  if (!body.tipo || !body.alvos?.length) {
    return c.json({ erro: 'tipo e ao menos 1 alvo são obrigatórios' }, 400)
  }

  const autor = await c.env.DB.prepare(
    `SELECT patente_atual_id, corpo, administrador_sistema FROM usuarios WHERE id = ?`
  ).bind(autorId).first<{ patente_atual_id: number; corpo: string; administrador_sistema: number }>()

  if (!autor) return c.json({ erro: 'autor não encontrado' }, 404)

  const acao = acaoHierarquiaDoTipo(body.tipo)
  if (acao && !autor.administrador_sistema) {
    for (const item of body.alvos) {
      if (typeof item !== 'number') {
        return c.json({ erro: `tipo '${body.tipo}' não aceita alvo por nick — usuário precisa já existir` }, 400)
      }
      const alvo = await c.env.DB.prepare(`SELECT patente_atual_id FROM usuarios WHERE id = ?`)
        .bind(item)
        .first<{ patente_atual_id: number }>()

      if (!alvo) return c.json({ erro: `alvo ${item} não encontrado` }, 404)

      const { permitido, requerCfoOuPro } = await podeAgirSobre(c.env.DB, acao, autor.patente_atual_id, alvo.patente_atual_id)

      if (!permitido) {
        return c.json({ erro: `sem competência hierárquica para '${acao}' sobre o alvo ${item}` }, 403)
      }

      if (requerCfoOuPro) {
        const temCompetencia = await possuiCompetenciaDePromotor(c.env.DB, autorId, autor.corpo)
        if (!temCompetencia) {
          const exigido = autor.corpo === 'militar' ? 'PRO (Aula para Promotor)' : 'CFO ativo'
          return c.json({ erro: `autor não possui ${exigido}, exigido pra exercer competência de promotor` }, 403)
        }
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
      autorId,
      tagRequerimento,
      body.dados_especificos ? JSON.stringify(body.dados_especificos) : null,
      body.crime_id ?? null,
      body.fundamentacao ?? null,
      body.autorizado_por_id ?? null,
      body.tag_aplicada ?? null
    )
    .run()

  const requerimentoId = meta.last_row_id

  for (const item of body.alvos) {
    if (typeof item === 'number') {
      await c.env.DB.prepare(`INSERT INTO requerimento_alvos (requerimento_id, usuario_id) VALUES (?, ?)`)
        .bind(requerimentoId, item).run()
    } else {
      await c.env.DB.prepare(`INSERT INTO requerimento_alvos (requerimento_id, nick_alvo) VALUES (?, ?)`)
        .bind(requerimentoId, item).run()
    }
  }

  if (body.anexos?.length) {
    for (const [ordem, url] of body.anexos.entries()) {
      await c.env.DB.prepare(`INSERT INTO requerimento_anexos (requerimento_id, url, ordem) VALUES (?, ?, ?)`)
        .bind(requerimentoId, url, ordem).run()
    }
  }

  await registrarEvento(c.env.DB, autorId, 'requerimento_criado', {
    referenciaTipo: 'requerimento',
    referenciaId: Number(requerimentoId),
    detalhes: { tipo: body.tipo, alvos: body.alvos },
  })

  return c.json({ id: requerimentoId, tag_requerimento: tagRequerimento }, 201)
})

requerimentos.get('/', async (c) => {
  const status = c.req.query('status')
  const query = status
    ? c.env.DB.prepare(`SELECT * FROM requerimentos WHERE status = ? ORDER BY criado_em DESC`).bind(status)
    : c.env.DB.prepare(`SELECT * FROM requerimentos ORDER BY criado_em DESC`)
  const { results } = await query.all()
  return c.json(results)
})

requerimentos.get('/:id', async (c) => {
  const id = c.req.param('id')

  const requerimento = await c.env.DB.prepare(`SELECT * FROM requerimentos WHERE id = ?`).bind(id).first()
  if (!requerimento) return c.json({ erro: 'não encontrado' }, 404)

  const { results: alvos } = await c.env.DB.prepare(`SELECT * FROM requerimento_alvos WHERE requerimento_id = ?`).bind(id).all()
  const { results: anexos } = await c.env.DB.prepare(`SELECT * FROM requerimento_anexos WHERE requerimento_id = ? ORDER BY ordem`).bind(id).all()

  return c.json({ ...requerimento, alvos, anexos })
})

// POST /requerimentos/:id/alvos/:alvoId/decidir — quem decide é sempre
// o usuário autenticado.
requerimentos.post('/:id/alvos/:alvoId/decidir', async (c) => {
  const decididoPorId = c.get('usuarioId')
  const { id, alvoId } = c.req.param()
  const { status, motivo_recusa } = await c.req.json<{ status: 'aprovado' | 'reprovado'; motivo_recusa?: string }>()

  const decisor = await c.env.DB.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(decididoPorId).first<{ administrador_sistema: number }>()
  if (!decisor) return c.json({ erro: 'usuário decisor não encontrado' }, 404)

  const requerimento = await c.env.DB.prepare(`SELECT tipo, dados_especificos FROM requerimentos WHERE id = ?`)
    .bind(id).first<{ tipo: string; dados_especificos: string | null }>()
  if (!requerimento) return c.json({ erro: 'requerimento não encontrado' }, 404)

  if (!decisor.administrador_sistema) {
    const pode = await podeGerirRequerimento(c.env.DB, decididoPorId, requerimento.tipo, 'aprovar')
    if (!pode) return c.json({ erro: 'sem permissão para gerir requerimentos deste tipo' }, 403)
  }

  const alvo = await c.env.DB.prepare(`SELECT usuario_id, nick_alvo FROM requerimento_alvos WHERE id = ? AND requerimento_id = ?`)
    .bind(alvoId, id).first<{ usuario_id: number | null; nick_alvo: string | null }>()
  if (!alvo) return c.json({ erro: 'alvo não encontrado neste requerimento' }, 404)

  let detalhesHistorico: unknown = null
  let usuarioIdFinal: number | null = alvo.usuario_id

  if (status === 'aprovado') {
    const dadosEspecificos = requerimento.dados_especificos ? JSON.parse(requerimento.dados_especificos) : null
    const identificador = alvo.usuario_id !== null ? { usuarioId: alvo.usuario_id } : { nickAlvo: alvo.nick_alvo! }

    try {
      const efeito = await aplicarEfeitoAprovacao(c.env.DB, requerimento.tipo, identificador, dadosEspecificos)
      detalhesHistorico = { antes: efeito.antes, depois: efeito.depois }
      usuarioIdFinal = efeito.usuarioId

      if (alvo.usuario_id === null) {
        await c.env.DB.prepare(`UPDATE requerimento_alvos SET usuario_id = ? WHERE id = ?`)
          .bind(usuarioIdFinal, alvoId).run()
      }
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : 'erro ao aplicar efeito do requerimento'
      return c.json({ erro: mensagem }, 400)
    }
  }

  await c.env.DB.prepare(
    `UPDATE requerimento_alvos
     SET status = ?, decidido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'), decidido_por_id = ?, motivo_recusa = ?
     WHERE id = ? AND requerimento_id = ?`
  ).bind(status, decididoPorId, motivo_recusa ?? null, alvoId, id).run()

  if (status === 'aprovado' && usuarioIdFinal !== null) {
    await c.env.DB.prepare(
      `INSERT INTO historico (usuario_id, tipo_acao, requerimento_id, requerimento_alvo_id, executado_por_id, detalhes)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(usuarioIdFinal, requerimento.tipo, id, alvoId, decididoPorId, JSON.stringify(detalhesHistorico)).run()
  }

  const statusGeral = await recalcularStatusRequerimento(c.env.DB, Number(id))

  if (usuarioIdFinal !== null) {
    await notificar(c.env.DB, usuarioIdFinal, 'requerimento_status', `Seu requerimento foi ${status}`, {
      referenciaTipo: 'requerimento',
      referenciaId: Number(id),
    })
  }

  await registrarEvento(c.env.DB, decididoPorId, `requerimento_${status}`, {
    referenciaTipo: 'requerimento',
    referenciaId: Number(id),
    detalhes: { tipo: requerimento.tipo, alvo_id: alvoId, usuario_id: usuarioIdFinal },
  })

  return c.json({ ok: true, status_alvo: status, status_geral: statusGeral, usuario_id: usuarioIdFinal })
})

export default requerimentos
