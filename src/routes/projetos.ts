import { Hono } from 'hono'
import { notificar } from '../services/notificacoes'
import { registrarEvento } from '../services/logs'
import {
  buscarGrupoResponsavelProjetos,
  ehAdminDoGrupoResponsavel,
  ehMembroAtivoDoGrupo,
  podeVerProjetos,
  registrarHistoricoProjeto,
} from '../services/projetos'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const TIPOS_VALIDOS = ['projeto', 'proposta', 'correcao', 'sugestao'] as const
const STATUS_NAO_TERMINAL = ['aberto', 'em_analise', 'em_votacao', 'aguardando_implementacao'] as const

const projetos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const BASE_QUERY_PROJETOS = `
  SELECT p.*, a.nick AS autor_nick, a.tag AS autor_tag, r.nick AS responsavel_nick, r.tag AS responsavel_tag
  FROM projetos p
  LEFT JOIN usuarios a ON a.id = p.autor_id
  LEFT JOIN usuarios r ON r.id = p.responsavel_id
`

// POST /projetos — abre um novo processo. Autor é sempre o usuário
// autenticado. Exige que já exista um grupo responsável configurado
// (admin > Permissões > "Grupo responsável pelos projetos"), senão
// o processo nasceria sem ninguém pra vê-lo ou tocá-lo.
projetos.post('/', async (c) => {
  const autorId = c.get('usuarioId')
  const body = await c.req.json<{ tipo: string; titulo: string; descricao: string }>()

  if (!TIPOS_VALIDOS.includes(body.tipo as (typeof TIPOS_VALIDOS)[number])) {
    return c.json({ erro: 'tipo inválido — use projeto, proposta, correcao ou sugestao' }, 400)
  }
  if (!body.titulo?.trim() || !body.descricao?.trim()) {
    return c.json({ erro: 'título e descrição são obrigatórios' }, 400)
  }

  const grupoId = await buscarGrupoResponsavelProjetos(c.env.DB)
  if (!grupoId) {
    return c.json({ erro: 'nenhum grupo responsável pelos projetos foi configurado ainda — avise um administrador do sistema' }, 409)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO projetos (tipo, titulo, descricao, autor_id) VALUES (?, ?, ?, ?)`
  ).bind(body.tipo, body.titulo.trim(), body.descricao.trim(), autorId).run()

  const projetoId = Number(meta.last_row_id)
  const autor = await c.env.DB.prepare(`SELECT nick FROM usuarios WHERE id = ?`).bind(autorId).first<{ nick: string }>()
  await registrarHistoricoProjeto(c.env.DB, projetoId, `Processo aberto por ${autor?.nick || '—'}`, autorId)
  await registrarEvento(c.env.DB, autorId, 'projeto_criado', { referenciaTipo: 'projeto', referenciaId: projetoId, detalhes: { tipo: body.tipo } })

  return c.json({ id: projetoId }, 201)
})

// GET /projetos?status=&tipo= — só quem pode ver processos (membro
// ativo do grupo responsável, ou administrador do sistema).
projetos.get('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await podeVerProjetos(c.env.DB, usuarioId))) {
    return c.json({ erro: 'sem permissão para ver os processos' }, 403)
  }

  const status = c.req.query('status')
  const tipo = c.req.query('tipo')
  const condicoes: string[] = []
  const params: unknown[] = []
  if (status) { condicoes.push('p.status = ?'); params.push(status) }
  if (tipo) { condicoes.push('p.tipo = ?'); params.push(tipo) }
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''

  const { results } = await c.env.DB.prepare(`${BASE_QUERY_PROJETOS} ${where} ORDER BY p.criado_em DESC`)
    .bind(...params).all()

  return c.json(results)
})

// GET /projetos/:id — detalhe completo: processo + votos + histórico.
projetos.get('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await podeVerProjetos(c.env.DB, usuarioId))) {
    return c.json({ erro: 'sem permissão para ver este processo' }, 403)
  }

  const id = c.req.param('id')
  const projeto = await c.env.DB.prepare(`${BASE_QUERY_PROJETOS} WHERE p.id = ?`).bind(id).first()
  if (!projeto) return c.json({ erro: 'não encontrado' }, 404)

  const { results: votos } = await c.env.DB.prepare(
    `SELECT v.*, u.nick AS usuario_nick, u.tag AS usuario_tag FROM projeto_votos v
     LEFT JOIN usuarios u ON u.id = v.usuario_id WHERE v.projeto_id = ? ORDER BY v.criado_em ASC`
  ).bind(id).all()

  const { results: historico } = await c.env.DB.prepare(
    `SELECT h.*, u.nick AS criado_por_nick FROM projeto_historico h
     LEFT JOIN usuarios u ON u.id = h.criado_por_id WHERE h.projeto_id = ? ORDER BY h.criado_em ASC`
  ).bind(id).all()

  return c.json({ ...projeto, votos, historico })
})

// POST /projetos/:id/responsavel — define ou troca o responsável.
// Só administrador do grupo responsável (ou do sistema), em qualquer
// estado não terminal. O novo responsável precisa ser membro ativo do
// grupo — ele vai precisar votar/agir como tal mais adiante.
projetos.post('/:id/responsavel', async (c) => {
  const usuarioId = c.get('usuarioId')
  const id = c.req.param('id')
  const body = await c.req.json<{ usuario_id: number }>()

  if (!(await ehAdminDoGrupoResponsavel(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só um administrador do grupo responsável define o responsável do processo' }, 403)
  }

  const projeto = await c.env.DB.prepare(`SELECT status, responsavel_id FROM projetos WHERE id = ?`)
    .bind(id).first<{ status: string; responsavel_id: number | null }>()
  if (!projeto) return c.json({ erro: 'não encontrado' }, 404)
  if (!STATUS_NAO_TERMINAL.includes(projeto.status as (typeof STATUS_NAO_TERMINAL)[number])) {
    return c.json({ erro: 'processo já está arquivado ou concluído' }, 409)
  }

  const grupoId = await buscarGrupoResponsavelProjetos(c.env.DB)
  if (!grupoId || !(await ehMembroAtivoDoGrupo(c.env.DB, body.usuario_id, grupoId))) {
    return c.json({ erro: 'o responsável precisa ser membro ativo do grupo responsável pelos projetos' }, 400)
  }

  const novoResponsavel = await c.env.DB.prepare(`SELECT nick FROM usuarios WHERE id = ?`)
    .bind(body.usuario_id).first<{ nick: string }>()

  const novoStatus = projeto.status === 'aberto' ? 'em_analise' : projeto.status

  await c.env.DB.prepare(
    `UPDATE projetos SET responsavel_id = ?, responsavel_definido_por_id = ?,
       responsavel_definido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'), status = ?,
       atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ?`
  ).bind(body.usuario_id, usuarioId, novoStatus, id).run()

  const descricaoHistorico = projeto.responsavel_id
    ? `Responsável alterado para ${novoResponsavel?.nick || '—'}`
    : `Responsável definido: ${novoResponsavel?.nick || '—'}`
  await registrarHistoricoProjeto(c.env.DB, Number(id), descricaoHistorico, usuarioId)

  await notificar(c.env.DB, body.usuario_id, 'projeto_responsavel', 'Você foi designado responsável por um processo', {
    referenciaTipo: 'projeto', referenciaId: Number(id),
  })

  return c.json({ ok: true })
})

// POST /projetos/:id/parecer — só o responsável atual, só em em_analise.
// Abre a votação em seguida (o veredito aqui é só recomendação).
projetos.post('/:id/parecer', async (c) => {
  const usuarioId = c.get('usuarioId')
  const id = c.req.param('id')
  const body = await c.req.json<{ analise: string; parecer: string; veredito: 'aprova' | 'reprova' }>()

  if (!['aprova', 'reprova'].includes(body.veredito)) {
    return c.json({ erro: 'veredito precisa ser aprova ou reprova' }, 400)
  }
  if (!body.analise?.trim() || !body.parecer?.trim()) {
    return c.json({ erro: 'análise e parecer são obrigatórios' }, 400)
  }

  const projeto = await c.env.DB.prepare(`SELECT status, responsavel_id, autor_id FROM projetos WHERE id = ?`)
    .bind(id).first<{ status: string; responsavel_id: number | null; autor_id: number }>()
  if (!projeto) return c.json({ erro: 'não encontrado' }, 404)
  if (projeto.responsavel_id !== usuarioId) return c.json({ erro: 'só o responsável pelo processo posta o parecer' }, 403)
  if (projeto.status !== 'em_analise') return c.json({ erro: 'processo não está em análise' }, 409)

  await c.env.DB.prepare(
    `UPDATE projetos SET analise = ?, parecer = ?, veredito = ?,
       parecer_postado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
       status = 'em_votacao', votacao_aberta_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
       atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ?`
  ).bind(body.analise.trim(), body.parecer.trim(), body.veredito, id).run()

  await registrarHistoricoProjeto(c.env.DB, Number(id), `Análise e parecer postados (recomendação: ${body.veredito}) — votação aberta`, usuarioId)

  await notificar(c.env.DB, projeto.autor_id, 'projeto_status', 'Seu processo entrou em votação', {
    referenciaTipo: 'projeto', referenciaId: Number(id),
  })

  const grupoId = await buscarGrupoResponsavelProjetos(c.env.DB)
  if (grupoId) {
    const { results: membros } = await c.env.DB.prepare(
      `SELECT usuario_id FROM usuario_grupos WHERE grupo_id = ? AND ativo = 1`
    ).bind(grupoId).all<{ usuario_id: number }>()
    await Promise.all(membros.map((m) =>
      notificar(c.env.DB, m.usuario_id, 'projeto_votacao_aberta', 'Um processo está em votação', {
        referenciaTipo: 'projeto', referenciaId: Number(id),
      })
    ))
  }

  return c.json({ ok: true })
})

// POST /projetos/:id/votar — membro ativo do grupo responsável, só em
// em_votacao (inclui o próprio responsável). Upsert: permite trocar o
// voto enquanto a votação seguir aberta.
projetos.post('/:id/votar', async (c) => {
  const usuarioId = c.get('usuarioId')
  const id = c.req.param('id')
  const body = await c.req.json<{ voto: 'aprova' | 'reprova'; comentario?: string }>()

  if (!['aprova', 'reprova'].includes(body.voto)) {
    return c.json({ erro: 'voto precisa ser aprova ou reprova' }, 400)
  }

  const projeto = await c.env.DB.prepare(`SELECT status FROM projetos WHERE id = ?`)
    .bind(id).first<{ status: string }>()
  if (!projeto) return c.json({ erro: 'não encontrado' }, 404)
  if (projeto.status !== 'em_votacao') return c.json({ erro: 'este processo não está em votação' }, 409)

  const grupoId = await buscarGrupoResponsavelProjetos(c.env.DB)
  if (!grupoId || !(await ehMembroAtivoDoGrupo(c.env.DB, usuarioId, grupoId))) {
    return c.json({ erro: 'só membros ativos do grupo responsável pelos projetos votam' }, 403)
  }

  await c.env.DB.prepare(
    `INSERT INTO projeto_votos (projeto_id, usuario_id, voto, comentario) VALUES (?, ?, ?, ?)
     ON CONFLICT(projeto_id, usuario_id) DO UPDATE SET
       voto = excluded.voto, comentario = excluded.comentario,
       atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')`
  ).bind(id, usuarioId, body.voto, body.comentario || null).run()

  return c.json({ ok: true })
})

