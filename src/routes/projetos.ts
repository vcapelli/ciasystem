import { Hono } from 'hono'
import { notificar } from '../services/notificacoes'
import { registrarEvento } from '../services/logs'
import type { D1Like } from '../types/db'
import {
  buscarGrupoResponsavelProjetos,
  contarVotantesElegiveisProjetos,
  contarVotosElegiveisProjeto,
  ehAdminDoGrupoResponsavel,
  ehMembroAtivoDoGrupo,
  fecharVotacaoProjeto,
  podeVerProjetos,
  podeVotarProjetos,
  registrarHistoricoProjeto,
} from '../services/projetos'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const TIPOS_VALIDOS = ['projeto', 'proposta', 'correcao', 'sugestao'] as const
const STATUS_NAO_TERMINAL = ['aberto', 'em_analise', 'em_votacao', 'aguardando_implementacao'] as const

// Cada handler cria sua própria D1 Session ancorada em 'first-primary'
// (`c.env.DB.withSession('first-primary')`) em vez de usar `c.env.DB`
// direto. Sem isso, uma leitura de status logo depois de uma escrita
// recente (ex: postar o parecer segundos depois de definir o
// responsável) podia acertar uma réplica D1 ainda desatualizada e
// devolver 409 "processo não está em análise" mesmo já estando —
// resolvido sozinho num F5 porque a réplica alcança o primary em
// pouco tempo. 'first-primary' força a primeira leitura da sessão a
// ir direto no primary, então nunca mais vê esse estado velho.
//
// Consequência importante: dentro da MESMA sessão, as queries têm que
// rodar em sequência (await um de cada vez), nunca em paralelo via
// Promise.all — disparar várias .run()/.all() concorrentes na mesma
// D1Session pode devolver "erro interno do servidor" (500) de forma
// intermitente, mesmo com as escritas tendo sido aplicadas com sucesso
// (por isso um F5 depois mostra tudo certo). Sempre usar um loop
// for...of com await dentro, nunca .map() + Promise.all, quando o
// mesmo `db` (sessão) for reutilizado pra várias queries de uma vez.
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
  const db = c.env.DB.withSession('first-primary') // ver nota sobre réplicas D1 no topo do arquivo
  const body = await c.req.json<{ tipo: string; titulo: string; descricao: string }>()

  if (!TIPOS_VALIDOS.includes(body.tipo as (typeof TIPOS_VALIDOS)[number])) {
    return c.json({ erro: 'tipo inválido — use projeto, proposta, correcao ou sugestao' }, 400)
  }
  if (!body.titulo?.trim() || !body.descricao?.trim()) {
    return c.json({ erro: 'título e descrição são obrigatórios' }, 400)
  }

  const grupoId = await buscarGrupoResponsavelProjetos(db)
  if (!grupoId) {
    return c.json({ erro: 'nenhum grupo responsável pelos projetos foi configurado ainda — avise um administrador do sistema' }, 409)
  }

  const { meta } = await db.prepare(
    `INSERT INTO projetos (tipo, titulo, descricao, autor_id) VALUES (?, ?, ?, ?)`
  ).bind(body.tipo, body.titulo.trim(), body.descricao.trim(), autorId).run()

  const projetoId = Number(meta.last_row_id)
  const autor = await db.prepare(`SELECT nick FROM usuarios WHERE id = ?`).bind(autorId).first<{ nick: string }>()
  await registrarHistoricoProjeto(db, projetoId, `Processo aberto por ${autor?.nick || '—'}`, autorId)
  await registrarEvento(db, autorId, 'projeto_criado', { referenciaTipo: 'projeto', referenciaId: projetoId, detalhes: { tipo: body.tipo } })

  return c.json({ id: projetoId }, 201)
})

// GET /projetos?status=&tipo= — só quem pode ver processos (membro
// ativo do grupo responsável, ou administrador do sistema).
projetos.get('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  const db = c.env.DB.withSession('first-primary') // ver nota sobre réplicas D1 no topo do arquivo
  if (!(await podeVerProjetos(db, usuarioId))) {
    return c.json({ erro: 'sem permissão para ver os processos' }, 403)
  }

  const status = c.req.query('status')
  const tipo = c.req.query('tipo')
  const condicoes: string[] = []
  const params: unknown[] = []
  if (status) { condicoes.push('p.status = ?'); params.push(status) }
  if (tipo) { condicoes.push('p.tipo = ?'); params.push(tipo) }
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''

  const { results } = await db.prepare(`${BASE_QUERY_PROJETOS} ${where} ORDER BY p.criado_em DESC`)
    .bind(...params).all()

  return c.json(results)
})

