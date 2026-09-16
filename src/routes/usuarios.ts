import { Hono } from 'hono'
import { buscarJogadorHabblet } from '../services/habblet'
import { hashSenha } from '../services/senha'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const usuarios = new Hono<{ Bindings: Bindings; Variables: Variables }>()

/** Busca o `figure` (visual do avatar) direto na API do Habblet — nunca
 * derruba a resposta principal se essa chamada falhar, só devolve null. */
async function figuraSegura(nick: string): Promise<string | null> {
  try {
    const jogador = await buscarJogadorHabblet(nick)
    return jogador?.figure ?? null
  } catch {
    return null
  }
}

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// GET /usuarios/me — dados do próprio usuário autenticado (nick, tag,
// patente, se é admin do sistema, biografia, figure do Habblet,
// personalização de perfil). O layout do frontend usa isso pra montar
// a navbar e o card de início.
usuarios.get('/me', async (c) => {
  const usuarioId = c.get('usuarioId')

  const usuario = await c.env.DB.prepare(
    `SELECT u.id, u.nick, u.tag, u.corpo, u.status, u.administrador_sistema, u.biografia,
            u.cor_avatar_fundo, u.avatar_fundo_imagem_url, u.avatar_direction, u.avatar_head_direction, u.avatar_gesture,
            u.banner_perfil_id, b.imagem_url AS banner_imagem_url,
            (u.senha_hash IS NOT NULL) AS tem_senha,
            p.nome AS patente_nome, p.ordem AS patente_ordem
     FROM usuarios u
     LEFT JOIN patentes p ON p.id = u.patente_atual_id
     LEFT JOIN banners_perfil b ON b.id = u.banner_perfil_id AND b.ativo = 1
     WHERE u.id = ?`
  ).bind(usuarioId).first<{ nick: string }>()

  if (!usuario) return c.json({ erro: 'usuário não encontrado' }, 404)

  const figure = await figuraSegura(usuario.nick)
  return c.json({ ...usuario, figure })
})

// POST /usuarios/heartbeat — marca o usuário como "online agora".
// Chamado periodicamente pelo frontend, não em toda requisição.
// Fica ANTES de qualquer rota '/:id' de propósito — no Hono, quem é
// declarado primeiro vence quando os padrões podem colidir, e
// '/online'/'heartbeat' senão cairiam sendo tratados como um :id.
usuarios.post('/heartbeat', async (c) => {
  const usuarioId = c.get('usuarioId')
  await c.env.DB.prepare(`UPDATE usuarios SET ultimo_acesso_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
    .bind(usuarioId).run()
  return c.json({ ok: true })
})

// GET /usuarios/online — quem teve heartbeat nos últimos 5 minutos.
usuarios.get('/online', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, nick FROM usuarios
     WHERE ultimo_acesso_em IS NOT NULL AND ultimo_acesso_em >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-5 minutes')
     ORDER BY nick`
  ).all()
  return c.json(results)
})

