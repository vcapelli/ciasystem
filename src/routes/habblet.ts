import { Hono } from 'hono'
import { buscarJogadorHabblet } from '../services/habblet'

type Bindings = { DB: D1Database }

const habblet = new Hono<{ Bindings: Bindings }>()

// GET /habblet/perfil/:nick — dados públicos direto do Habblet, pra
// pré-visualizar o alvo de requerimentos de porta de entrada
// (Instrução Inicial, Contratação, Compra de Cargo) — casos em que a
// pessoa ainda não tem conta no CIASystem.
habblet.get('/perfil/:nick', async (c) => {
  const nick = c.req.param('nick')

  try {
    const jogador = await buscarJogadorHabblet(nick)
    if (!jogador) return c.json({ erro: 'jogador não encontrado no Habblet' }, 404)
    return c.json({ nick: jogador.username ?? nick, figure: jogador.figure ?? null, motto: jogador.motto ?? null })
  } catch {
    return c.json({ erro: 'não foi possível consultar a API do Habblet agora' }, 502)
  }
})

export default habblet