// GET /projetos/:id — detalhe completo: processo + votos + histórico.
projetos.get('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  const db = c.env.DB.withSession('first-primary') // ver nota sobre réplicas D1 no topo do arquivo
  if (!(await podeVerProjetos(db, usuarioId))) {
    return c.json({ erro: 'sem permissão para ver este processo' }, 403)
  }

  const id = c.req.param('id')
  const projeto = await db.prepare(`${BASE_QUERY_PROJETOS} WHERE p.id = ?`).bind(id).first()
  if (!projeto) return c.json({ erro: 'não encontrado' }, 404)

  const { results: votos } = await db.prepare(
    `SELECT v.*, u.nick AS usuario_nick, u.tag AS usuario_tag FROM projeto_votos v
     LEFT JOIN usuarios u ON u.id = v.usuario_id WHERE v.projeto_id = ? ORDER BY v.criado_em ASC`
  ).bind(id).all()

  const { results: historico } = await db.prepare(
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
  const db = c.env.DB.withSession('first-primary') // ver nota sobre réplicas D1 no topo do arquivo
  const id = c.req.param('id')
  const body = await c.req.json<{ usuario_id: number }>()

  if (!(await ehAdminDoGrupoResponsavel(db, usuarioId))) {
    return c.json({ erro: 'só um administrador do grupo responsável define o responsável do processo' }, 403)
  }

  const projeto = await db.prepare(`SELECT status, responsavel_id FROM projetos WHERE id = ?`)
    .bind(id).first<{ status: string; responsavel_id: number | null }>()
  if (!projeto) return c.json({ erro: 'não encontrado' }, 404)
  if (!STATUS_NAO_TERMINAL.includes(projeto.status as (typeof STATUS_NAO_TERMINAL)[number])) {
    return c.json({ erro: 'processo já está arquivado ou concluído' }, 409)
  }

  const grupoId = await buscarGrupoResponsavelProjetos(db)
  if (!grupoId || !(await ehMembroAtivoDoGrupo(db, body.usuario_id, grupoId))) {
    return c.json({ erro: 'o responsável precisa ser membro ativo do grupo responsável pelos projetos' }, 400)
  }

  const novoResponsavel = await db.prepare(`SELECT nick FROM usuarios WHERE id = ?`)
    .bind(body.usuario_id).first<{ nick: string }>()

  const novoStatus = projeto.status === 'aberto' ? 'em_analise' : projeto.status

  await db.prepare(
    `UPDATE projetos SET responsavel_id = ?, responsavel_definido_por_id = ?,
       responsavel_definido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'), status = ?,
       atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ?`
  ).bind(body.usuario_id, usuarioId, novoStatus, id).run()

  const descricaoHistorico = projeto.responsavel_id
    ? `Responsável alterado para ${novoResponsavel?.nick || '—'}`
    : `Responsável definido: ${novoResponsavel?.nick || '—'}`
  await registrarHistoricoProjeto(db, Number(id), descricaoHistorico, usuarioId)

  await notificar(db, body.usuario_id, 'projeto_responsavel', 'Você foi designado responsável por um processo', {
    referenciaTipo: 'projeto', referenciaId: Number(id),
  })

  return c.json({ ok: true })
})

