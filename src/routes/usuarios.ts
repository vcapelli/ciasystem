import { Hono } from 'hono'
import { buscarJogadorHabblet } from '../services/habblet'
import { hashSenha } from '../services/senha'
import { revogarTodasSessoes } from '../services/auth'
import { registrarEvento } from '../services/logs'
import { ehContaProtegida, NICK_CONTA_PROTEGIDA } from '../services/protecao-conta'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const usuarios = new Hono<{ Bindings: Bindings; Variables: Variables }>()

/** Busca o `figure` (visual do avatar) direto na API do Habblet — nunca
 * derruba a resposta principal se essa chamada falhar, só devolve null.
 * Se a conta tiver um `figure_fixa` definido (caso de contas oficiais,
 * que não têm personagem de verdade no jogo), ele sempre tem prioridade
 * e nem chega a chamar a API do Habblet. */
async function figuraSegura(nick: string, figureFixa?: string | null): Promise<string | null> {
  if (figureFixa) return figureFixa
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
    `SELECT u.id, u.nick, u.tag, u.tipo, u.corpo, u.status, u.administrador_sistema, u.biografia,
            u.cor_avatar_fundo, u.avatar_fundo_imagem_url, u.avatar_direction, u.avatar_head_direction, u.avatar_gesture,
            u.banner_perfil_id, b.imagem_url AS banner_imagem_url, u.logo_url, u.figure_fixa,
            (u.senha_hash IS NOT NULL) AS tem_senha,
            p.nome AS patente_nome, p.ordem AS patente_ordem
     FROM usuarios u
     LEFT JOIN patentes p ON p.id = u.patente_atual_id
     LEFT JOIN banners_perfil b ON b.id = u.banner_perfil_id AND b.ativo = 1
     WHERE u.id = ?`
  ).bind(usuarioId).first<{ nick: string; figure_fixa: string | null }>()

  if (!usuario) return c.json({ erro: 'usuário não encontrado' }, 404)

  const figure = await figuraSegura(usuario.nick, usuario.figure_fixa)
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

// POST /usuarios/alterar-senha — define ou troca a senha de quem já
// está logado. A sessão autenticada já prova quem é a pessoa, então
// isso vale tanto pra primeira definição quanto pra troca — não é
// preciso passar pelo código na missão de novo em nenhum dos dois
// casos (/auth/definir-senha, com código, segue existindo só pra um
// eventual fluxo futuro sem sessão ativa).
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

