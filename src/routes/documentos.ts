import { Hono } from 'hono'
import { podeGerirDocumento } from '../services/documentos'
import { notificar } from '../services/notificacoes'
import { registrarEvento } from '../services/logs'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const documentos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const PAPEL_DA_ETAPA: Record<number, 'autor' | 'aprovador' | 'administrador_forum'> = {
  1: 'autor',
  2: 'aprovador',
  3: 'administrador_forum',
}

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

async function caminhoSolicitacao(db: D1Database, documentoId: number, numeroRevisao: number): Promise<string> {
  const doc = await db.prepare(`SELECT slug FROM documentos WHERE id = ?`).bind(documentoId).first<{ slug: string }>()
  return `/documentos/${doc?.slug}/revisao/${numeroRevisao}`
}

// Quem pode VER uma revisão/solicitação em aberto: qualquer um dos
// assinantes dela (qualquer etapa), administrador do sistema, ou
// membro do grupo de visualização configurado no documento.
async function podeVerRevisao(db: D1Database, usuarioId: number, documentoId: number, revisaoId: number): Promise<boolean> {
  if (await ehAdmin(db, usuarioId)) return true

  const participante = await db.prepare(
    `SELECT 1 FROM documento_revisao_aprovadores WHERE revisao_id = ? AND usuario_id = ?`
  ).bind(revisaoId, usuarioId).first()
  if (participante) return true

  const doc = await db.prepare(`SELECT grupo_visualizacao_solicitacoes_id FROM documentos WHERE id = ?`)
    .bind(documentoId).first<{ grupo_visualizacao_solicitacoes_id: number | null }>()
  if (!doc?.grupo_visualizacao_solicitacoes_id) return false

  const membro = await db.prepare(
    `SELECT 1 FROM usuario_grupos WHERE usuario_id = ? AND grupo_id = ? AND ativo = 1`
  ).bind(usuarioId, doc.grupo_visualizacao_solicitacoes_id).first()
  return membro !== null
}

documentos.post('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  const body = await c.req.json<{ titulo: string; categoria_id: number; conteudo_atual: string; slug: string }>()

  if (!(await podeGerirDocumento(c.env.DB, usuarioId, 'criar'))) {
    return c.json({ erro: 'sem permissão para criar documentos' }, 403)
  }

  if (!body.slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.slug)) {
    return c.json({ erro: 'slug precisa ser minúsculo, só letras/números/hífen (ex: constituicao-militar)' }, 400)
  }

  try {
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO documentos (titulo, categoria_id, conteudo_atual, slug) VALUES (?, ?, ?, ?)`
    ).bind(body.titulo, body.categoria_id, body.conteudo_atual, body.slug).run()
    return c.json({ id: meta.last_row_id, slug: body.slug }, 201)
  } catch {
    return c.json({ erro: 'já existe um documento com esse slug' }, 409)
  }
})

documentos.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT d.*, dc.nome AS categoria_nome
     FROM documentos d LEFT JOIN documentos_categorias dc ON dc.id = d.categoria_id
     ORDER BY dc.ordem, d.titulo`
  ).all()
  return c.json(results)
})

async function buscarUltimaRevisaoImplementada(db: D1Database, documentoId: number) {
  const revisao = await db.prepare(
    `SELECT id, numero_revisao, criado_em, implementado_em, autor_id
     FROM documento_revisoes
     WHERE documento_id = ? AND status = 'implementado'
     ORDER BY numero_revisao DESC LIMIT 1`
  ).bind(documentoId).first<{ id: number; numero_revisao: number; criado_em: string; implementado_em: string; autor_id: number }>()

  if (!revisao) return null

  const { results: aprovadores } = await db.prepare(
    `SELECT dra.papel, dra.usuario_id, dra.comentario, u.nick AS usuario_nick
     FROM documento_revisao_aprovadores dra LEFT JOIN usuarios u ON u.id = dra.usuario_id
     WHERE dra.revisao_id = ?`
  ).bind(revisao.id).all()

  return { ...revisao, aprovadores }
}