// POST /projetos/:id/parecer — só o responsável atual, só em em_analise.
// Abre a votação em seguida (o veredito aqui é só recomendação).
projetos.post('/:id/parecer', async (c) => {
  const usuarioId = c.get('usuarioId')
  const db = c.env.DB.withSession('first-primary') // ver nota sobre réplicas D1 no topo do arquivo
  const id = c.req.param('id')
  const body = await c.req.json<{ analise: string; parecer: string; veredito: 'aprova' | 'reprova' }>()

  if (!['aprova', 'reprova'].includes(body.veredito)) {
    return c.json({ erro: 'veredito precisa ser aprova ou reprova' }, 400)
  }
  if (!body.analise?.trim() || !body.parecer?.trim()) {
    return c.json({ erro: 'análise e parecer são obrigatórios' }, 400)
  }

  const projeto = await db.prepare(`SELECT status, responsavel_id, autor_id FROM projetos WHERE id = ?`)
    .bind(id).first<{ status: string; responsavel_id: number | null; autor_id: number }>()
  if (!projeto) return c.json({ erro: 'não encontrado' }, 404)
  if (projeto.responsavel_id !== usuarioId) return c.json({ erro: 'só o responsável pelo processo posta o parecer' }, 403)
  if (projeto.status !== 'em_analise') return c.json({ erro: 'processo não está em análise' }, 409)

  await db.prepare(
    `UPDATE projetos SET analise = ?, parecer = ?, veredito = ?,
       parecer_postado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
       status = 'em_votacao', votacao_aberta_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
       atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ?`
  ).bind(body.analise.trim(), body.parecer.trim(), body.veredito, id).run()

  // A recomendação do responsável no parecer já conta como o voto dele —
  // não precisa votar de novo separadamente na votação que acabou de abrir.
  await db.prepare(
    `INSERT INTO projeto_votos (projeto_id, usuario_id, voto, comentario) VALUES (?, ?, ?, ?)
     ON CONFLICT(projeto_id, usuario_id) DO UPDATE SET
       voto = excluded.voto, comentario = excluded.comentario,
       atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')`
  ).bind(id, usuarioId, body.veredito, body.parecer.trim()).run()

  await registrarHistoricoProjeto(db, Number(id), `Análise e parecer postados (recomendação: ${body.veredito}) — votação aberta`, usuarioId)

  await notificar(db, projeto.autor_id, 'projeto_status', 'Seu processo entrou em votação', {
    referenciaTipo: 'projeto', referenciaId: Number(id),
  })

  const grupoId = await buscarGrupoResponsavelProjetos(db)
  if (grupoId) {
    const { results: membros } = await db.prepare(
      `SELECT usuario_id FROM usuario_grupos WHERE grupo_id = ? AND ativo = 1`
    ).bind(grupoId).all<{ usuario_id: number }>()
    // Sequencial, não Promise.all: várias queries concorrentes na MESMA
    // D1 Session ('first-primary') disparadas em paralelo podem falhar
    // com erro interno intermitente — a sessão espera as queries em
    // ordem. É o mesmo tipo de instabilidade da réplica atrasada (ver
    // nota no topo do arquivo), só que na escrita em vez da leitura.
    for (const m of membros) {
      await notificar(db, m.usuario_id, 'projeto_votacao_aberta', 'Um processo está em votação', {
        referenciaTipo: 'projeto', referenciaId: Number(id),
      })
    }

    // Caso raro, mas possível: o único votante elegível é o próprio
    // responsável (ex: cargos votantes restritos a um só cargo, e é o
    // dele) — o auto-voto que acabou de ser gravado já fecha sozinho.
    const totalElegiveis = await contarVotantesElegiveisProjetos(db, grupoId)
    const totalVotaram = await contarVotosElegiveisProjeto(db, Number(id), grupoId)
    if (totalElegiveis > 0 && totalVotaram >= totalElegiveis) {
      const fechamento = await fecharVotacaoProjeto(db, Number(id), null)
      if (fechamento.status === 'fechado') {
        await finalizarFechamentoVotacao(db, id, projeto.autor_id, fechamento, null)
      }
    }
  }

  return c.json({ ok: true })
})

// POST /projetos/:id/devolver-parecer — admin do grupo/sistema devolve
// a análise/parecer pro responsável revisar, só enquanto em_votacao
// (antes de encerrar). Volta pra em_analise e limpa parecer/veredito e
// TODOS os votos (inclusive o auto-voto do responsável) — como o
// parecer vai ser refeito, os votos antigos ficam sem sentido.
projetos.post('/:id/devolver-parecer', async (c) => {
  const usuarioId = c.get('usuarioId')
  const db = c.env.DB.withSession('first-primary') // ver nota sobre réplicas D1 no topo do arquivo
  const id = c.req.param('id')
  const body = await c.req.json<{ motivo?: string }>().catch(() => ({}) as { motivo?: string })

  if (!(await ehAdminDoGrupoResponsavel(db, usuarioId))) {
    return c.json({ erro: 'só um administrador do grupo responsável devolve o parecer' }, 403)
  }

  const projeto = await db.prepare(`SELECT status, responsavel_id FROM projetos WHERE id = ?`)
    .bind(id).first<{ status: string; responsavel_id: number | null }>()
  if (!projeto) return c.json({ erro: 'não encontrado' }, 404)
  if (projeto.status !== 'em_votacao') {
    return c.json({ erro: 'só dá pra devolver o parecer enquanto o processo está em votação' }, 409)
  }

  await db.prepare(`DELETE FROM projeto_votos WHERE projeto_id = ?`).bind(id).run()
  await db.prepare(
    `UPDATE projetos SET status = 'em_analise', analise = NULL, parecer = NULL, veredito = NULL,
       parecer_postado_em = NULL, votacao_aberta_em = NULL, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ?`
  ).bind(id).run()

  await registrarHistoricoProjeto(
    db, Number(id),
    `Análise e parecer devolvidos ao responsável para revisão${body.motivo ? `: ${body.motivo}` : ''}`,
    usuarioId
  )

  if (projeto.responsavel_id) {
    await notificar(db, projeto.responsavel_id, 'projeto_status', 'Seu parecer foi devolvido para revisão', {
      referenciaTipo: 'projeto', referenciaId: Number(id),
    })
  }

  return c.json({ ok: true })
})

