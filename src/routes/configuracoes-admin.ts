import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const configuracoesAdmin = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// PATCH /configuracoes — define/atualiza uma ou mais chaves de
// configuração global. Só administradores do sistema.
configuracoesAdmin.patch('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema alteram configurações' }, 403)
  }

  const valores = await c.req.json<Record<string, string>>()

  for (const [chave, valor] of Object.entries(valores)) {
    await c.env.DB.prepare(
      `INSERT INTO configuracoes_sistema (chave, valor) VALUES (?, ?)
       ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')`
    ).bind(chave, valor).run()
  }

  return c.json({ ok: true })
})

export default configuracoesAdmin