// PATCH /usuarios/me — biografia, e personalização de perfil (banner
// escolhido de uma lista curada por admin + cor de fundo do avatar,
// essa livre). Enviar null nesses dois campos volta pro padrão.
usuarios.patch('/me', async (c) => {
  const usuarioId = c.get('usuarioId')
  const body = await c.req.json<{
    biografia?: string
    banner_perfil_id?: number | null
    cor_avatar_fundo?: string | null
    avatar_fundo_imagem_url?: string | null
    avatar_direction?: string | null
    avatar_head_direction?: string | null
    avatar_gesture?: string | null
  }>()

  const campos: string[] = []
  const valores: unknown[] = []

  if ('biografia' in body) { campos.push('biografia = ?'); valores.push(body.biografia ?? null) }

  if ('banner_perfil_id' in body) {
    if (body.banner_perfil_id !== null) {
      const banner = await c.env.DB.prepare(`SELECT id FROM banners_perfil WHERE id = ? AND ativo = 1`)
        .bind(body.banner_perfil_id).first()
      if (!banner) return c.json({ erro: 'banner inválido' }, 400)
    }
    campos.push('banner_perfil_id = ?'); valores.push(body.banner_perfil_id ?? null)
  }

  if ('cor_avatar_fundo' in body) {
    if (body.cor_avatar_fundo != null && !/^#[0-9a-fA-F]{6}$/.test(body.cor_avatar_fundo)) {
      return c.json({ erro: 'cor_avatar_fundo precisa ser um hex válido (#rrggbb)' }, 400)
    }
    campos.push('cor_avatar_fundo = ?'); valores.push(body.cor_avatar_fundo ?? null)
  }

  if ('avatar_fundo_imagem_url' in body) {
    // Livre, sem curadoria (é uma escolha pessoal, igual a biografia) —
    // só uma checagem simples de formato de URL.
    if (body.avatar_fundo_imagem_url != null && !/^https?:\/\//.test(body.avatar_fundo_imagem_url)) {
      return c.json({ erro: 'avatar_fundo_imagem_url precisa ser uma URL http(s) válida' }, 400)
    }
    campos.push('avatar_fundo_imagem_url = ?'); valores.push(body.avatar_fundo_imagem_url ?? null)
  }

  const DIRECOES_VALIDAS = ['0', '1', '2', '3', '4', '5', '6', '7']
  const GESTOS_VALIDOS = ['std', 'sml', 'sad', 'ang', 'eyb']

  if ('avatar_direction' in body) {
    if (body.avatar_direction != null && !DIRECOES_VALIDAS.includes(body.avatar_direction)) {
      return c.json({ erro: 'avatar_direction inválido' }, 400)
    }
    campos.push('avatar_direction = ?'); valores.push(body.avatar_direction ?? null)
  }
  if ('avatar_head_direction' in body) {
    if (body.avatar_head_direction != null && !DIRECOES_VALIDAS.includes(body.avatar_head_direction)) {
      return c.json({ erro: 'avatar_head_direction inválido' }, 400)
    }
    campos.push('avatar_head_direction = ?'); valores.push(body.avatar_head_direction ?? null)
  }
  if ('avatar_gesture' in body) {
    if (body.avatar_gesture != null && !GESTOS_VALIDOS.includes(body.avatar_gesture)) {
      return c.json({ erro: 'avatar_gesture inválido' }, 400)
    }
    campos.push('avatar_gesture = ?'); valores.push(body.avatar_gesture ?? null)
  }

  if (!campos.length) return c.json({ ok: true })

  await c.env.DB.prepare(
    `UPDATE usuarios SET ${campos.join(', ')}, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(...valores, usuarioId).run()

  return c.json({ ok: true })
})

// POST /usuarios/alterar-senha — só pra quem JÁ tem senha definida e
// já está logado: como a sessão autenticada já prova quem é a pessoa,
// não precisa do código na missão de novo (isso só é exigido a
// primeira vez, em /auth/definir-senha, quando ainda não há senha
// nenhuma pra provar identidade).
usuarios.post('/alterar-senha', async (c) => {
  const usuarioId = c.get('usuarioId')
  const body = await c.req.json<{ senha: string }>()

  if (!body.senha || body.senha.length < 6) {
    return c.json({ erro: 'a senha precisa ter pelo menos 6 caracteres' }, 400)
  }

  const hash = await hashSenha(body.senha)
  await c.env.DB.prepare(
    `UPDATE usuarios SET senha_hash = ?, senha_atualizada_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(hash, usuarioId).run()

  return c.json({ ok: true })
})

// PATCH /usuarios/:id/admin — concede ou remove administrador_sistema
// de outra conta. Só quem já é admin, e ninguém pode remover o
// próprio acesso por aqui (evita se trancar fora sem querer).
usuarios.patch('/:id/admin', async (c) => {
  const usuarioAtualId = c.get('usuarioId')
  const alvoId = c.req.param('id')
  const { administrador_sistema } = await c.req.json<{ administrador_sistema: boolean }>()

  const atual = await c.env.DB.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioAtualId).first<{ administrador_sistema: number }>()
  if (!atual?.administrador_sistema) return c.json({ erro: 'só administradores do sistema concedem isso' }, 403)

  if (String(usuarioAtualId) === alvoId && !administrador_sistema) {
    return c.json({ erro: 'você não pode remover seu próprio acesso de administrador' }, 400)
  }

  await c.env.DB.prepare(`UPDATE usuarios SET administrador_sistema = ? WHERE id = ?`)
    .bind(administrador_sistema ? 1 : 0, alvoId).run()

  return c.json({ ok: true })
})

