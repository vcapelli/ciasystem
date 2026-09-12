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

// GET /usuarios?busca=texto — busca simples por nick (autocomplete de
// alvos em formulários, listagem de membros etc.) — sem figure aqui de
// propósito: uma lista de até 100 usuários faria 100 chamadas externas
// à API do Habblet, o que é caro e lento demais pra uma listagem.
usuarios.get('/', async (c) => {
  const busca = c.req.query('busca')

  const query = busca
    ? c.env.DB.prepare(
        `SELECT u.id, u.nick, u.tag, u.corpo, u.status, p.nome AS patente_nome
         FROM usuarios u LEFT JOIN patentes p ON p.id = u.patente_atual_id
         WHERE u.nick LIKE ? ORDER BY u.nick LIMIT 20`
      ).bind(`%${busca}%`)
    : c.env.DB.prepare(
        `SELECT u.id, u.nick, u.tag, u.corpo, u.status, p.nome AS patente_nome
         FROM usuarios u LEFT JOIN patentes p ON p.id = u.patente_atual_id
         ORDER BY p.ordem DESC LIMIT 100`
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
