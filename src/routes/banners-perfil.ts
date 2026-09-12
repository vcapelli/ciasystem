import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const bannersPerfil = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// GET /banners-perfil — lista os banners disponíveis pra qualquer
// usuário escolher no próprio perfil.
bannersPerfil.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM banners_perfil WHERE ativo = 1 ORDER BY criado_em DESC`).all()
  return c.json(results)
})

// POST /banners-perfil — cadastra um novo banner disponível. Só admin.
bannersPerfil.post('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema cadastram banners' }, 403)
  }

  const { imagem_url, nome } = await c.req.json<{ imagem_url: string; nome?: string }>()
  if (!imagem_url) return c.json({ erro: 'imagem_url é obrigatório' }, 400)

  const { meta } = await c.env.DB.prepare(`INSERT INTO banners_perfil (imagem_url, nome) VALUES (?, ?)`)
    .bind(imagem_url, nome ?? null).run()

  return c.json({ id: meta.last_row_id }, 201)
})

// DELETE /banners-perfil/:id — remove da lista (soft delete). Só admin.
// Quem já tinha esse banner escolhido volta pro padrão automaticamente
// (a coluna usuarios.banner_perfil_id vira inválida e o frontend já
// trata "banner não encontrado" caindo pro padrão).
bannersPerfil.delete('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema removem banners' }, 403)
  }

  await c.env.DB.prepare(`UPDATE banners_perfil SET ativo = 0 WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

export default bannersPerfil
