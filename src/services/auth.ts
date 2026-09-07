// JWT (via hono/jwt, que usa Web Crypto — nativo do runtime de
// Workers, sem dependência externa) + middleware de autenticação.
//
// O payload do token só carrega `sub` (usuario_id) e `exp`. Não
// carrega administrador_sistema nem qualquer outra permissão — isso
// é sempre consultado fresco no banco a cada request, pra uma
// revogação de admin ter efeito imediato (não esperar o token expirar).

import { sign, verify } from 'hono/jwt'
import type { Context, Next } from 'hono'

const SETE_DIAS_EM_SEGUNDOS = 60 * 60 * 24 * 7

export async function gerarToken(usuarioId: number, secret: string): Promise<string> {
  return sign(
    { sub: usuarioId, exp: Math.floor(Date.now() / 1000) + SETE_DIAS_EM_SEGUNDOS },
    secret
  )
}

type BindingsComSecret = { JWT_SECRET: string }
type VariablesComUsuario = { usuarioId: number }

/**
 * Middleware: exige `Authorization: Bearer <token>`, valida contra
 * JWT_SECRET, e disponibiliza o usuario_id autenticado via
 * `c.get('usuarioId')` pro resto da cadeia. Nenhuma rota downstream
 * deve mais confiar em usuario_id vindo do corpo da requisição pra
 * saber "quem está fazendo essa ação" — só pra identificar alvos
 * (outras pessoas), nunca o próprio ator.
 */
export async function requireAuth(
  c: Context<{ Bindings: BindingsComSecret; Variables: VariablesComUsuario }>,
  next: Next
) {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ erro: 'token de autenticação ausente' }, 401)
  }

  const token = header.slice('Bearer '.length)

  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256')
    const usuarioId = Number((payload as { sub: unknown }).sub)
    if (!usuarioId) throw new Error('payload sem sub válido')
    c.set('usuarioId', usuarioId)
    await next()
  } catch {
    return c.json({ erro: 'token inválido ou expirado' }, 401)
  }
}