// PATCH /usuarios/:id/senha — administrador do sistema cria ou
// redefine a senha de acesso de QUALQUER usuário, sem precisar do
// código na missão do Habblet (o admin já provou quem é ao logar, e
// está agindo sobre a conta de outra pessoa — ex: alguém perdeu acesso
// ao próprio Habblet, ou uma conta institucional precisa de senha
// pela primeira vez). Sempre revoga as sessões ativas do alvo depois:
// se a senha estava comprometida (motivo mais comum pra pedir um
// reset), continuar logado com o token antigo anularia o reset.
usuarios.patch('/:id/senha', async (c) => {
  const usuarioAtualId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioAtualId))) {
    return c.json({ erro: 'só administradores do sistema podem definir a senha de outro usuário' }, 403)
  }

  const alvoId = c.req.param('id')
  const alvo = await c.env.DB.prepare(`SELECT id, nick FROM usuarios WHERE id = ?`).bind(alvoId).first<{ id: number; nick: string }>()
  if (!alvo) return c.json({ erro: 'usuário não encontrado' }, 404)

  if (ehContaProtegida(alvo.nick)) {
    return c.json({ erro: `a senha da conta ${NICK_CONTA_PROTEGIDA} não pode ser redefinida por outro administrador` }, 400)
  }

  const body = await c.req.json<{ senha: string }>().catch(() => ({}) as { senha?: string })
  if (!body.senha || body.senha.length < 6) {
    return c.json({ erro: 'a senha precisa ter pelo menos 6 caracteres' }, 400)
  }

  const hash = await hashSenha(body.senha)
  await c.env.DB.prepare(
    `UPDATE usuarios SET senha_hash = ?, senha_atualizada_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(hash, alvoId).run()

  await revogarTodasSessoes(c.env.DB, Number(alvoId))
  await registrarEvento(c.env.DB, usuarioAtualId, 'senha_definida_por_admin', {
    referenciaTipo: 'usuario', referenciaId: Number(alvoId),
  })

  return c.json({ ok: true })
})

// PATCH /usuarios/:id/admin — concede ou remove administrador_sistema
// de outra conta. Só quem já é admin, e ninguém pode remover o
// próprio acesso por aqui (evita se trancar fora sem querer).
usuarios.patch('/:id/admin', async (c) => {
  const usuarioAtualId = c.get('usuarioId')
  const alvoId = c.req.param('id')
  const body = await c.req.json<{ administrador_sistema?: boolean }>().catch(() => ({} as { administrador_sistema?: boolean }))

  // Antes, se `administrador_sistema` viesse ausente do corpo, o
  // `undefined` caía em "falsy" e revogava o admin do alvo em
  // silêncio — agora é erro de validação explícito.
  if (typeof body.administrador_sistema !== 'boolean') {
    return c.json({ erro: 'administrador_sistema (boolean) é obrigatório' }, 400)
  }
  const administrador_sistema = body.administrador_sistema

  const atual = await c.env.DB.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioAtualId).first<{ administrador_sistema: number }>()
  if (!atual?.administrador_sistema) return c.json({ erro: 'só administradores do sistema concedem isso' }, 403)

  const alvo = await c.env.DB.prepare(`SELECT id, nick FROM usuarios WHERE id = ?`).bind(alvoId).first<{ id: number; nick: string }>()
  if (!alvo) return c.json({ erro: 'usuário alvo não encontrado' }, 404)

  if (String(usuarioAtualId) === alvoId && !administrador_sistema) {
    return c.json({ erro: 'você não pode remover seu próprio acesso de administrador' }, 400)
  }

  // Conta do dono do sistema — nunca pode perder administrador_sistema,
  // nem por outro admin, pra não haver como travar o próprio acesso ao
  // sistema por engano (ou de propósito) sem passar direto pelo banco.
  if (!administrador_sistema && alvo.nick.toLowerCase() === 'vcapelli') {
    return c.json({ erro: 'a conta vcapelli não pode ter o acesso de administrador removido' }, 400)
  }

  await c.env.DB.prepare(`UPDATE usuarios SET administrador_sistema = ? WHERE id = ?`)
    .bind(administrador_sistema ? 1 : 0, alvoId).run()

  return c.json({ ok: true })
})

// GET /usuarios/recentes?limite=3 — os últimos usuários cadastrados
// (por `criado_em`), com figure incluída — usado no card "Novos
// membros" da página inicial. Precisa vir ANTES de `/:id` abaixo,
// senão o Hono casa "recentes" como se fosse um :id. Só busca poucos
// de propósito (a home só pede 3): cada figure custa uma chamada à
// API do Habblet, então não dá pra fazer isso pra uma listagem grande.
usuarios.get('/recentes', async (c) => {
  const limite = Math.min(Math.max(Number(c.req.query('limite')) || 3, 1), 10)

  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.nick, u.tag, u.figure_fixa, u.criado_em, p.nome AS patente_nome
     FROM usuarios u LEFT JOIN patentes p ON p.id = u.patente_atual_id
     WHERE u.status NOT IN ('desligado_honroso', 'desligado_desonroso', 'exonerado')
     ORDER BY u.criado_em DESC LIMIT ?`
  ).bind(limite).all<{ id: number; nick: string; tag: string | null; figure_fixa: string | null; criado_em: string; patente_nome: string | null }>()

  const comFigure = await Promise.all(
    results.map(async (u) => ({ ...u, figure: await figuraSegura(u.nick, u.figure_fixa) }))
  )

  return c.json(comFigure)
})

