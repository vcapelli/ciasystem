// JWT (via hono/jwt, usa Web Crypto — nativo do runtime de Workers) +
// refresh tokens (opacos, hasheados no banco) + middleware de auth.
//
// O access token (JWT) só carrega `sub` (usuario_id) e `exp`, dura
// 1 hora. Nenhuma permissão fica no payload — tudo é consultado
// fresco no banco a cada request, pra revogação de admin ter efeito
// imediato. O refresh token é o que sustenta a sessão de verdade
// (30 dias) e é a única coisa que pode ser revogada antes de expirar
// (JWT puro não dá pra revogar — só esperar expirar).

import { sign, verify } from 'hono/jwt'
import type { Context, Next } from 'hono'

const UMA_HORA_EM_SEGUNDOS = 60 * 60
const TRINTA_DIAS_EM_MS = 1000 * 60 * 60 * 24 * 30

export async function gerarAccessToken(usuarioId: number, secret: string): Promise<string> {
  return sign(
    { sub: usuarioId, exp: Math.floor(Date.now() / 1000) + UMA_HORA_EM_SEGUNDOS },
    secret
  )
}

/** Gera um refresh token opaco de alta entropia (256 bits, hex). */
function gerarRefreshTokenBruto(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function hashToken(token: string): Promise<string> {
  const dados = new TextEncoder().encode(token)
  const hashBuffer = await crypto.subtle.digest('SHA-256', dados)
  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Cria uma sessão nova: gera o refresh token, guarda só o HASH dele no
 * banco (o valor em texto plano nunca é persistido — só devolvido
 * uma vez aqui, pro chamador repassar ao cliente).
 */
export async function criarSessao(
  db: D1Database,
  usuarioId: number,
  contexto?: { userAgent?: string; ip?: string }
): Promise<{ refreshToken: string; expiraEm: string }> {
  const refreshToken = gerarRefreshTokenBruto()
  const hash = await hashToken(refreshToken)
  const expiraEm = new Date(Date.now() + TRINTA_DIAS_EM_MS).toISOString()

  await db
    .prepare(`INSERT INTO refresh_tokens (usuario_id, token_hash, expira_em, user_agent, ip) VALUES (?, ?, ?, ?, ?)`)
    .bind(usuarioId, hash, expiraEm, contexto?.userAgent ?? null, contexto?.ip ?? null)
    .run()

  return { refreshToken, expiraEm }
}

/**
 * Valida um refresh token (existe, não revogado, não expirado) e
 * devolve o usuario_id dono dele — ou `null` se inválido por
 * qualquer motivo.
 */
export async function validarRefreshToken(db: D1Database, refreshToken: string): Promise<number | null> {
  const hash = await hashToken(refreshToken)
  const sessao = await db
    .prepare(
      `SELECT usuario_id FROM refresh_tokens
       WHERE token_hash = ? AND revogado = 0 AND expira_em > strftime('%Y-%m-%dT%H:%M:%SZ','now')`
    )
    .bind(hash)
    .first<{ usuario_id: number }>()

  return sessao?.usuario_id ?? null
}

/** Revoga 1 sessão específica (logout de um dispositivo). */
export async function revogarSessao(db: D1Database, refreshToken: string): Promise<void> {
  const hash = await hashToken(refreshToken)
  await db.prepare(`UPDATE refresh_tokens SET revogado = 1 WHERE token_hash = ?`).bind(hash).run()
}

/** Revoga TODAS as sessões de um usuário (logout de todos os dispositivos). */
export async function revogarTodasSessoes(db: D1Database, usuarioId: number): Promise<void> {
  await db.prepare(`UPDATE refresh_tokens SET revogado = 1 WHERE usuario_id = ?`).bind(usuarioId).run()
}

type BindingsComSecret = { JWT_SECRET: string }
type VariablesComUsuario = { usuarioId: number }

/**
 * Middleware: exige `Authorization: Bearer <access_token>`. Nenhuma
 * rota downstream deve confiar em usuario_id vindo do corpo da
 * requisição pra saber "quem está fazendo essa ação" — só pra
 * identificar alvos (outras pessoas), nunca o próprio ator.
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