// GET /usuarios/:id — registro completo (todos os campos editáveis),
// pro painel de admin. Só admin.
usuarios.get('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  const atual = await c.env.DB.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  if (!atual?.administrador_sistema) return c.json({ erro: 'só administradores do sistema veem isso' }, 403)

  const usuario = await c.env.DB.prepare(`SELECT * FROM usuarios WHERE id = ?`).bind(c.req.param('id')).first()
  if (!usuario) return c.json({ erro: 'usuário não encontrado' }, 404)
  return c.json(usuario)
})

// PATCH /usuarios/:id — edição geral (nick, tag, tipo, corpo, patente,
// status, datas, biografia, exoneração). Não mexe em senha nem no
// flag administrador_sistema (isso continua só pelo /admin dedicado,
// que tem a trava de não remover o próprio acesso). Só admin.
usuarios.patch('/:id', async (c) => {
  const usuarioAtualId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioAtualId))) return c.json({ erro: 'só administradores do sistema editam usuários' }, 403)

  const alvoId = c.req.param('id')
  const atual = await c.env.DB.prepare(`SELECT tipo, corpo, patente_atual_id FROM usuarios WHERE id = ?`)
    .bind(alvoId).first<{ tipo: string; corpo: string | null; patente_atual_id: number | null }>()
  if (!atual) return c.json({ erro: 'usuário não encontrado' }, 404)

  const body = await c.req.json<{
    nick?: string
    tag?: string | null
    tipo?: 'jogador' | 'conta_oficial'
    corpo?: 'militar' | 'executivo' | null
    patente_atual_id?: number | null
    status?: string
    data_ingresso?: string
    data_ultimo_ato_funcional?: string | null
    biografia?: string | null
    exoneracao_ate?: string | null
  }>()

  // Valida a mesma regra do CHECK constraint antes de tentar salvar,
  // pra devolver um erro legível em vez do erro cru do SQLite.
  const tipoFinal = body.tipo ?? atual.tipo
  const corpoFinal = body.corpo !== undefined ? body.corpo : atual.corpo
  const patenteFinal = body.patente_atual_id !== undefined ? body.patente_atual_id : atual.patente_atual_id
  if (tipoFinal === 'conta_oficial' && (corpoFinal !== null || patenteFinal !== null)) {
    return c.json({ erro: 'conta oficial não pode ter corpo nem patente — limpe os dois campos' }, 400)
  }
  if (tipoFinal === 'jogador' && (corpoFinal === null || patenteFinal === null)) {
    return c.json({ erro: 'jogador precisa ter corpo e patente definidos' }, 400)
  }

  const campos: string[] = []
  const valores: unknown[] = []
  const set = (coluna: string, valor: unknown) => { campos.push(`${coluna} = ?`); valores.push(valor) }

  if (body.nick !== undefined) set('nick', body.nick)
  if (body.tag !== undefined) set('tag', body.tag)
  if (body.tipo !== undefined) set('tipo', body.tipo)
  if (body.corpo !== undefined) set('corpo', body.corpo)
  if (body.patente_atual_id !== undefined) set('patente_atual_id', body.patente_atual_id)
  if (body.status !== undefined) set('status', body.status)
  if (body.data_ingresso !== undefined) set('data_ingresso', body.data_ingresso)
  if (body.data_ultimo_ato_funcional !== undefined) set('data_ultimo_ato_funcional', body.data_ultimo_ato_funcional)
  if (body.biografia !== undefined) set('biografia', body.biografia)
  if (body.exoneracao_ate !== undefined) set('exoneracao_ate', body.exoneracao_ate)

  if (!campos.length) return c.json({ ok: true })

  try {
    await c.env.DB.prepare(
      `UPDATE usuarios SET ${campos.join(', ')}, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
    ).bind(...valores, alvoId).run()
    return c.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('UNIQUE')) return c.json({ erro: 'já existe um usuário com esse nick ou TAG' }, 409)
    return c.json({ erro: 'não foi possível salvar — confira os dados' }, 400)
  }
})

// GET /usuarios?busca=texto — busca simples por nick (autocomplete de
// alvos em formulários, listagem de membros etc.) — sem figure aqui de
// propósito: uma lista de até 100 usuários faria 100 chamadas externas
// à API do Habblet, o que é caro e lento demais pra uma listagem.
usuarios.get('/', async (c) => {
  const busca = c.req.query('busca')
  const apenasAdmin = c.req.query('apenas_admin') === '1'
  const filtroAdmin = apenasAdmin ? `AND u.administrador_sistema = 1` : ''

  const query = busca
    ? c.env.DB.prepare(
        `SELECT u.id, u.nick, u.tag, u.corpo, u.status, u.administrador_sistema, p.nome AS patente_nome
         FROM usuarios u LEFT JOIN patentes p ON p.id = u.patente_atual_id
         WHERE u.nick LIKE ? ${filtroAdmin} ORDER BY u.nick LIMIT 20`
      ).bind(`%${busca}%`)
    : c.env.DB.prepare(
        `SELECT u.id, u.nick, u.tag, u.corpo, u.status, u.administrador_sistema, p.nome AS patente_nome
         FROM usuarios u LEFT JOIN patentes p ON p.id = u.patente_atual_id
         WHERE 1=1 ${filtroAdmin} ORDER BY p.ordem DESC LIMIT 100`
      )

  const { results } = await query.all()
  return c.json(results)
})

// GET /usuarios/nick/:nick — perfil público de qualquer usuário, com
// figure e personalização de perfil.
usuarios.get('/nick/:nick', async (c) => {
  const nick = c.req.param('nick')

  const usuario = await c.env.DB.prepare(
    `SELECT u.id, u.nick, u.tag, u.corpo, u.status, u.biografia, u.data_ingresso, u.data_ultimo_ato_funcional,
            u.cor_avatar_fundo, u.avatar_fundo_imagem_url, u.avatar_direction, u.avatar_head_direction, u.avatar_gesture,
            u.banner_perfil_id, b.imagem_url AS banner_imagem_url,
            p.nome AS patente_nome, p.ordem AS patente_ordem
     FROM usuarios u
     LEFT JOIN patentes p ON p.id = u.patente_atual_id
     LEFT JOIN banners_perfil b ON b.id = u.banner_perfil_id AND b.ativo = 1
     WHERE u.nick = ?`
  ).bind(nick).first<{ nick: string }>()

  if (!usuario) return c.json({ erro: 'usuário não encontrado' }, 404)

  const figure = await figuraSegura(usuario.nick)
  return c.json({ ...usuario, figure })
})

// DELETE /usuarios/:id — apaga a conta e tudo que é dela. Só admin do
// sistema, e nunca a própria conta de quem está pedindo.
//
// O D1 aplica foreign key de verdade — qualquer coluna OBRIGATÓRIA
// (NOT NULL) que aponte pra essa conta tem que ser tratada, senão a
// exclusão inteira falha. Onde a coluna aceita NULL e representa só
// "quem fez esse ato administrativo" (ex: quem decidiu um
// requerimento alheio), ela é zerada e o registro de outra pessoa
// continua de pé. Onde é obrigatória, não tem como zerar — a linha é
// apagada junto (isso inclui coisas que essa conta criou/concedeu
// pra outras pessoas, como um emblema, uma aula de grupo ou uma
// notícia: às vezes o "algo relacionado" que some é maior do que só
// os dados da própria pessoa, mas não dá pra deixar a referência
// pendurada no banco).
usuarios.delete('/:id', async (c) => {
  const usuarioAutenticado = c.get('usuarioId')
  const alvoId = c.req.param('id')

  if (!(await ehAdmin(c.env.DB, usuarioAutenticado))) {
    return c.json({ erro: 'só administradores do sistema excluem contas' }, 403)
  }
  if (Number(alvoId) === usuarioAutenticado) {
    return c.json({ erro: 'você não pode excluir a própria conta' }, 400)
  }

  const alvo = await c.env.DB.prepare(`SELECT id, nick FROM usuarios WHERE id = ?`).bind(alvoId).first<{ id: number; nick: string }>()
  if (!alvo) return c.json({ erro: 'usuário não encontrado' }, 404)

  const db = c.env.DB
  const id = alvoId
  const stmts = [
    // --- Histórico de decisões de requerimento (sem CASCADE de propósito) ---
    db.prepare(`DELETE FROM historico WHERE requerimento_id IN (SELECT id FROM requerimentos WHERE autor_id = ?)`).bind(id),
    db.prepare(`DELETE FROM historico WHERE usuario_id = ? OR executado_por_id = ?`).bind(id, id),
    db.prepare(`UPDATE historico SET cancelado_por_id = NULL WHERE cancelado_por_id = ?`).bind(id),

    // --- Tweets (dela, e curtidas/enquetes ligadas) ---
    db.prepare(`DELETE FROM tweet_enquete_votos WHERE usuario_id = ? OR opcao_id IN (SELECT id FROM tweet_enquete_opcoes WHERE enquete_id IN (SELECT id FROM tweet_enquetes WHERE tweet_id IN (SELECT id FROM tweets WHERE autor_id = ?)))`).bind(id, id),
    db.prepare(`DELETE FROM tweet_enquete_opcoes WHERE enquete_id IN (SELECT id FROM tweet_enquetes WHERE tweet_id IN (SELECT id FROM tweets WHERE autor_id = ?))`).bind(id),
    db.prepare(`DELETE FROM tweet_enquetes WHERE tweet_id IN (SELECT id FROM tweets WHERE autor_id = ?)`).bind(id),
    db.prepare(`DELETE FROM tweet_midias WHERE tweet_id IN (SELECT id FROM tweets WHERE autor_id = ?)`).bind(id),
    db.prepare(`DELETE FROM tweet_curtidas WHERE usuario_id = ? OR tweet_id IN (SELECT id FROM tweets WHERE autor_id = ?)`).bind(id, id),
    db.prepare(`UPDATE tweets SET resposta_a_id = NULL WHERE resposta_a_id IN (SELECT id FROM tweets WHERE autor_id = ?)`).bind(id),
    db.prepare(`UPDATE tweets SET tweet_original_id = NULL WHERE tweet_original_id IN (SELECT id FROM tweets WHERE autor_id = ?)`).bind(id),
    db.prepare(`DELETE FROM tweets WHERE autor_id = ?`).bind(id),
    db.prepare(`UPDATE tweets SET operado_por_id = NULL WHERE operado_por_id = ?`).bind(id),

    // --- Mensagens (e-mails) ---
    db.prepare(`DELETE FROM mensagem_destinatarios WHERE destinatario_id = ? OR mensagem_id IN (SELECT id FROM mensagens WHERE remetente_id = ?)`).bind(id, id),
    db.prepare(`DELETE FROM mensagens WHERE remetente_id = ?`).bind(id),
    db.prepare(`UPDATE mensagens SET operado_por_id = NULL WHERE operado_por_id = ?`).bind(id),

    // --- Requerimentos ---
    db.prepare(`DELETE FROM requerimentos WHERE autor_id = ?`).bind(id),
    db.prepare(`DELETE FROM requerimento_alvos WHERE usuario_id = ?`).bind(id),
    db.prepare(`UPDATE requerimentos SET autorizado_por_id = NULL WHERE autorizado_por_id = ?`).bind(id),
    db.prepare(`UPDATE requerimentos SET decidido_por_id = NULL WHERE decidido_por_id = ?`).bind(id),
    db.prepare(`UPDATE requerimento_alvos SET decidido_por_id = NULL WHERE decidido_por_id = ?`).bind(id),
    db.prepare(`DELETE FROM requerimentos_permissoes WHERE usuario_id = ? OR definido_por_id = ?`).bind(id, id),

    // --- Grupos ---
    db.prepare(`DELETE FROM usuario_grupos WHERE usuario_id = ?`).bind(id),
    db.prepare(`DELETE FROM grupo_registros WHERE usuario_id = ? OR registrado_por_id = ?`).bind(id, id),
    db.prepare(`UPDATE grupo_niveis SET criado_por_id = NULL WHERE criado_por_id = ?`).bind(id),
    db.prepare(`DELETE FROM grupo_aula_relatorio_alunos WHERE usuario_id = ? OR relatorio_id IN (SELECT id FROM grupo_aula_relatorios WHERE instrutor_id = ? OR criado_por_id = ? OR aula_id IN (SELECT id FROM grupo_aulas WHERE criado_por_id = ?))`).bind(id, id, id, id),
    db.prepare(`DELETE FROM grupo_aula_relatorios WHERE instrutor_id = ? OR criado_por_id = ? OR aula_id IN (SELECT id FROM grupo_aulas WHERE criado_por_id = ?)`).bind(id, id, id),
    db.prepare(`DELETE FROM grupo_aulas WHERE criado_por_id = ?`).bind(id),
    db.prepare(`DELETE FROM grupo_paginas WHERE criado_por_id = ?`).bind(id),
    db.prepare(`UPDATE grupo_paginas SET atualizado_por_id = NULL WHERE atualizado_por_id = ?`).bind(id),

    // --- Documentos ---
    db.prepare(`DELETE FROM documento_revisao_aprovadores WHERE usuario_id = ?`).bind(id),
    db.prepare(`DELETE FROM documento_revisao_historico WHERE criado_por_id = ?`).bind(id),
    db.prepare(`UPDATE documento_revisoes SET agendado_por_id = NULL WHERE agendado_por_id = ?`).bind(id),
    db.prepare(`DELETE FROM documento_revisoes WHERE autor_id = ?`).bind(id),
    db.prepare(`DELETE FROM documentos_permissoes WHERE usuario_id = ? OR definido_por_id = ?`).bind(id, id),

    // --- Notícias (globais e de grupo) ---
    db.prepare(`DELETE FROM noticias WHERE autor_id = ?`).bind(id),
    db.prepare(`UPDATE noticias SET operado_por_id = NULL WHERE operado_por_id = ?`).bind(id),
    db.prepare(`UPDATE noticias SET publicado_por_id = NULL WHERE publicado_por_id = ?`).bind(id),
    db.prepare(`DELETE FROM noticias_permissoes WHERE usuario_id = ? OR definido_por_id = ?`).bind(id, id),
    db.prepare(`DELETE FROM grupo_noticias WHERE autor_id = ?`).bind(id),
    db.prepare(`UPDATE grupo_noticias SET operado_por_id = NULL WHERE operado_por_id = ?`).bind(id),

    // --- Distinções (recebidas, e catálogos que ela criou/concedeu) ---
    db.prepare(`DELETE FROM medalhas WHERE usuario_id = ? OR concedida_por_id = ?`).bind(id, id),
    db.prepare(`UPDATE certificados SET concedido_por_id = NULL WHERE concedido_por_id = ?`).bind(id),
    db.prepare(`DELETE FROM certificados WHERE usuario_id = ?`).bind(id),
    db.prepare(`UPDATE historico_cursos SET certificado_por_id = NULL WHERE certificado_por_id = ?`).bind(id),
    db.prepare(`DELETE FROM historico_cursos WHERE usuario_id = ?`).bind(id),
    db.prepare(`DELETE FROM soldo_pagamentos WHERE usuario_id = ?`).bind(id),
    db.prepare(`DELETE FROM usuario_emblemas WHERE usuario_id = ? OR concedido_por_id = ? OR emblema_id IN (SELECT id FROM emblemas WHERE criado_por_id = ?)`).bind(id, id, id),
    db.prepare(`DELETE FROM emblemas WHERE criado_por_id = ?`).bind(id),
    db.prepare(`DELETE FROM usuario_honrarias WHERE usuario_id = ? OR concedido_por_id = ? OR honraria_id IN (SELECT id FROM honrarias WHERE criado_por_id = ?)`).bind(id, id, id),
    db.prepare(`DELETE FROM honrarias WHERE criado_por_id = ?`).bind(id),
    db.prepare(`DELETE FROM usuario_conquistas WHERE usuario_id = ? OR conquista_id IN (SELECT id FROM conquistas WHERE criado_por_id = ?)`).bind(id, id),
    db.prepare(`DELETE FROM conquistas WHERE criado_por_id = ?`).bind(id),

    // --- Contas oficiais ---
    db.prepare(`DELETE FROM conta_oficial_operadores WHERE usuario_id = ? OR conta_id = ? OR concedido_por_id = ?`).bind(id, id, id),

    // --- Fórum, páginas customizadas, menu ---
    db.prepare(`DELETE FROM forum_posts WHERE autor_id = ?`).bind(id),
    db.prepare(`UPDATE forum_posts SET operado_por_id = NULL WHERE operado_por_id = ?`).bind(id),
    db.prepare(`UPDATE forum_posts SET editado_por_id = NULL WHERE editado_por_id = ?`).bind(id),
    db.prepare(`DELETE FROM forum_topicos WHERE autor_id = ?`).bind(id),
    db.prepare(`DELETE FROM paginas_customizadas WHERE criado_por_id = ?`).bind(id),
    db.prepare(`UPDATE paginas_customizadas SET atualizado_por_id = NULL WHERE atualizado_por_id = ?`).bind(id),
    db.prepare(`DELETE FROM menu_itens WHERE criado_por_id = ?`).bind(id),

    // --- Sugestões e tickets ---
    db.prepare(`DELETE FROM sugestoes WHERE autor_id = ?`).bind(id),
    db.prepare(`UPDATE sugestoes SET decidido_por_id = NULL WHERE decidido_por_id = ?`).bind(id),
    db.prepare(`DELETE FROM ticket_mensagens WHERE ticket_id IN (SELECT id FROM tickets_suporte WHERE autor_id = ?) OR autor_id = ?`).bind(id, id),
    db.prepare(`DELETE FROM tickets_suporte WHERE autor_id = ?`).bind(id),
    db.prepare(`UPDATE tickets_suporte SET encerrado_por_id = NULL WHERE encerrado_por_id = ?`).bind(id),

    // --- Social, notificações, sessão ---
    db.prepare(`DELETE FROM seguidores WHERE seguidor_id = ? OR seguido_id = ?`).bind(id, id),
    db.prepare(`DELETE FROM notificacoes WHERE usuario_id = ?`).bind(id),
    db.prepare(`DELETE FROM refresh_tokens WHERE usuario_id = ?`).bind(id),
    db.prepare(`DELETE FROM logs_eventos WHERE usuario_id = ?`).bind(id),

    // --- Por fim, a própria conta ---
    db.prepare(`DELETE FROM usuarios WHERE id = ?`).bind(id),
  ]

  try {
    await db.batch(stmts)
  } catch (err) {
    return c.json({ erro: `falhou por uma dependência ainda não tratada: ${err instanceof Error ? err.message : String(err)}` }, 500)
  }

  return c.json({ ok: true, nick: alvo.nick })
})

export default usuarios