// Notifica o autor sobre o resultado do fechamento (manual ou
// automático) e registra a linha correspondente na timeline.
async function finalizarFechamentoVotacao(
  db: D1Like,
  id: string,
  autorId: number,
  fechamento: { resultado: 'aprovado' | 'reprovado'; aprova: number; reprova: number },
  encerradoPorId: number | null
): Promise<void> {
  const descricao = encerradoPorId
    ? `Votação encerrada: ${fechamento.resultado} (${fechamento.aprova} aprova / ${fechamento.reprova} reprova)`
    : `Votação encerrada automaticamente — todos os votantes elegíveis já votaram: ${fechamento.resultado} (${fechamento.aprova} aprova / ${fechamento.reprova} reprova)`
  await registrarHistoricoProjeto(db, Number(id), descricao, encerradoPorId)

  await notificar(db, autorId, 'projeto_status',
    fechamento.resultado === 'aprovado' ? 'Seu processo foi aprovado — aguardando implementação' : 'Seu processo foi reprovado e arquivado',
    { referenciaTipo: 'projeto', referenciaId: Number(id) }
  )
}

// POST /projetos/:id/votar — membro ativo do grupo responsável, só em
// em_votacao (inclui o próprio responsável). Upsert: permite trocar o
// voto enquanto a votação seguir aberta. Se depois desse voto TODOS os
// votantes elegíveis já tiverem votado, a votação encerra sozinha (a
// não ser que dê empate — aí fica esperando o admin resolver, como
// sempre foi).
projetos.post('/:id/votar', async (c) => {
  const usuarioId = c.get('usuarioId')
  const db = c.env.DB.withSession('first-primary') // ver nota sobre réplicas D1 no topo do arquivo
  const id = c.req.param('id')
  const body = await c.req.json<{ voto: 'aprova' | 'reprova'; comentario?: string }>()

  if (!['aprova', 'reprova'].includes(body.voto)) {
    return c.json({ erro: 'voto precisa ser aprova ou reprova' }, 400)
  }

  const projeto = await db.prepare(`SELECT status, autor_id FROM projetos WHERE id = ?`)
    .bind(id).first<{ status: string; autor_id: number }>()
  if (!projeto) return c.json({ erro: 'não encontrado' }, 404)
  if (projeto.status !== 'em_votacao') return c.json({ erro: 'este processo não está em votação' }, 409)

  const grupoId = await buscarGrupoResponsavelProjetos(db)
  if (!grupoId || !(await podeVotarProjetos(db, usuarioId, grupoId))) {
    return c.json({ erro: 'você não tem o cargo necessário pra votar nesse processo' }, 403)
  }

  await db.prepare(
    `INSERT INTO projeto_votos (projeto_id, usuario_id, voto, comentario) VALUES (?, ?, ?, ?)
     ON CONFLICT(projeto_id, usuario_id) DO UPDATE SET
       voto = excluded.voto, comentario = excluded.comentario,
       atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')`
  ).bind(id, usuarioId, body.voto, body.comentario || null).run()

  const totalElegiveis = await contarVotantesElegiveisProjetos(db, grupoId)
  const totalVotaram = await contarVotosElegiveisProjeto(db, Number(id), grupoId)
  if (totalElegiveis > 0 && totalVotaram >= totalElegiveis) {
    const fechamento = await fecharVotacaoProjeto(db, Number(id), null)
    if (fechamento.status === 'fechado') {
      await finalizarFechamentoVotacao(db, id, projeto.autor_id, fechamento, null)
    }
    // 'empate' com todo mundo já tendo votado: ninguém mais pode votar
    // pra desempatar — fica parado até um admin agir (ex: devolver o
    // parecer e reiniciar a votação). 'sem_votos' não acontece aqui já
    // que acabamos de inserir um voto.
  }

  return c.json({ ok: true })
})

