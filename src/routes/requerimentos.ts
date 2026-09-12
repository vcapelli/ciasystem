import { Hono } from 'hono'
import { gerarTagRequerimento, podeGerirRequerimento, acaoHierarquiaDoTipo } from '../services/requerimentos'
import { podeAgirSobre, possuiCompetenciaDePromotor } from '../services/hierarquia'
import { aplicarEfeitoAprovacao, recalcularStatusRequerimento } from '../services/efeitos'
import { notificar } from '../services/notificacoes'
import { registrarEvento } from '../services/logs'
import { buscarJogadorHabblet } from '../services/habblet'
import type { CriarRequerimentoInput } from '../types/requerimentos'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

// Esses tipos não passam por fila de aprovação — já entram aprovados
// (o "aprovador" na prática é o próprio autor, que atesta os requisitos
// no ato). Aprovar/reprovar/cancelar manualmente e excluir do histórico
// continuam exigindo permissão normal (ver podeGerirRequerimento) ou
// administrador_sistema.
const TIPOS_AUTO_APROVADOS = ['instrucao_inicial', 'contratacao', 'tag', 'venda_cargo']

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

  // Ninguém pode ser alvo do próprio requerimento (promover a si mesmo,
  // contratar a si mesmo, etc.) — exceto o tipo 'tag', que é o único
  // caso em que isso faz sentido (criar/alterar a própria TAG).
  if (body.tipo !== 'tag' && body.alvos.some((item) => item === autorId)) {
    return c.json({ erro: 'você não pode ser o alvo do próprio requerimento' }, 400)
  }

  // Contratação: sem ser administrador do sistema, só pode contratar
  // pra uma patente do Corpo Militar estritamente ABAIXO da sua própria
  // — nunca igual/superior à sua, e nunca no Corpo Executivo.
  if (body.tipo === 'contratacao' && !autor.administrador_sistema) {
    const patenteAutor = await c.env.DB.prepare(`SELECT ordem FROM patentes WHERE id = ?`)
      .bind(autor.patente_atual_id).first<{ ordem: number }>()
    const patenteDestinoId = (body.dados_especificos as { patente_destino_id?: number } | undefined)?.patente_destino_id
    const patenteDestino = patenteDestinoId
      ? await c.env.DB.prepare(`SELECT ordem, corpo FROM patentes WHERE id = ?`).bind(patenteDestinoId).first<{ ordem: number; corpo: string }>()
      : null

    if (!patenteDestino || patenteDestino.corpo !== 'militar') {
      return c.json({ erro: 'contratação sem ser administrador do sistema só é permitida pro Corpo Militar' }, 403)
    }
    if (!patenteAutor || patenteDestino.ordem >= patenteAutor.ordem) {
      return c.json({ erro: 'você não pode contratar alguém pra uma patente igual ou superior à sua' }, 403)
    }
  }

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

  const idsAlvosInseridos: number[] = []
  for (const item of body.alvos) {
    const insercao =
      typeof item === 'number'
        ? await c.env.DB.prepare(`INSERT INTO requerimento_alvos (requerimento_id, usuario_id) VALUES (?, ?)`)
            .bind(requerimentoId, item).run()
        : await c.env.DB.prepare(`INSERT INTO requerimento_alvos (requerimento_id, nick_alvo) VALUES (?, ?)`)
            .bind(requerimentoId, item).run()
    idsAlvosInseridos.push(Number(insercao.meta.last_row_id))
  }

  // Alguns tipos são auto-aprovados na criação — não passam por fila de
  // revisão (ex: Instrução Inicial já vem confirmada pelo instrutor).
  if (TIPOS_AUTO_APROVADOS.includes(body.tipo)) {
    for (const alvoId of idsAlvosInseridos) {
      try {
        const alvo = await c.env.DB.prepare(`SELECT usuario_id, nick_alvo FROM requerimento_alvos WHERE id = ?`)
          .bind(alvoId).first<{ usuario_id: number | null; nick_alvo: string | null }>()
        if (!alvo) continue

        const identificador = alvo.usuario_id !== null ? { usuarioId: alvo.usuario_id } : { nickAlvo: alvo.nick_alvo! }
        const dadosParaEfeito = {
          ...(body.dados_especificos ?? {}),
          ...(body.tipo === 'tag' && body.tag_aplicada ? { tag: body.tag_aplicada } : {}),
        }
        const efeito = await aplicarEfeitoAprovacao(c.env.DB, body.tipo, identificador, dadosParaEfeito)

        if (alvo.usuario_id === null) {
          await c.env.DB.prepare(`UPDATE requerimento_alvos SET usuario_id = ? WHERE id = ?`)
            .bind(efeito.usuarioId, alvoId).run()
        }

        await c.env.DB.prepare(
          `UPDATE requerimento_alvos SET status = 'aprovado', decidido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'), decidido_por_id = ? WHERE id = ?`
        ).bind(autorId, alvoId).run()

        await c.env.DB.prepare(
          `INSERT INTO historico (usuario_id, tipo_acao, requerimento_id, requerimento_alvo_id, executado_por_id, detalhes)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(efeito.usuarioId, body.tipo, requerimentoId, alvoId, autorId, JSON.stringify({ antes: efeito.antes, depois: efeito.depois })).run()
      } catch {
        // Se o efeito falhar (ex: nick já existe), deixa esse alvo
        // pendente pra revisão manual em vez de derrubar a criação
        // inteira — o requerimento já foi registrado.
      }
    }
    await recalcularStatusRequerimento(c.env.DB, Number(requerimentoId))
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

  const base = `
    SELECT r.*, u.nick AS autor_nick, u.tag AS autor_tag, p.nome AS autor_patente_nome, cr.nome AS crime_nome,
      (
        SELECT json_group_array(json_object(
          'id', ra.id,
          'nick', COALESCE(ua.nick, ra.nick_alvo),
          'status', ra.status,
          'decidido_em', ra.decidido_em,
          'decidido_por_nick', ud.nick,
          'motivo_recusa', ra.motivo_recusa,
          'patente_atual_id_agora', ua.patente_atual_id,
          'patente_antes_id', (
            SELECT json_extract(h.detalhes, '$.antes.patente_atual_id')
            FROM historico h WHERE h.requerimento_alvo_id = ra.id LIMIT 1
          )
        ))
        FROM requerimento_alvos ra
        LEFT JOIN usuarios ua ON ua.id = ra.usuario_id
        LEFT JOIN usuarios ud ON ud.id = ra.decidido_por_id
        WHERE ra.requerimento_id = r.id
      ) AS alvos_json
    FROM requerimentos r
    LEFT JOIN usuarios u ON u.id = r.autor_id
    LEFT JOIN patentes p ON p.id = u.patente_atual_id
    LEFT JOIN crimes cr ON cr.id = r.crime_id
  `

  const query = status
    ? c.env.DB.prepare(`${base} WHERE r.status = ? ORDER BY r.criado_em DESC LIMIT 50`).bind(status)
    : c.env.DB.prepare(`${base} ORDER BY r.criado_em DESC LIMIT 50`)

  const { results } = await query.all<{ autor_nick: string | null }>()

  // Busca a figure de cada autor distinto, em paralelo — o conjunto de
  // autores costuma ser bem menor que o de requerimentos.
  const nicksUnicos = [...new Set(results.map((r) => r.autor_nick).filter(Boolean))] as string[]
  const figurasPorNick: Record<string, string | null> = {}
  await Promise.all(
    nicksUnicos.map(async (nick) => {
      figurasPorNick[nick] = await buscarJogadorHabblet(nick).then((j) => j?.figure ?? null).catch(() => null)
    })
  )

  const comFigure = results.map((r) => ({ ...r, autor_figure: r.autor_nick ? figurasPorNick[r.autor_nick] ?? null : null }))

  return c.json(comFigure)
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

  const requerimento = await c.env.DB.prepare(`SELECT tipo, dados_especificos, tag_aplicada FROM requerimentos WHERE id = ?`)
    .bind(id).first<{ tipo: string; dados_especificos: string | null; tag_aplicada: string | null }>()
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
    const dadosEspecificos = requerimento.dados_especificos ? JSON.parse(requerimento.dados_especificos) : {}
    if (requerimento.tipo === 'tag' && requerimento.tag_aplicada) dadosEspecificos.tag = requerimento.tag_aplicada
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

// POST /requerimentos/:id/cancelar — cancela um requerimento inteiro
// (todos os alvos ainda não decididos passam pra 'cancelado'). Exige
// administrador_sistema OU permissão dedicada de cancelamento
// (requerimentos_permissoes, por usuário ou por grupo — configurável
// no futuro painel de admin).
// Reverte o efeito aplicado a UM alvo, usando o snapshot "antes"
// gravado no histórico no momento da aprovação. Usado tanto por
// cancelar (um requerimento já aprovado) quanto por excluir.
async function reverterEfeitoAlvo(db: D1Database, requerimentoId: string | number, alvoId: number, usuarioId: number | null) {
  if (usuarioId === null) return
  const registroHistorico = await db.prepare(
    `SELECT detalhes FROM historico WHERE requerimento_id = ? AND requerimento_alvo_id = ?`
  ).bind(requerimentoId, alvoId).first<{ detalhes: string | null }>()
  if (!registroHistorico?.detalhes) return

  try {
    const { antes } = JSON.parse(registroHistorico.detalhes) as {
      antes: { patente_atual_id: number; corpo: string; status: string; tag: string | null } | null
    }

    if (antes === null) {
      // Era uma porta de entrada (o usuário não existia antes deste
      // requerimento) — reverter significa desfazer a criação. Precisa
      // limpar as referências que apontam pra esse usuário primeiro
      // (historico.usuario_id e requerimento_alvos.usuario_id/
      // decidido_por_id não têm CASCADE), senão o DELETE falha calado.
      await db.prepare(`DELETE FROM historico WHERE usuario_id = ?`).bind(usuarioId).run()
      await db.prepare(`UPDATE requerimento_alvos SET usuario_id = NULL WHERE usuario_id = ?`).bind(usuarioId).run()
      await db.prepare(`UPDATE requerimento_alvos SET decidido_por_id = NULL WHERE decidido_por_id = ?`).bind(usuarioId).run()
      await db.prepare(`DELETE FROM usuarios WHERE id = ?`).bind(usuarioId).run()
    } else {
      await db.prepare(
        `UPDATE usuarios SET patente_atual_id = ?, corpo = ?, status = ?, tag = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
      ).bind(antes.patente_atual_id, antes.corpo, antes.status, antes.tag, usuarioId).run()
    }
  } catch {
    // Se reverter falhar (ex: usuário alterado por outra coisa depois),
    // segue em frente sem travar a operação do admin.
  }
}

