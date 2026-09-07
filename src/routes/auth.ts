import { Hono } from 'hono'
import { gerarAccessToken, criarSessao, validarRefreshToken, revogarSessao, revogarTodasSessoes } from '../services/auth'
import { hashSenha, conferirSenha } from '../services/senha'
import { verificarCodigoNaMissao } from '../services/habblet'
import { registrarEvento } from '../services/logs'

type Bindings = { DB: D1Database; JWT_SECRET: string }

const auth = new Hono<{ Bindings: Bindings }>()

function gerarCodigo(): string {
  const numeros = Math.floor(100000 + Math.random() * 900000)
  return `CIA-${numeros}`
}

/** Emite os dois tokens de uma sessão nova e registra o evento de login. */
async function emitirSessao(c: { env: Bindings; req: { header: (nome: string) => string | undefined } }, usuarioId: number, metodo: string) {
  const accessToken = await gerarAccessToken(usuarioId, c.env.JWT_SECRET)
  const { refreshToken, expiraEm } = await criarSessao(c.env.DB, usuarioId, {
    userAgent: c.req.header('User-Agent'),
  })
  await registrarEvento(c.env.DB, usuarioId, 'login', { detalhes: { metodo } })

  return { access_token: accessToken, refresh_token: refreshToken, refresh_expira_em: expiraEm }
}

auth.post('/solicitar-codigo', async (c) => {
  const { nick, finalidade } = await c.req.json<{ nick: string; finalidade: 'login' | 'senha' }>()

  const codigo = gerarCodigo()
  const expiraEm = new Date(Date.now() + 10 * 60 * 1000).toISOString()

  await c.env.DB.prepare(
    `INSERT INTO codigos_verificacao (nick, codigo, finalidade, expira_em) VALUES (?, ?, ?, ?)`
  ).bind(nick, codigo, finalidade, expiraEm).run()

  return c.json({
    codigo,
    expira_em: expiraEm,
    instrucao: `Coloque o código ${codigo} na sua missão do Habblet e confirme em seguida.`,
  })
})

auth.post('/login', async (c) => {
  const { nick, codigo } = await c.req.json<{ nick: string; codigo: string }>()

  const verificacao = await c.env.DB.prepare(
    `SELECT id FROM codigos_verificacao
     WHERE nick = ? AND codigo = ? AND finalidade = 'login' AND usado = 0 AND expira_em > strftime('%Y-%m-%dT%H:%M:%SZ','now')
     ORDER BY id DESC LIMIT 1`
  ).bind(nick, codigo).first<{ id: number }>()

  if (!verificacao) return c.json({ erro: 'código inválido ou expirado' }, 401)

  let codigoNaMissao: boolean
  try {
    codigoNaMissao = await verificarCodigoNaMissao(nick, codigo)
  } catch {
    return c.json({ erro: 'não foi possível confirmar a missão no Habblet no momento, tente novamente' }, 502)
  }
  if (!codigoNaMissao) {
    return c.json({ erro: 'código não encontrado na missão do Habblet — confirme que colocou certinho e tente de novo' }, 401)
  }

  const usuario = await c.env.DB.prepare(`SELECT id FROM usuarios WHERE nick = ?`).bind(nick).first<{ id: number }>()
  if (!usuario) return c.json({ erro: 'nenhuma conta encontrada com esse nick' }, 404)

  await c.env.DB.prepare(`UPDATE codigos_verificacao SET usado = 1 WHERE id = ?`).bind(verificacao.id).run()

  return c.json(await emitirSessao(c, usuario.id, 'codigo'))
})

auth.post('/login-senha', async (c) => {
  const { nick, senha } = await c.req.json<{ nick: string; senha: string }>()

  const usuario = await c.env.DB.prepare(`SELECT id, senha_hash FROM usuarios WHERE nick = ?`)
    .bind(nick).first<{ id: number; senha_hash: string | null }>()

  if (!usuario?.senha_hash) return c.json({ erro: 'nick ou senha inválidos' }, 401)

  const senhaCorreta = await conferirSenha(senha, usuario.senha_hash)
  if (!senhaCorreta) return c.json({ erro: 'nick ou senha inválidos' }, 401)

  return c.json(await emitirSessao(c, usuario.id, 'senha'))
})