// GET /documentos/minhas-assinaturas-pendentes — revisões de documento
// em que o usuário autenticado precisa assinar AGORA: é um dos
// aprovadores cadastrados no papel da ETAPA ATUAL (`etapa_atual`,
// mesmo campo usado por POST .../assinar pra decidir de quem é a vez)
// e ainda não decidiu. Usado pelo card de "Pendências" da home — não
// lista todo mundo que algum dia vai assinar, só quem pode agir agora.
documentos.get('/minhas-assinaturas-pendentes', async (c) => {
  const usuarioId = c.get('usuarioId')

  const { results } = await c.env.DB.prepare(
    `SELECT dra.revisao_id, dra.papel, dr.numero_revisao, dr.documento_id, d.titulo AS documento_titulo, d.slug AS documento_slug
     FROM documento_revisao_aprovadores dra
     JOIN documento_revisoes dr ON dr.id = dra.revisao_id
     JOIN documentos d ON d.id = dr.documento_id
     WHERE dra.usuario_id = ? AND dra.status = 'pendente' AND dr.status = 'em_aprovacao'
       AND (
         (dr.etapa_atual = 1 AND dra.papel = 'autor') OR
         (dr.etapa_atual = 2 AND dra.papel = 'aprovador') OR
         (dr.etapa_atual = 3 AND dra.papel = 'administrador_forum')
       )
     ORDER BY dr.criado_em DESC`
  ).bind(usuarioId).all()

  return c.json(results)
})

documentos.get('/slug/:slug', async (c) => {
  const usuarioId = c.get('usuarioId')
  const doc = await c.env.DB.prepare(
    `SELECT d.*, dc.nome AS categoria_nome FROM documentos d LEFT JOIN documentos_categorias dc ON dc.id = d.categoria_id WHERE d.slug = ?`
  ).bind(c.req.param('slug')).first<{ id: number }>()
  if (!doc) return c.json({ erro: 'não encontrado' }, 404)

  const ultimaRevisaoImplementada = await buscarUltimaRevisaoImplementada(c.env.DB, doc.id)

  // Solicitações em aberto (tudo que não é implementado nem cancelado)
  // — cada uma só aparece na lista se o usuário atual pode vê-la.
  const { results: abertas } = await c.env.DB.prepare(
    `SELECT id, numero_revisao, status, etapa_atual, criado_em
     FROM documento_revisoes
     WHERE documento_id = ? AND status NOT IN ('implementado', 'cancelado')
     ORDER BY numero_revisao DESC`
  ).bind(doc.id).all<{ id: number; numero_revisao: number; status: string; etapa_atual: number; criado_em: string }>()

  const abertasVisiveis = []
  for (const r of abertas) {
    if (await podeVerRevisao(c.env.DB, usuarioId, doc.id, r.id)) abertasVisiveis.push(r)
  }

  return c.json({ ...doc, ultima_revisao_implementada: ultimaRevisaoImplementada, solicitacoes_abertas: abertasVisiveis })
})

documentos.get('/slug/:slug/versao/:numero', async (c) => {
  const doc = await c.env.DB.prepare(`SELECT id, titulo, categoria_id FROM documentos WHERE slug = ?`)
    .bind(c.req.param('slug')).first<{ id: number; titulo: string; categoria_id: number }>()
  if (!doc) return c.json({ erro: 'documento não encontrado' }, 404)

  const revisao = await c.env.DB.prepare(
    `SELECT dr.*, au.nick AS autor_nick
     FROM documento_revisoes dr LEFT JOIN usuarios au ON au.id = dr.autor_id
     WHERE dr.documento_id = ? AND dr.numero_revisao = ? AND dr.status = 'implementado'`
  ).bind(doc.id, c.req.param('numero')).first()
  if (!revisao) return c.json({ erro: 'versão não encontrada' }, 404)

  const { results: aprovadores } = await c.env.DB.prepare(
    `SELECT dra.papel, dra.usuario_id, dra.comentario, u.nick AS usuario_nick
     FROM documento_revisao_aprovadores dra LEFT JOIN usuarios u ON u.id = dra.usuario_id
     WHERE dra.revisao_id = ?`
  ).bind((revisao as { id: number }).id).all()

  return c.json({ documento: doc, revisao: { ...revisao, aprovadores } })
})

