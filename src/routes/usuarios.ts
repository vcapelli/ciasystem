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
// patente, se é admin do sistema, biografia, figure do Habblet). O
// layout do frontend usa isso pra montar a navbar e o card de início.
usuarios.get('/me', async (c) => {
  const usuarioId = c.get('usuarioId')

  const usuario = await c.env.DB.prepare(
    `SELECT u.id, u.nick, u.tag, u.corpo, u.status, u.administrador_sistema, u.biografia,
            p.nome AS patente_nome, p.ordem AS patente_ordem
     FROM usuarios u LEFT JOIN patentes p ON p.id = u.patente_atual_id
     WHERE u.id = ?`
  ).bind(usuarioId).first<{ nick: string }>()

  if (!usuario) return c.json({ erro: 'usuário não encontrado' }, 404)

  const figure = await figuraSegura(usuario.nick)
  return c.json({ ...usuario, figure })
})

// PATCH /usuarios/me — só a biografia é editável por enquanto.
usuarios.patch('/me', async (c) => {
  const usuarioId = c.get('usuarioId')
  const { biografia } = await c.req.json<{ biografia?: string }>()

  await c.env.DB.prepare(
    `UPDATE usuarios SET biografia = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(biografia ?? null, usuarioId).run()

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

// GET /usuarios/nick/:nick — perfil público de qualquer usuário, com figure.
usuarios.get('/nick/:nick', async (c) => {
  const nick = c.req.param('nick')

  const usuario = await c.env.DB.prepare(
    `SELECT u.id, u.nick, u.tag, u.corpo, u.status, u.biografia, u.data_ingresso, u.data_ultimo_ato_funcional,
            p.nome AS patente_nome, p.ordem AS patente_ordem
     FROM usuarios u LEFT JOIN patentes p ON p.id = u.patente_atual_id
     WHERE u.nick = ?`
  ).bind(nick).first<{ nick: string }>()

  if (!usuario) return c.json({ erro: 'usuário não encontrado' }, 404)

  const figure = await figuraSegura(usuario.nick)
  return c.json({ ...usuario, figure })
})

export default usuarios