// GET /usuarios/convidados — listagem de Convidados (eh_convidado = 1),
// pra página dedicada de listagem. Sem patente/corpo (não fazem parte
// da hierarquia — não tem "dias no posto"/"dias na polícia"), e quem
// já foi desligado (status = 'desligado_honroso', a ação 'exclusao' do
// requerimento de convidado) some daqui. Sem figure de propósito — a
// lista pode crescer bastante e cada figure é uma chamada à API do
// Habblet (mesmo motivo do GET / genérico). Precisa vir ANTES de
// `/:id` abaixo, senão o Hono casa "convidados" como se fosse um :id.
usuarios.get('/convidados', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, nick, tag, status, data_ingresso, criado_em
     FROM usuarios
     WHERE eh_convidado = 1 AND status NOT IN ('desligado_honroso', 'desligado_desonroso')
     ORDER BY data_ingresso DESC`
  ).all()

  return c.json(results)
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

// POST /usuarios — cria uma conta oficial (ex: "Administração", "Setor
// Técnico"). Jogadores de verdade nunca passam por aqui — eles entram
// pelo fluxo normal (instrução inicial/contratação, com verificação na
// missão do Habblet). Só admin.
usuarios.post('/', async (c) => {
  const usuarioAtualId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioAtualId))) return c.json({ erro: 'só administradores do sistema criam contas' }, 403)

  const body = await c.req.json<{
    nick: string; logo_url?: string; figure_fixa?: string; biografia?: string
  }>()
  if (!body.nick?.trim()) return c.json({ erro: 'nick é obrigatório' }, 400)

  try {
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO usuarios (nick, tipo, corpo, patente_atual_id, status, data_ingresso, logo_url, figure_fixa, biografia)
       VALUES (?, 'conta_oficial', NULL, NULL, 'ativo', strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?, ?, ?)`
    ).bind(body.nick.trim(), body.logo_url ?? null, body.figure_fixa ?? null, body.biografia ?? null).run()
    return c.json({ id: meta.last_row_id }, 201)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('UNIQUE')) return c.json({ erro: 'já existe um usuário com esse nick' }, 409)
    return c.json({ erro: 'não foi possível criar — confira os dados' }, 400)
  }
})

// PATCH /usuarios/:id — edição geral (nick, tag, tipo, corpo, patente,
// status, datas, biografia, exoneração). Não mexe em senha nem no
// flag administrador_sistema (isso continua só pelo /admin dedicado,
// que tem a trava de não remover o próprio acesso). Só admin.
usuarios.patch('/:id', async (c) => {
  const usuarioAtualId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioAtualId))) return c.json({ erro: 'só administradores do sistema editam usuários' }, 403)

  const alvoId = c.req.param('id')
  const atual = await c.env.DB.prepare(`SELECT nick, tipo, corpo, patente_atual_id FROM usuarios WHERE id = ?`)
    .bind(alvoId).first<{ nick: string; tipo: string; corpo: string | null; patente_atual_id: number | null }>()
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
    logo_url?: string | null
    figure_fixa?: string | null
  }>()

  // Conta do dono do sistema: nick, status e tipo de conta não podem
  // ser alterados por aqui (senha tem sua própria trava em /:id/senha).
  // Bloqueia a requisição inteira em vez de só ignorar os campos —
  // assim o admin fica sabendo que precisa reenviar sem eles, em vez
  // de achar que o resto também não foi salvo.
  if (ehContaProtegida(atual.nick)) {
    const camposProtegidos = ['nick', 'status', 'tipo'].filter((campo) => (body as Record<string, unknown>)[campo] !== undefined)
    if (camposProtegidos.length) {
      return c.json({ erro: `a conta ${NICK_CONTA_PROTEGIDA} não pode ter ${camposProtegidos.join(', ')} alterado(s)` }, 400)
    }
  }

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

  // TAG pessoal: 2-3 caracteres alfanuméricos (null/vazio ainda é
  // permitido aqui — é a edição admin, que pode limpar a TAG).
  if (body.tag != null && !/^[A-Za-z0-9]{2,3}$/.test(body.tag)) {
    return c.json({ erro: 'TAG deve ter 2 ou 3 caracteres alfanuméricos' }, 400)
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
  if (body.logo_url !== undefined) set('logo_url', body.logo_url)
  if (body.figure_fixa !== undefined) set('figure_fixa', body.figure_fixa)

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
  const apenasConvidados = c.req.query('apenas_convidados') === '1'
  const tipo = c.req.query('tipo')
  const filtroAdmin = apenasAdmin ? `AND u.administrador_sistema = 1` : ''
  const filtroConvidado = apenasConvidados ? `AND u.eh_convidado = 1 AND u.status NOT IN ('desligado_honroso', 'desligado_desonroso')` : ''
  // Convidado usa tipo='conta_oficial' por baixo dos panos (é o único
  // valor que o CHECK do banco permite com corpo/patente NULL — ver
  // efeitos.ts), então tipo=conta_oficial precisa excluir eh_convidado=1
  // explicitamente pra não misturar convidados na lista de "postar como
  // conta institucional" e afins.
  const filtroTipo = tipo
    ? tipo === 'conta_oficial'
      ? `AND u.tipo = 'conta_oficial' AND u.eh_convidado = 0`
      : `AND u.tipo = 'jogador'`
    : ''

  const query = busca
    ? c.env.DB.prepare(
        `SELECT u.id, u.nick, u.tag, u.corpo, u.status, u.administrador_sistema, p.nome AS patente_nome
         FROM usuarios u LEFT JOIN patentes p ON p.id = u.patente_atual_id
         WHERE u.nick LIKE ? ${filtroAdmin} ${filtroConvidado} ${filtroTipo} ORDER BY u.nick LIMIT 20`
      ).bind(`%${busca}%`)
    : c.env.DB.prepare(
        `SELECT u.id, u.nick, u.tag, u.corpo, u.status, u.administrador_sistema, p.nome AS patente_nome
         FROM usuarios u LEFT JOIN patentes p ON p.id = u.patente_atual_id
         WHERE 1=1 ${filtroAdmin} ${filtroConvidado} ${filtroTipo} ORDER BY p.ordem DESC LIMIT 100`
      )

  const { results } = await query.all()
  return c.json(results)
})