// GET /documentos/slug/:slug/revisao/:numero — abre a página própria
// de uma solicitação (rascunho ou em andamento), pelo número
// sequencial do documento (o que aparece na URL).
documentos.get('/slug/:slug/revisao/:numero', async (c) => {
  const usuarioId = c.get('usuarioId')
  const doc = await c.env.DB.prepare(`SELECT id, titulo, categoria_id, slug FROM documentos WHERE slug = ?`)
    .bind(c.req.param('slug')).first<{ id: number; titulo: string; categoria_id: number; slug: string }>()
  if (!doc) return c.json({ erro: 'documento não encontrado' }, 404)

  const revisao = await c.env.DB.prepare(
    `SELECT dr.*, au.nick AS autor_nick
     FROM documento_revisoes dr LEFT JOIN usuarios au ON au.id = dr.autor_id
     WHERE dr.documento_id = ? AND dr.numero_revisao = ?`
  ).bind(doc.id, c.req.param('numero')).first<{ id: number }>()
  if (!revisao) return c.json({ erro: 'solicitação não encontrada' }, 404)

  if (!(await podeVerRevisao(c.env.DB, usuarioId, doc.id, revisao.id))) {
    return c.json({ erro: 'você não tem acesso a essa solicitação' }, 403)
  }

  const { results: aprovadores } = await c.env.DB.prepare(
    `SELECT dra.*, u.nick AS usuario_nick
     FROM documento_revisao_aprovadores dra LEFT JOIN usuarios u ON u.id = dra.usuario_id
     WHERE dra.revisao_id = ?`
  ).bind(revisao.id).all()

  const { results: historico } = await c.env.DB.prepare(
    `SELECT drh.*, u.nick AS criado_por_nick
     FROM documento_revisao_historico drh LEFT JOIN usuarios u ON u.id = drh.criado_por_id
     WHERE drh.revisao_id = ? ORDER BY drh.criado_em`
  ).bind(revisao.id).all()

  return c.json({ documento: doc, ...revisao, aprovadores, historico })
})

documentos.get('/:id', async (c) => {
  const doc = await c.env.DB.prepare(`SELECT * FROM documentos WHERE id = ?`).bind(c.req.param('id')).first()
  if (!doc) return c.json({ erro: 'não encontrado' }, 404)
  return c.json(doc)
})

// PATCH /documentos/:id — hoje só serve pra configurar o grupo que
// pode visualizar as solicitações em aberto. Só admin do sistema.
documentos.patch('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema configuram isso' }, 403)

  const body = await c.req.json<{ grupo_visualizacao_solicitacoes_id: number | null }>()
  await c.env.DB.prepare(`UPDATE documentos SET grupo_visualizacao_solicitacoes_id = ? WHERE id = ?`)
    .bind(body.grupo_visualizacao_solicitacoes_id, c.req.param('id')).run()

  return c.json({ ok: true })
})

