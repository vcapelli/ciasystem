import { Hono } from 'hono'
import { gerarToken } from '../services/auth'
import { hashSenha, conferirSenha } from '../services/senha'
import { verificarCodigoNaMissao } from '../services/habblet'
import { registrarEvento } from '../services/logs'

type Bindings = { DB: D1Database; JWT_SECRET: string }

const auth = new Hono<{ Bindings: Bindings }>()

function gerarCodigo(): string {
  const numeros = Math.floor(100000 + Math.random() * 900000)
  return `CIA-${numeros}`
}

/**
 * POST /auth/solicitar-codigo — gera um código de verificação pra
 * `finalidade` ('login' ou 'senha'). A pessoa cola esse código na
 * missão do Habblet; o /login ou /definir-senha confirma via a API
 * do Habblet que o código está lá antes de aceitar — devolver o
 * código aqui não é o problema de segurança (é assim que a pessoa
 * fica sabendo o que digitar no jogo); o problema seria aceitar o
 * código sem checar a missão de verdade, o que já não acontece mais.
 */
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

/**
 * POST /auth/login — nick + código (finalidade='login'). Confirma o
 * código no banco (existe, não usado, não expirado) E na missão real
 * do Habblet (prova posse da conta) antes de emitir o token.
 */
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

  const token = await gerarToken(usuario.id, c.env.JWT_SECRET)
  await registrarEvento(c.env.DB, usuario.id, 'login', { detalhes: { metodo: 'codigo' } })

  return c.json({ token })
})

auth.post('/login-senha', async (c) => {
  const { nick, senha } = await c.req.json<{ nick: string; senha: string }>()

  const usuario = await c.env.DB.prepare(`SELECT id, senha_hash FROM usuarios WHERE nick = ?`)
    .bind(nick).first<{ id: number; senha_hash: string | null }>()

  if (!usuario?.senha_hash) return c.json({ erro: 'nick ou senha inválidos' }, 401)

  const senhaCorreta = await conferirSenha(senha, usuario.senha_hash)
  if (!senhaCorreta) return c.json({ erro: 'nick ou senha inválidos' }, 401)

  const token = await gerarToken(usuario.id, c.env.JWT_SECRET)
  await registrarEvento(c.env.DB, usuario.id, 'login', { detalhes: { metodo: 'senha' } })

  return c.json({ token })
})

/**
 * POST /auth/definir-senha — mesma checagem dupla (banco + missão
 * real do Habblet) que o login por código, já que criar/trocar senha
 * é tão sensível quanto logar.
 */
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

export default auth