// GET /usuarios/nick/:nick — perfil público de qualquer usuário, com
// figure e personalização de perfil.
usuarios.get('/nick/:nick', async (c) => {
  const nick = c.req.param('nick')

  const usuario = await c.env.DB.prepare(
    `SELECT u.id, u.nick, u.tag, u.tipo, u.corpo, u.status, u.eh_convidado, u.biografia, u.data_ingresso, u.data_ultimo_ato_funcional,
            u.cor_avatar_fundo, u.avatar_fundo_imagem_url, u.avatar_direction, u.avatar_head_direction, u.avatar_gesture,
            u.banner_perfil_id, b.imagem_url AS banner_imagem_url, u.logo_url, u.figure_fixa,
            p.nome AS patente_nome, p.ordem AS patente_ordem
     FROM usuarios u
     LEFT JOIN patentes p ON p.id = u.patente_atual_id
     LEFT JOIN banners_perfil b ON b.id = u.banner_perfil_id AND b.ativo = 1
     WHERE u.nick = ?`
  ).bind(nick).first<{ nick: string; figure_fixa: string | null }>()

  if (!usuario) return c.json({ erro: 'usuário não encontrado' }, 404)

  const figure = await figuraSegura(usuario.nick, usuario.figure_fixa)
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

  // A conta do dono do sistema não pode ser excluída por aqui — sem essa
  // trava, qualquer outro admin conseguiria apagar a conta inteira do
  // vcapelli (nick, senha, admin, histórico), o que é bem mais grave do
  // que os campos que a proteção de nick/senha/status/tipo já cobre.
  if (ehContaProtegida(alvo.nick)) {
    return c.json({ erro: `a conta ${NICK_CONTA_PROTEGIDA} não pode ser excluída` }, 400)
  }

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

    // --- Projetos (propostas, correções, sugestões via módulo novo) ---
    db.prepare(`DELETE FROM projeto_votos WHERE usuario_id = ?`).bind(id),
    db.prepare(`DELETE FROM projeto_historico WHERE criado_por_id = ?`).bind(id),
    db.prepare(`UPDATE projetos SET responsavel_id = NULL, responsavel_definido_por_id = NULL WHERE responsavel_id = ? OR responsavel_definido_por_id = ?`).bind(id, id),
    db.prepare(`DELETE FROM projetos WHERE autor_id = ?`).bind(id),

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
    db.prepare(`DELETE FROM ip_listagem_permissoes WHERE usuario_id = ? OR definido_por_id = ?`).bind(id, id),

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