documentos.delete('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await podeGerirDocumento(c.env.DB, usuarioId, 'deletar'))) {
    return c.json({ erro: 'sem permissão para deletar documentos' }, 403)
  }
  const doc = await c.env.DB.prepare(`SELECT id FROM documentos WHERE id = ?`).bind(c.req.param('id')).first()
  if (!doc) return c.json({ erro: 'não encontrado' }, 404)
  await c.env.DB.prepare(`DELETE FROM documentos WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

// POST /documentos/:id/revisoes — abre uma solicitação nova (rascunho).
// Cria a própria página numerada (/documentos/{slug}/revisao/{numero}).
// Quem abre já entra como autor auto-assinado; coautores entram como
// autores pendentes (podem editar o rascunho junto, mas ainda faltam
// assinar quando a revisão for enviada pra aprovação).
documentos.post('/:id/revisoes', async (c) => {
  const autorId = c.get('usuarioId')
  const documentoId = c.req.param('id')
  const body = await c.req.json<{
    conteudo_proposto?: string
    descricao_inicial: string
    coautores_ids?: number[]
  }>()

  const doc = await c.env.DB.prepare(`SELECT conteudo_atual FROM documentos WHERE id = ?`)
    .bind(documentoId).first<{ conteudo_atual: string }>()
  if (!doc) return c.json({ erro: 'documento não encontrado' }, 404)

  if (!(await podeGerirDocumento(c.env.DB, autorId, 'editar'))) {
    return c.json({ erro: 'sem permissão para editar documentos' }, 403)
  }

  const proximoNumero = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(numero_revisao), 0) + 1 AS proximo FROM documento_revisoes WHERE documento_id = ?`
  ).bind(documentoId).first<{ proximo: number }>()

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO documento_revisoes (documento_id, numero_revisao, conteudo_proposto, status, autor_id, etapa_atual)
     VALUES (?, ?, ?, 'rascunho', ?, 1)`
  ).bind(documentoId, proximoNumero?.proximo ?? 1, body.conteudo_proposto ?? doc.conteudo_atual, autorId).run()

  const revisaoId = meta.last_row_id

  await c.env.DB.prepare(
    `INSERT INTO documento_revisao_aprovadores (revisao_id, papel, usuario_id, status, decidido_em)
     VALUES (?, 'autor', ?, 'aprovado', strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
  ).bind(revisaoId, autorId).run()

  for (const coautorId of body.coautores_ids ?? []) {
    if (coautorId === autorId) continue
    await c.env.DB.prepare(
      `INSERT INTO documento_revisao_aprovadores (revisao_id, papel, usuario_id) VALUES (?, 'autor', ?)`
    ).bind(revisaoId, coautorId).run()
    await notificar(c.env.DB, coautorId, 'documento_revisao_pendente', 'Você foi convidado como coautor de uma revisão de documento', {
      corpo: await caminhoSolicitacao(c.env.DB, Number(documentoId), proximoNumero?.proximo ?? 1),
      referenciaTipo: 'documento_revisao', referenciaId: Number(revisaoId),
    })
  }

  await c.env.DB.prepare(
    `INSERT INTO documento_revisao_historico (revisao_id, descricao, criado_por_id) VALUES (?, ?, ?)`
  ).bind(revisaoId, body.descricao_inicial, autorId).run()

  await c.env.DB.prepare(`UPDATE documentos SET status = 'em_revisao' WHERE id = ?`).bind(documentoId).run()

  return c.json({ id: revisaoId, numero_revisao: proximoNumero?.proximo ?? 1 }, 201)
})