requerimentos.post('/:id/cancelar', async (c) => {
  const usuarioId = c.get('usuarioId')
  const id = c.req.param('id')
  const { motivo } = await c.req.json<{ motivo?: string }>().catch(() => ({ motivo: undefined }))

  const usuario = await c.env.DB.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  if (!usuario) return c.json({ erro: 'usuário não encontrado' }, 404)

  const requerimento = await c.env.DB.prepare(`SELECT tipo FROM requerimentos WHERE id = ?`)
    .bind(id).first<{ tipo: string }>()
  if (!requerimento) return c.json({ erro: 'requerimento não encontrado' }, 404)

  if (!usuario.administrador_sistema) {
    const pode = await podeGerirRequerimento(c.env.DB, usuarioId, requerimento.tipo, 'cancelar')
    if (!pode) return c.json({ erro: 'sem permissão para cancelar requerimentos deste tipo' }, 403)
  }

  // Alvos já aprovados: reverte o efeito (volta pra como estava antes)
  // antes de marcar como cancelado. Alvos ainda pendentes: só cancela.
  const { results: alvosAprovados } = await c.env.DB.prepare(
    `SELECT id, usuario_id FROM requerimento_alvos WHERE requerimento_id = ? AND status = 'aprovado'`
  ).bind(id).all<{ id: number; usuario_id: number | null }>()

  for (const alvo of alvosAprovados) {
    await reverterEfeitoAlvo(c.env.DB, id, alvo.id, alvo.usuario_id)
  }

  await c.env.DB.prepare(
    `UPDATE requerimento_alvos SET status = 'cancelado', decidido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
       decidido_por_id = ?, motivo_recusa = ?
     WHERE requerimento_id = ? AND status IN ('pendente', 'aprovado')`
  ).bind(usuarioId, motivo ?? null, id).run()

  await recalcularStatusRequerimento(c.env.DB, Number(id))

  await registrarEvento(c.env.DB, usuarioId, 'requerimento_cancelado', {
    referenciaTipo: 'requerimento', referenciaId: Number(id), detalhes: { motivo },
  })

  return c.json({ ok: true })
})