auth.post('/definir-senha', async (c) => {
  const { nick, codigo, senha } = await c.req.json<{ nick: string; codigo: string; senha: string }>()

  const verificacao = await c.env.DB.prepare(
    `SELECT id FROM codigos_verificacao
     WHERE nick = ? AND codigo = ? AND finalidade = 'senha' AND usado = 0 AND expira_em > strftime('%Y-%m-%dT%H:%M:%SZ','now')
     ORDER BY id DESC LIMIT 1`
  ).bind(nick, codigo).first<{ id: number }>()

  if (!verificacao) return c.json({ erro: 'código inválido ou expirado' }, 401)

  let codigoNaMissao: boolean
  try {
    codigoNaMissao = await verificarCodigoNaMissao(nick, codigo)
  } catch {
    return c.json({ erro: 'não foi possível confirmar a missão no Habblet no momento, tente novamente' }, 502)
  }
  if (!codigoNaMissao) {
    return c.json({ erro: 'código não encontrado na missão do Habblet — confirme que colocou certinho e tente de novo' }, 401)
  }

  const usuario = await c.env.DB.prepare(`SELECT id FROM usuarios WHERE nick = ?`).bind(nick).first<{ id: number }>()
  if (!usuario) return c.json({ erro: 'nenhuma conta encontrada com esse nick' }, 404)

  const hash = await hashSenha(senha)
  await c.env.DB.prepare(
    `UPDATE usuarios SET senha_hash = ?, senha_atualizada_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(hash, usuario.id).run()

  await c.env.DB.prepare(`UPDATE codigos_verificacao SET usado = 1 WHERE id = ?`).bind(verificacao.id).run()
  await registrarEvento(c.env.DB, usuario.id, 'senha_definida')

  return c.json({ ok: true })
})

/**
 * POST /auth/refresh — troca um refresh token válido por um access
 * token novo. Faz ROTAÇÃO: o refresh token usado é revogado e um novo
 * é emitido no lugar — se alguém roubar um refresh token e usar
 * depois do dono legítimo já ter usado (ou vice-versa), o token
 * roubado já estará revogado, o que ajuda a detectar o vazamento.
 */
auth.post('/refresh', async (c) => {
  const { refresh_token } = await c.req.json<{ refresh_token: string }>()
  if (!refresh_token) return c.json({ erro: 'refresh_token é obrigatório' }, 400)

  const usuarioId = await validarRefreshToken(c.env.DB, refresh_token)
  if (!usuarioId) return c.json({ erro: 'refresh token inválido, expirado ou revogado — faça login novamente' }, 401)

  await revogarSessao(c.env.DB, refresh_token)

  const accessToken = await gerarAccessToken(usuarioId, c.env.JWT_SECRET)
  const { refreshToken: novoRefreshToken, expiraEm } = await criarSessao(c.env.DB, usuarioId, {
    userAgent: c.req.header('User-Agent'),
  })

  return c.json({ access_token: accessToken, refresh_token: novoRefreshToken, refresh_expira_em: expiraEm })
})

/** POST /auth/logout — revoga só a sessão desse refresh token. */
auth.post('/logout', async (c) => {
  const { refresh_token } = await c.req.json<{ refresh_token: string }>()
  if (refresh_token) await revogarSessao(c.env.DB, refresh_token)
  return c.json({ ok: true })
})

/** POST /auth/logout-todos — revoga TODAS as sessões do dono desse refresh token. */
auth.post('/logout-todos', async (c) => {
  const { refresh_token } = await c.req.json<{ refresh_token: string }>()
  if (!refresh_token) return c.json({ erro: 'refresh_token é obrigatório' }, 400)

  const usuarioId = await validarRefreshToken(c.env.DB, refresh_token)
  if (!usuarioId) return c.json({ erro: 'refresh token inválido' }, 401)

  await revogarTodasSessoes(c.env.DB, usuarioId)
  return c.json({ ok: true })
})

export default auth