documentos.get('/:id/revisoes', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT dr.*, au.nick AS autor_nick
     FROM documento_revisoes dr
     LEFT JOIN usuarios au ON au.id = dr.autor_id
     WHERE dr.documento_id = ? ORDER BY dr.numero_revisao DESC`
  ).bind(c.req.param('id')).all()
  return c.json(results)
})

documentos.get('/:id/revisoes/:revisaoId', async (c) => {
  const revisaoId = c.req.param('revisaoId')

  const revisao = await c.env.DB.prepare(
    `SELECT dr.*, au.nick AS autor_nick
     FROM documento_revisoes dr LEFT JOIN usuarios au ON au.id = dr.autor_id
     WHERE dr.id = ?`
  ).bind(revisaoId).first()
  if (!revisao) return c.json({ erro: 'revisão não encontrada' }, 404)

  const { results: aprovadores } = await c.env.DB.prepare(
    `SELECT dra.*, u.nick AS usuario_nick
     FROM documento_revisao_aprovadores dra LEFT JOIN usuarios u ON u.id = dra.usuario_id
     WHERE dra.revisao_id = ?`
  ).bind(revisaoId).all()

  const { results: historico } = await c.env.DB.prepare(
    `SELECT drh.*, u.nick AS criado_por_nick
     FROM documento_revisao_historico drh LEFT JOIN usuarios u ON u.id = drh.criado_por_id
     WHERE drh.revisao_id = ? ORDER BY drh.criado_em`
  ).bind(revisaoId).all()

  return c.json({ ...revisao, aprovadores, historico })
})

// POST /documentos/:id/revisoes/:revisaoId/historico — registra uma
// alteração e, opcionalmente, atualiza o conteúdo proposto (autosave
// do rascunho). Só autores desta revisão (qualquer um deles).
documentos.post('/:id/revisoes/:revisaoId/historico', async (c) => {
  const criadoPorId = c.get('usuarioId')
  const revisaoId = c.req.param('revisaoId')
  const body = await c.req.json<{ descricao: string; conteudo_proposto?: string }>()

  const souAutor = await c.env.DB.prepare(
    `SELECT 1 FROM documento_revisao_aprovadores WHERE revisao_id = ? AND papel = 'autor' AND usuario_id = ?`
  ).bind(revisaoId, criadoPorId).first()
  if (!souAutor) return c.json({ erro: 'só um dos autores desta revisão pode editar' }, 403)

  await c.env.DB.prepare(
    `INSERT INTO documento_revisao_historico (revisao_id, descricao, criado_por_id) VALUES (?, ?, ?)`
  ).bind(revisaoId, body.descricao, criadoPorId).run()

  if (body.conteudo_proposto) {
    await c.env.DB.prepare(`UPDATE documento_revisoes SET conteudo_proposto = ? WHERE id = ?`)
      .bind(body.conteudo_proposto, revisaoId).run()
  }

  return c.json({ ok: true }, 201)
})

// POST /documentos/:id/revisoes/:revisaoId/enviar-para-aprovacao —
// sai do rascunho: define quem mais assina (coautores extras,
// aprovadores, administradores do fórum — estes só podem ser usuários
// com administrador_sistema) e passa a revisão pra 'em_aprovacao'.
// Só um dos autores atuais pode fazer isso.
documentos.post('/:id/revisoes/:revisaoId/enviar-para-aprovacao', async (c) => {
  const usuarioId = c.get('usuarioId')
  const revisaoId = c.req.param('revisaoId')
  const body = await c.req.json<{
    coautores_adicionais_ids?: number[]
    aprovadores_ids: number[]
    administradores_forum_ids: number[]
  }>()

  const revisao = await c.env.DB.prepare(`SELECT status FROM documento_revisoes WHERE id = ?`)
    .bind(revisaoId).first<{ status: string }>()
  if (!revisao) return c.json({ erro: 'revisão não encontrada' }, 404)
  if (revisao.status !== 'rascunho') return c.json({ erro: `revisão precisa estar em rascunho (está '${revisao.status}')` }, 400)

  const souAutor = await c.env.DB.prepare(
    `SELECT 1 FROM documento_revisao_aprovadores WHERE revisao_id = ? AND papel = 'autor' AND usuario_id = ?`
  ).bind(revisaoId, usuarioId).first()
  if (!souAutor) return c.json({ erro: 'só um dos autores desta revisão pode enviar pra aprovação' }, 403)

  if (!body.aprovadores_ids?.length) return c.json({ erro: 'escolha ao menos um aprovador' }, 400)
  if (!body.administradores_forum_ids?.length) return c.json({ erro: 'escolha ao menos um administrador do fórum' }, 400)

  // Valida que os administradores do fórum escolhidos são de fato admin do sistema.
  for (const id of body.administradores_forum_ids) {
    if (!(await ehAdmin(c.env.DB, id))) {
      return c.json({ erro: `usuário id ${id} não é administrador do sistema` }, 400)
    }
  }

  for (const id of body.coautores_adicionais_ids ?? []) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO documento_revisao_aprovadores (revisao_id, papel, usuario_id) VALUES (?, 'autor', ?)`
    ).bind(revisaoId, id).run()
  }
  for (const id of body.aprovadores_ids) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO documento_revisao_aprovadores (revisao_id, papel, usuario_id) VALUES (?, 'aprovador', ?)`
    ).bind(revisaoId, id).run()
  }
  for (const id of body.administradores_forum_ids) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO documento_revisao_aprovadores (revisao_id, papel, usuario_id) VALUES (?, 'administrador_forum', ?)`
    ).bind(revisaoId, id).run()
  }

  // Se todos os autores (etapa 1) já estavam aprovados (ex: só o
  // criador, sem coautor pendente), já libera direto pra etapa 2.
  const { results: statusAutores } = await c.env.DB.prepare(
    `SELECT status FROM documento_revisao_aprovadores WHERE revisao_id = ? AND papel = 'autor'`
  ).bind(revisaoId).all<{ status: string }>()
  const etapaInicial = statusAutores.every((a) => a.status === 'aprovado') ? 2 : 1

  await c.env.DB.prepare(
    `UPDATE documento_revisoes SET status = 'em_aprovacao', etapa_atual = ? WHERE id = ?`
  ).bind(etapaInicial, revisaoId).run()

  if (etapaInicial === 2) {
    const revisaoInfo = await c.env.DB.prepare(`SELECT documento_id, numero_revisao FROM documento_revisoes WHERE id = ?`)
      .bind(revisaoId).first<{ documento_id: number; numero_revisao: number }>()
    if (revisaoInfo) {
      const caminho = await caminhoSolicitacao(c.env.DB, revisaoInfo.documento_id, revisaoInfo.numero_revisao)
      for (const id of body.aprovadores_ids) {
        await notificar(c.env.DB, id, 'documento_revisao_pendente', 'Uma revisão de documento aguarda sua aprovação', {
          corpo: caminho, referenciaTipo: 'documento_revisao', referenciaId: Number(revisaoId),
        })
      }
    }
  }

  return c.json({ ok: true })
})