// POST /projetos/:id/encerrar-votacao — admin do grupo/sistema, só sem
// empate. Reprovado arquiva automaticamente; aprovado libera implementação.
// (O fechamento também acontece sozinho, sem precisar desse botão,
// quando todos os votantes elegíveis já tiverem votado — ver /votar.)
projetos.post('/:id/encerrar-votacao', async (c) => {
  const usuarioId = c.get('usuarioId')
  const db = c.env.DB.withSession('first-primary') // ver nota sobre réplicas D1 no topo do arquivo
  const id = c.req.param('id')

  if (!(await ehAdminDoGrupoResponsavel(db, usuarioId))) {
    return c.json({ erro: 'só um administrador do grupo responsável encerra a votação' }, 403)
  }

  const projeto = await db.prepare(`SELECT status, autor_id FROM projetos WHERE id = ?`)
    .bind(id).first<{ status: string; autor_id: number }>()
  if (!projeto) return c.json({ erro: 'não encontrado' }, 404)
  if (projeto.status !== 'em_votacao') return c.json({ erro: 'este processo não está em votação' }, 409)

  const fechamento = await fecharVotacaoProjeto(db, Number(id), usuarioId)
  if (fechamento.status === 'sem_votos') return c.json({ erro: 'ninguém votou ainda' }, 409)
  if (fechamento.status === 'empate') return c.json({ erro: 'votação empatada — aguarde mais um voto pra desempatar' }, 409)

  await finalizarFechamentoVotacao(db, id, projeto.autor_id, fechamento, usuarioId)

  return c.json({ ok: true, resultado: fechamento.resultado })
})

// POST /projetos/:id/concluir — só o responsável atual, só em
// aguardando_implementacao.
projetos.post('/:id/concluir', async (c) => {
  const usuarioId = c.get('usuarioId')
  const db = c.env.DB.withSession('first-primary') // ver nota sobre réplicas D1 no topo do arquivo
  const id = c.req.param('id')
  const body = await c.req.json<{ implementacao_descricao: string }>()

  if (!body.implementacao_descricao?.trim()) {
    return c.json({ erro: 'descreva o que foi feito pra implementar o processo' }, 400)
  }

  const projeto = await db.prepare(`SELECT status, responsavel_id, autor_id FROM projetos WHERE id = ?`)
    .bind(id).first<{ status: string; responsavel_id: number | null; autor_id: number }>()
  if (!projeto) return c.json({ erro: 'não encontrado' }, 404)
  if (projeto.responsavel_id !== usuarioId) return c.json({ erro: 'só o responsável pelo processo conclui a implementação' }, 403)
  if (projeto.status !== 'aguardando_implementacao') return c.json({ erro: 'processo não está aguardando implementação' }, 409)

  await db.prepare(
    `UPDATE projetos SET implementacao_descricao = ?, concluido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
       status = 'concluido', atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ?`
  ).bind(body.implementacao_descricao.trim(), id).run()

  await registrarHistoricoProjeto(db, Number(id), 'Implementação concluída — processo encerrado', usuarioId)

  await notificar(db, projeto.autor_id, 'projeto_status', 'Seu processo foi concluído', {
    referenciaTipo: 'projeto', referenciaId: Number(id),
  })

  return c.json({ ok: true })
})

