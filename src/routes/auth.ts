import { Hono } from 'hono'
import { gerarToken } from '../services/auth'
import { hashSenha, conferirSenha } from '../services/senha'
import { registrarEvento } from '../services/logs'

type Bindings = { DB: D1Database; JWT_SECRET: string }

const auth = new Hono<{ Bindings: Bindings }>()

function gerarCodigo(): string {
  // 6 dígitos, fácil de digitar na missão do Habblet.
  return Math.floor(100000 + Math.random() * 900000).toString()
}

/**
 * POST /auth/solicitar-codigo — gera um código de verificação pra
 * `finalidade` ('login' ou 'senha'). Em produção, o próximo passo real
 * seria o usuário colar esse código na missão do Habblet e o sistema
 * confirmar via api.habblet.city — essa integração com a API do
 * Habblet ainda NÃO existe neste Worker, então por enquanto o código
 * é devolvido direto na resposta (só serve pra desenvolvimento/teste;
 * precisa ser substituído antes de qualquer uso real).
 */
auth.post('/solicitar-codigo', async (c) => {
  const { nick, finalidade } = await c.req.json<{ nick: string; finalidade: 'login' | 'senha' }>()

  const codigo = gerarCodigo()
  const expiraEm = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutos

  await c.env.DB.prepare(
    `INSERT INTO codigos_verificacao (nick, codigo, finalidade, expira_em) VALUES (?, ?, ?, ?)`
  ).bind(nick, codigo, finalidade, expiraEm).run()

  // TODO: em produção, não devolver o código na resposta — ele deve
  // ir só pra missão do Habblet, verificado via api.habblet.city.
  return c.json({ codigo, expira_em: expiraEm, aviso: 'TODO: integração real com Habblet ainda não existe' })
})

/**
 * POST /auth/login — nick + código (finalidade='login'). Se o
 * usuário ainda não existe em `usuarios` (primeiro login), isso
 * falha — criação de conta acontece via as 3 portas de entrada
 * (Instrução Inicial/Contratação/Compra de Cargo), não aqui.
 */
auth.post('/login', async (c) => {
  const { nick, codigo } = await c.req.json<{ nick: string; codigo: string }>()

  const verificacao = await c.env.DB.prepare(
    `SELECT id FROM codigos_verificacao
     WHERE nick = ? AND codigo = ? AND finalidade = 'login' AND usado = 0 AND expira_em > strftime('%Y-%m-%dT%H:%M:%SZ','now')
     ORDER BY id DESC LIMIT 1`
  ).bind(nick, codigo).first<{ id: number }>()

  if (!verificacao) return c.json({ erro: 'código inválido ou expirado' }, 401)

  const usuario = await c.env.DB.prepare(`SELECT id FROM usuarios WHERE nick = ?`).bind(nick).first<{ id: number }>()
  if (!usuario) return c.json({ erro: 'nenhuma conta encontrada com esse nick' }, 404)

  await c.env.DB.prepare(`UPDATE codigos_verificacao SET usado = 1 WHERE id = ?`).bind(verificacao.id).run()

  const token = await gerarToken(usuario.id, c.env.JWT_SECRET)
  await registrarEvento(c.env.DB, usuario.id, 'login', { detalhes: { metodo: 'codigo' } })

  return c.json({ token })
})

/**
 * POST /auth/login-senha — nick + senha (só funciona se o usuário já
 * configurou uma senha antes via /auth/definir-senha).
 */
auth.post('/login-senha', async (c) => {
  const { nick, senha } = await c.req.json<{ nick: string; senha: string }>()

  const usuario = await c.env.DB.prepare(`SELECT id, senha_hash FROM usuarios WHERE nick = ?`)
    .bind(nick)
    .first<{ id: number; senha_hash: string | null }>()

  if (!usuario?.senha_hash) return c.json({ erro: 'nick ou senha inválidos' }, 401)

  const senhaCorreta = await conferirSenha(senha, usuario.senha_hash)
  if (!senhaCorreta) return c.json({ erro: 'nick ou senha inválidos' }, 401)

  const token = await gerarToken(usuario.id, c.env.JWT_SECRET)
  await registrarEvento(c.env.DB, usuario.id, 'login', { detalhes: { metodo: 'senha' } })

  return c.json({ token })
})

/**
 * POST /auth/definir-senha — nick + código (finalidade='senha') +
 * nova senha. Serve tanto pra criar a senha pela primeira vez quanto
 * pra trocar — sempre exige um código novo da missão, nunca só a
 * senha atual.
 */
auth.post('/definir-senha', async (c) => {
  const { nick, codigo, senha } = await c.req.json<{ nick: string; codigo: string; senha: string }>()

  const verificacao = await c.env.DB.prepare(
    `SELECT id FROM codigos_verificacao
     WHERE nick = ? AND codigo = ? AND finalidade = 'senha' AND usado = 0 AND expira_em > strftime('%Y-%m-%dT%H:%M:%SZ','now')
     ORDER BY id DESC LIMIT 1`
  ).bind(nick, codigo).first<{ id: number }>()

  if (!verificacao) return c.json({ erro: 'código inválido ou expirado' }, 401)

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

export default auth