// POST /documentos/:id/revisoes/:revisaoId/assinar — assina (aprova ou
// reprova) na etapa atual. Só quem está designado na etapa vigente.
// Reprovar reseta TUDO pra rascunho (todas as assinaturas voltam a
// 'pendente', menos o autor original que abriu, que é remarcado
// pendente também — a revisão inteira recomeça a votação).
documentos.post('/:id/revisoes/:revisaoId/assinar', async (c) => {
  const usuarioId = c.get('usuarioId')
  const revisaoId = c.req.param('revisaoId')
  const body = await c.req.json<{ status: 'aprovado' | 'reprovado'; comentario?: string }>()

  const revisao = await c.env.DB.prepare(`SELECT status, etapa_atual FROM documento_revisoes WHERE id = ?`)
    .bind(revisaoId).first<{ status: string; etapa_atual: number }>()
  if (!revisao) return c.json({ erro: 'revisão não encontrada' }, 404)
  if (revisao.status !== 'em_aprovacao') {
    return c.json({ erro: `revisão não está em votação no momento (está '${revisao.status}')` }, 400)
  }

  const papelDaEtapa = PAPEL_DA_ETAPA[revisao.etapa_atual]
  const minhaLinha = await c.env.DB.prepare(
    `SELECT id FROM documento_revisao_aprovadores WHERE revisao_id = ? AND papel = ? AND usuario_id = ?`
  ).bind(revisaoId, papelDaEtapa, usuarioId).first<{ id: number }>()

  if (!minhaLinha) return c.json({ erro: 'não é sua vez de assinar essa revisão (ou você não faz parte dela)' }, 403)

  if (body.status === 'reprovado') {
    await c.env.DB.prepare(
      `UPDATE documento_revisao_aprovadores SET status = 'pendente', comentario = NULL, decidido_em = NULL WHERE revisao_id = ?`
    ).bind(revisaoId).run()
    // O autor original continua auto-aprovado (senão a revisão nunca teria dono ativo pra reenviar).
    const revisaoInfo = await c.env.DB.prepare(`SELECT autor_id, documento_id, numero_revisao FROM documento_revisoes WHERE id = ?`)
      .bind(revisaoId).first<{ autor_id: number; documento_id: number; numero_revisao: number }>()
    await c.env.DB.prepare(
      `UPDATE documento_revisao_aprovadores SET status = 'aprovado', decidido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE revisao_id = ? AND papel = 'autor' AND usuario_id = (SELECT autor_id FROM documento_revisoes WHERE id = ?)`
    ).bind(revisaoId, revisaoId).run()
    await c.env.DB.prepare(
      `UPDATE documento_revisoes SET status = 'rascunho', etapa_atual = 1 WHERE id = ?`
    ).bind(revisaoId).run()
    await c.env.DB.prepare(
      `INSERT INTO documento_revisao_historico (revisao_id, descricao, criado_por_id) VALUES (?, ?, ?)`
    ).bind(revisaoId, `Reprovado na etapa "${papelDaEtapa}"${body.comentario ? ` — motivo: ${body.comentario}` : ''}. Todas as assinaturas foram reiniciadas.`, usuarioId).run()

    if (revisaoInfo && revisaoInfo.autor_id !== usuarioId) {
      await notificar(c.env.DB, revisaoInfo.autor_id, 'documento_revisao_pendente', 'Sua revisão de documento foi reprovada e voltou pro rascunho', {
        corpo: await caminhoSolicitacao(c.env.DB, revisaoInfo.documento_id, revisaoInfo.numero_revisao),
        referenciaTipo: 'documento_revisao', referenciaId: Number(revisaoId),
      })
    }

    return c.json({ ok: true, status_revisao: 'rascunho' })
  }

  await c.env.DB.prepare(
    `UPDATE documento_revisao_aprovadores SET status = 'aprovado', comentario = ?, decidido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(body.comentario ?? null, minhaLinha.id).run()

  const { results: statusEtapa } = await c.env.DB.prepare(
    `SELECT status FROM documento_revisao_aprovadores WHERE revisao_id = ? AND papel = ?`
  ).bind(revisaoId, papelDaEtapa).all<{ status: string }>()
  const etapaCompleta = statusEtapa.every((a) => a.status === 'aprovado')

  if (!etapaCompleta) return c.json({ ok: true, status_revisao: 'em_aprovacao' })

  if (revisao.etapa_atual < 3) {
    const novaEtapa = revisao.etapa_atual + 1
    await c.env.DB.prepare(`UPDATE documento_revisoes SET etapa_atual = ? WHERE id = ?`).bind(novaEtapa, revisaoId).run()

    const revisaoInfo = await c.env.DB.prepare(`SELECT documento_id, numero_revisao FROM documento_revisoes WHERE id = ?`)
      .bind(revisaoId).first<{ documento_id: number; numero_revisao: number }>()
    if (revisaoInfo) {
      const { results: proximosSignatarios } = await c.env.DB.prepare(
        `SELECT usuario_id FROM documento_revisao_aprovadores WHERE revisao_id = ? AND papel = ?`
      ).bind(revisaoId, PAPEL_DA_ETAPA[novaEtapa]).all<{ usuario_id: number }>()
      const caminho = await caminhoSolicitacao(c.env.DB, revisaoInfo.documento_id, revisaoInfo.numero_revisao)
      for (const s of proximosSignatarios) {
        await notificar(c.env.DB, s.usuario_id, 'documento_revisao_pendente', 'É sua vez de assinar uma revisão de documento', {
          corpo: caminho, referenciaTipo: 'documento_revisao', referenciaId: Number(revisaoId),
        })
      }
    }

    return c.json({ ok: true, status_revisao: 'em_aprovacao' })
  }

  await c.env.DB.prepare(`UPDATE documento_revisoes SET status = 'aprovado' WHERE id = ?`).bind(revisaoId).run()
  return c.json({ ok: true, status_revisao: 'aprovado' })
})

documentos.post('/:id/revisoes/:revisaoId/agendar', async (c) => {
  const usuarioId = c.get('usuarioId')
  const revisaoId = c.req.param('revisaoId')
  const body = await c.req.json<{ agendado_para: string }>()

  const revisao = await c.env.DB.prepare(`SELECT status FROM documento_revisoes WHERE id = ?`)
    .bind(revisaoId).first<{ status: string }>()
  if (!revisao) return c.json({ erro: 'revisão não encontrada' }, 404)
  if (revisao.status !== 'aprovado') {
    return c.json({ erro: `revisão precisa estar 'aprovado' por todas as etapas antes de agendar (está '${revisao.status}')` }, 400)
  }

  const souAdministradorForum = await c.env.DB.prepare(
    `SELECT 1 FROM documento_revisao_aprovadores WHERE revisao_id = ? AND papel = 'administrador_forum' AND usuario_id = ?`
  ).bind(revisaoId, usuarioId).first()
  if (!souAdministradorForum) return c.json({ erro: 'só um administrador do fórum designado nesta revisão pode agendar' }, 403)

  await c.env.DB.prepare(
    `UPDATE documento_revisoes SET status = 'agendado', agendado_para = ?, agendado_por_id = ? WHERE id = ?`
  ).bind(body.agendado_para, usuarioId, revisaoId).run()

  return c.json({ ok: true })
})

documentos.post('/:id/revisoes/:revisaoId/implementar', async (c) => {
  const usuarioId = c.get('usuarioId')
  const documentoId = c.req.param('id')
  const revisaoId = c.req.param('revisaoId')

  const revisao = await c.env.DB.prepare(
    `SELECT conteudo_proposto, numero_revisao, status, autor_id FROM documento_revisoes WHERE id = ? AND documento_id = ?`
  ).bind(revisaoId, documentoId).first<{ conteudo_proposto: string; numero_revisao: number; status: string; autor_id: number }>()

  if (!revisao) return c.json({ erro: 'revisão não encontrada' }, 404)
  if (revisao.status !== 'agendado') {
    return c.json({ erro: `revisão precisa estar 'agendado' antes de implementar (está '${revisao.status}')` }, 400)
  }

  const admin = await ehAdmin(c.env.DB, usuarioId)
  const souAdministradorForum = await c.env.DB.prepare(
    `SELECT 1 FROM documento_revisao_aprovadores WHERE revisao_id = ? AND papel = 'administrador_forum' AND usuario_id = ?`
  ).bind(revisaoId, usuarioId).first()

  if (!admin && !souAdministradorForum) {
    return c.json({ erro: 'só um administrador do fórum designado nesta revisão, ou um admin do sistema, pode implementar' }, 403)
  }

  await c.env.DB.prepare(
    `UPDATE documentos SET conteudo_atual = ?, numero_revisao_atual = ?, status = 'vigente', atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(revisao.conteudo_proposto, revisao.numero_revisao, documentoId).run()

  await c.env.DB.prepare(
    `UPDATE documento_revisoes SET status = 'implementado', implementado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(revisaoId).run()

  await notificar(c.env.DB, revisao.autor_id, 'documento_revisao', 'Sua revisão de documento foi implementada', {
    referenciaTipo: 'documento_revisao', referenciaId: Number(revisaoId),
  })

  await registrarEvento(c.env.DB, usuarioId, 'documento_revisao_implementada', {
    referenciaTipo: 'documento', referenciaId: Number(documentoId),
    detalhes: { revisao_id: Number(revisaoId), numero_revisao: revisao.numero_revisao },
  })

  return c.json({ ok: true })
})

export default documentos