// POST /projetos/:id/arquivar — arquivamento manual, admin do grupo/
// sistema, em qualquer estado não terminal.
projetos.post('/:id/arquivar', async (c) => {
  const usuarioId = c.get('usuarioId')
  const db = c.env.DB.withSession('first-primary') // ver nota sobre réplicas D1 no topo do arquivo
  const id = c.req.param('id')
  const body = await c.req.json<{ motivo?: string }>().catch(() => ({}) as { motivo?: string })

  if (!(await ehAdminDoGrupoResponsavel(db, usuarioId))) {
    return c.json({ erro: 'só um administrador do grupo responsável arquiva um processo' }, 403)
  }

  const projeto = await db.prepare(`SELECT status, autor_id FROM projetos WHERE id = ?`)
    .bind(id).first<{ status: string; autor_id: number }>()
  if (!projeto) return c.json({ erro: 'não encontrado' }, 404)
  if (!STATUS_NAO_TERMINAL.includes(projeto.status as (typeof STATUS_NAO_TERMINAL)[number])) {
    return c.json({ erro: 'processo já está arquivado ou concluído' }, 409)
  }

  await db.prepare(
    `UPDATE projetos SET status = 'arquivado', arquivado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
       arquivado_por_id = ?, motivo_arquivamento = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ?`
  ).bind(usuarioId, body.motivo || null, id).run()

  await registrarHistoricoProjeto(db, Number(id), `Processo arquivado manualmente${body.motivo ? `: ${body.motivo}` : ''}`, usuarioId)

  await notificar(db, projeto.autor_id, 'projeto_status', 'Seu processo foi arquivado', {
    referenciaTipo: 'projeto', referenciaId: Number(id),
  })

  return c.json({ ok: true })
})

// POST /projetos/:id/desarquivar — admin do grupo/sistema, só quando
// arquivado. destino = pra onde o processo volta.
projetos.post('/:id/desarquivar', async (c) => {
  const usuarioId = c.get('usuarioId')
  const db = c.env.DB.withSession('first-primary') // ver nota sobre réplicas D1 no topo do arquivo
  const id = c.req.param('id')
  const body = await c.req.json<{ destino: 'aguardando_implementacao' | 'em_votacao' }>()

  if (!['aguardando_implementacao', 'em_votacao'].includes(body.destino)) {
    return c.json({ erro: 'destino precisa ser aguardando_implementacao ou em_votacao' }, 400)
  }
  if (!(await ehAdminDoGrupoResponsavel(db, usuarioId))) {
    return c.json({ erro: 'só um administrador do grupo responsável desarquiva um processo' }, 403)
  }

  const projeto = await db.prepare(`SELECT status, autor_id FROM projetos WHERE id = ?`)
    .bind(id).first<{ status: string; autor_id: number }>()
  if (!projeto) return c.json({ erro: 'não encontrado' }, 404)
  if (projeto.status !== 'arquivado') return c.json({ erro: 'processo não está arquivado' }, 409)

  if (body.destino === 'em_votacao') {
    await db.prepare(`DELETE FROM projeto_votos WHERE projeto_id = ?`).bind(id).run()
    await db.prepare(
      `UPDATE projetos SET status = 'em_votacao', desarquivado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         desarquivado_por_id = ?, votacao_aberta_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         votacao_encerrada_em = NULL, votacao_encerrada_por_id = NULL, votacao_resultado = NULL,
         atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = ?`
    ).bind(usuarioId, id).run()
    await registrarHistoricoProjeto(db, Number(id), 'Processo desarquivado — votação reiniciada', usuarioId)
  } else {
    await db.prepare(
      `UPDATE projetos SET status = 'aguardando_implementacao', desarquivado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         desarquivado_por_id = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = ?`
    ).bind(usuarioId, id).run()
    await registrarHistoricoProjeto(db, Number(id), 'Processo desarquivado — segue direto para aguardando implementação', usuarioId)
  }

  await notificar(db, projeto.autor_id, 'projeto_status', 'Seu processo foi desarquivado', {
    referenciaTipo: 'projeto', referenciaId: Number(id),
  })

  return c.json({ ok: true })
})

// DELETE /projetos/:id — exclusão definitiva do processo, só admin do
// grupo responsável/sistema, em qualquer status. Cascata apaga votos e
// histórico junto (FKs ON DELETE CASCADE, migração 0038).
projetos.delete('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  const db = c.env.DB.withSession('first-primary') // ver nota sobre réplicas D1 no topo do arquivo
  const id = c.req.param('id')

  if (!(await ehAdminDoGrupoResponsavel(db, usuarioId))) {
    return c.json({ erro: 'só um administrador do grupo responsável exclui um processo' }, 403)
  }

  const projeto = await db.prepare(`SELECT id FROM projetos WHERE id = ?`).bind(id).first()
  if (!projeto) return c.json({ erro: 'não encontrado' }, 404)

  await db.prepare(`DELETE FROM projetos WHERE id = ?`).bind(id).run()
  await registrarEvento(db, usuarioId, 'projeto_excluido', { referenciaTipo: 'projeto', referenciaId: Number(id) })

  return c.json({ ok: true })
})

export default projetos