// DELETE /requerimentos/:id — exclusão definitiva (some do histórico
// também). Só administrador_sistema — diferente de cancelar, que só
// muda o status e mantém o registro.
requerimentos.delete('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  const id = c.req.param('id')

  const usuario = await c.env.DB.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  if (!usuario?.administrador_sistema) {
    return c.json({ erro: 'só administradores do sistema podem excluir requerimentos do histórico' }, 403)
  }

  const requerimento = await c.env.DB.prepare(`SELECT id FROM requerimentos WHERE id = ?`).bind(id).first()
  if (!requerimento) return c.json({ erro: 'requerimento não encontrado' }, 404)

  // Reverte o efeito de cada alvo aprovado, usando o snapshot
  // "antes"/"depois" gravado no histórico no momento da aprovação —
  // sem isso a exclusão só apagaria o registro, mas deixaria a
  // mudança (patente, TAG, status etc.) aplicada pra sempre.
  const { results: alvosAprovados } = await c.env.DB.prepare(
    `SELECT id, usuario_id FROM requerimento_alvos WHERE requerimento_id = ? AND status = 'aprovado'`
  ).bind(id).all<{ id: number; usuario_id: number | null }>()

  for (const alvo of alvosAprovados) {
    await reverterEfeitoAlvo(c.env.DB, id, alvo.id, alvo.usuario_id)
  }

  // `historico` não tem ON DELETE CASCADE de propósito (é o registro
  // permanente) — apagar aqui é uma decisão explícita de admin.
  await c.env.DB.prepare(`DELETE FROM historico WHERE requerimento_id = ?`).bind(id).run()
  await c.env.DB.prepare(`DELETE FROM requerimentos WHERE id = ?`).bind(id).run()

  await registrarEvento(c.env.DB, usuarioId, 'requerimento_excluido', {
    referenciaTipo: 'requerimento', referenciaId: Number(id),
  })

  return c.json({ ok: true })
})

// GET /requerimentos/alvo/:usuarioId — linha do tempo de todos os
// requerimentos onde esse usuário foi alvo (pra página de perfil).
requerimentos.get('/alvo/:usuarioId', async (c) => {
  const usuarioId = c.req.param('usuarioId')

  const { results } = await c.env.DB.prepare(
    `SELECT ra.id AS alvo_id, ra.status, ra.decidido_em, ra.motivo_recusa,
            r.id AS requerimento_id, r.tipo, r.tag_requerimento, r.criado_em, r.tag_aplicada,
            au.nick AS autor_nick, au.tag AS autor_tag
     FROM requerimento_alvos ra
     JOIN requerimentos r ON r.id = ra.requerimento_id
     LEFT JOIN usuarios au ON au.id = r.autor_id
     WHERE ra.usuario_id = ?
     ORDER BY r.criado_em DESC
     LIMIT 100`
  ).bind(usuarioId).all()

  return c.json(results)
})

export default requerimentos