// POST /projetos/:id/encerrar-votacao — admin do grupo/sistema, só sem
// empate. Reprovado arquiva automaticamente; aprovado libera implementação.
projetos.post('/:id/encerrar-votacao', async (c) => {
  const usuarioId = c.get('usuarioId')
  const id = c.req.param('id')

  if (!(await ehAdminDoGrupoResponsavel(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só um administrador do grupo responsável encerra a votação' }, 403)
  }

  const projeto = await c.env.DB.prepare(`SELECT status, autor_id FROM projetos WHERE id = ?`)
    .bind(id).first<{ status: string; autor_id: number }>()
  if (!projeto) return c.json({ erro: 'não encontrado' }, 404)
  if (projeto.status !== 'em_votacao') return c.json({ erro: 'este processo não está em votação' }, 409)

  const contagem = await c.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN voto = 'aprova' THEN 1 ELSE 0 END) AS aprova,
       SUM(CASE WHEN voto = 'reprova' THEN 1 ELSE 0 END) AS reprova
     FROM projeto_votos WHERE projeto_id = ?`
  ).bind(id).first<{ aprova: number | null; reprova: number | null }>()
  const aprova = contagem?.aprova || 0
  const reprova = contagem?.reprova || 0

  if (aprova === 0 && reprova === 0) return c.json({ erro: 'ninguém votou ainda' }, 409)
  if (aprova === reprova) return c.json({ erro: 'votação empatada — aguarde mais um voto pra desempatar' }, 409)

  const resultado = aprova > reprova ? 'aprovado' : 'reprovado'
  const novoStatus = resultado === 'aprovado' ? 'aguardando_implementacao' : 'arquivado'

  await c.env.DB.prepare(
    `UPDATE projetos SET
       votacao_encerrada_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'), votacao_encerrada_por_id = ?,
       votacao_resultado = ?, status = ?,
       arquivado_em = CASE WHEN ? = 'arquivado' THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') ELSE arquivado_em END,
       motivo_arquivamento = CASE WHEN ? = 'arquivado' THEN ? ELSE motivo_arquivamento END,
       atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ?`
  ).bind(
    usuarioId, resultado, novoStatus, novoStatus, novoStatus,
    `Reprovado em votação (${aprova} aprova / ${reprova} reprova)`, id
  ).run()

  await registrarHistoricoProjeto(
    c.env.DB, Number(id),
    `Votação encerrada: ${resultado} (${aprova} aprova / ${reprova} reprova)`,
    usuarioId
  )

  await notificar(c.env.DB, projeto.autor_id, 'projeto_status',
    resultado === 'aprovado' ? 'Seu processo foi aprovado — aguardando implementação' : 'Seu processo foi reprovado e arquivado',
    { referenciaTipo: 'projeto', referenciaId: Number(id) }
  )

  return c.json({ ok: true, resultado })
})

// POST /projetos/:id/concluir — só o responsável atual, só em
// aguardando_implementacao.
projetos.post('/:id/concluir', async (c) => {
  const usuarioId = c.get('usuarioId')
  const id = c.req.param('id')
  const body = await c.req.json<{ implementacao_descricao: string }>()

  if (!body.implementacao_descricao?.trim()) {
    return c.json({ erro: 'descreva o que foi feito pra implementar o processo' }, 400)
  }

  const projeto = await c.env.DB.prepare(`SELECT status, responsavel_id, autor_id FROM projetos WHERE id = ?`)
    .bind(id).first<{ status: string; responsavel_id: number | null; autor_id: number }>()
  if (!projeto) return c.json({ erro: 'não encontrado' }, 404)
  if (projeto.responsavel_id !== usuarioId) return c.json({ erro: 'só o responsável pelo processo conclui a implementação' }, 403)
  if (projeto.status !== 'aguardando_implementacao') return c.json({ erro: 'processo não está aguardando implementação' }, 409)

  await c.env.DB.prepare(
    `UPDATE projetos SET implementacao_descricao = ?, concluido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
       status = 'concluido', atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ?`
  ).bind(body.implementacao_descricao.trim(), id).run()

  await registrarHistoricoProjeto(c.env.DB, Number(id), 'Implementação concluída — processo encerrado', usuarioId)

  await notificar(c.env.DB, projeto.autor_id, 'projeto_status', 'Seu processo foi concluído', {
    referenciaTipo: 'projeto', referenciaId: Number(id),
  })

  return c.json({ ok: true })
})

// POST /projetos/:id/arquivar — arquivamento manual, admin do grupo/
// sistema, em qualquer estado não terminal.
projetos.post('/:id/arquivar', async (c) => {
  const usuarioId = c.get('usuarioId')
  const id = c.req.param('id')
  const body = await c.req.json<{ motivo?: string }>().catch(() => ({}) as { motivo?: string })

  if (!(await ehAdminDoGrupoResponsavel(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só um administrador do grupo responsável arquiva um processo' }, 403)
  }

  const projeto = await c.env.DB.prepare(`SELECT status, autor_id FROM projetos WHERE id = ?`)
    .bind(id).first<{ status: string; autor_id: number }>()
  if (!projeto) return c.json({ erro: 'não encontrado' }, 404)
  if (!STATUS_NAO_TERMINAL.includes(projeto.status as (typeof STATUS_NAO_TERMINAL)[number])) {
    return c.json({ erro: 'processo já está arquivado ou concluído' }, 409)
  }

  await c.env.DB.prepare(
    `UPDATE projetos SET status = 'arquivado', arquivado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
       arquivado_por_id = ?, motivo_arquivamento = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ?`
  ).bind(usuarioId, body.motivo || null, id).run()

  await registrarHistoricoProjeto(c.env.DB, Number(id), `Processo arquivado manualmente${body.motivo ? `: ${body.motivo}` : ''}`, usuarioId)

  await notificar(c.env.DB, projeto.autor_id, 'projeto_status', 'Seu processo foi arquivado', {
    referenciaTipo: 'projeto', referenciaId: Number(id),
  })

  return c.json({ ok: true })
})

// POST /projetos/:id/desarquivar — admin do grupo/sistema, só quando
// arquivado. destino = pra onde o processo volta.
projetos.post('/:id/desarquivar', async (c) => {
  const usuarioId = c.get('usuarioId')
  const id = c.req.param('id')
  const body = await c.req.json<{ destino: 'aguardando_implementacao' | 'em_votacao' }>()

  if (!['aguardando_implementacao', 'em_votacao'].includes(body.destino)) {
    return c.json({ erro: 'destino precisa ser aguardando_implementacao ou em_votacao' }, 400)
  }
  if (!(await ehAdminDoGrupoResponsavel(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só um administrador do grupo responsável desarquiva um processo' }, 403)
  }

  const projeto = await c.env.DB.prepare(`SELECT status, autor_id FROM projetos WHERE id = ?`)
    .bind(id).first<{ status: string; autor_id: number }>()
  if (!projeto) return c.json({ erro: 'não encontrado' }, 404)
  if (projeto.status !== 'arquivado') return c.json({ erro: 'processo não está arquivado' }, 409)

  if (body.destino === 'em_votacao') {
    await c.env.DB.prepare(`DELETE FROM projeto_votos WHERE projeto_id = ?`).bind(id).run()
    await c.env.DB.prepare(
      `UPDATE projetos SET status = 'em_votacao', desarquivado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         desarquivado_por_id = ?, votacao_aberta_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         votacao_encerrada_em = NULL, votacao_encerrada_por_id = NULL, votacao_resultado = NULL,
         atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = ?`
    ).bind(usuarioId, id).run()
    await registrarHistoricoProjeto(c.env.DB, Number(id), 'Processo desarquivado — votação reiniciada', usuarioId)
  } else {
    await c.env.DB.prepare(
      `UPDATE projetos SET status = 'aguardando_implementacao', desarquivado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         desarquivado_por_id = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = ?`
    ).bind(usuarioId, id).run()
    await registrarHistoricoProjeto(c.env.DB, Number(id), 'Processo desarquivado — segue direto para aguardando implementação', usuarioId)
  }

  await notificar(c.env.DB, projeto.autor_id, 'projeto_status', 'Seu processo foi desarquivado', {
    referenciaTipo: 'projeto', referenciaId: Number(id),
  })

  return c.json({ ok: true })
})

export default projetos
