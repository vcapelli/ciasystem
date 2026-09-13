import { Hono } from 'hono'
import { buscarJogadorHabblet } from '../services/habblet'

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
            u.cor_avatar_fundo, u.avatar_fundo_imagem_url, u.banner_perfil_id, b.imagem_url AS banner_imagem_url,
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

  if (!campos.length) return c.json({ ok: true })

  await c.env.DB.prepare(
    `UPDATE usuarios SET ${campos.join(', ')}, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(...valores, usuarioId).run()

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
            u.cor_avatar_fundo, u.avatar_fundo_imagem_url, u.banner_perfil_id, b.imagem_url AS banner_imagem_url,
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

export default usuarios
