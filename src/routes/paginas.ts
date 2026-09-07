import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const paginas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

paginas.post('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  const body = await c.req.json<{
    titulo: string
    caminho: string
    tipo: 'independente' | 'dependente'
    conteudo_html: string
    publica?: boolean
    grupo_restrito_id?: number
    patente_minima_id?: number
  }>()

  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema criam páginas customizadas' }, 403)
  }

  const existente = await c.env.DB.prepare(`SELECT id FROM paginas_customizadas WHERE caminho = ?`)
    .bind(body.caminho).first()
  if (existente) return c.json({ erro: `já existe uma página com o caminho '${body.caminho}'` }, 409)

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO paginas_customizadas
      (titulo, caminho, tipo, conteudo_html, publica, grupo_restrito_id, patente_minima_id, criado_por_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.titulo, body.caminho, body.tipo, body.conteudo_html, body.publica ? 1 : 0,
      body.grupo_restrito_id ?? null, body.patente_minima_id ?? null, usuarioId
    )
    .run()

  return c.json({ id: meta.last_row_id }, 201)
})

// GET /paginas/:caminho — quem chega aqui já está autenticado; "publica"
// só quer dizer "sem restrição extra de grupo/patente", não "sem login".
paginas.get('/:caminho', async (c) => {
  const caminho = c.req.param('caminho')
  const usuarioId = c.get('usuarioId')

  const pagina = await c.env.DB.prepare(`SELECT * FROM paginas_customizadas WHERE caminho = ? AND ativo = 1`)
    .bind(caminho)
    .first<{
      id: number; titulo: string; tipo: string; conteudo_html: string; publica: number
      grupo_restrito_id: number | null; patente_minima_id: number | null
    }>()

  if (!pagina) return c.json({ erro: 'página não encontrada' }, 404)

  if (!pagina.publica) {
    if (pagina.grupo_restrito_id !== null) {
      const membro = await c.env.DB.prepare(
        `SELECT 1 FROM usuario_grupos WHERE usuario_id = ? AND grupo_id = ? AND ativo = 1`
      ).bind(usuarioId, pagina.grupo_restrito_id).first()
      if (!membro) return c.json({ erro: 'sem acesso a esta página' }, 403)
    }

    if (pagina.patente_minima_id !== null) {
      const usuario = await c.env.DB.prepare(`SELECT patente_atual_id FROM usuarios WHERE id = ?`)
        .bind(usuarioId).first<{ patente_atual_id: number | null }>()
      if (!usuario?.patente_atual_id) return c.json({ erro: 'sem acesso a esta página' }, 403)

      const cmp = await c.env.DB.prepare(
        `SELECT (p_alvo.ordem >= p_min.ordem AND p_alvo.corpo = p_min.corpo) AS ok
         FROM patentes p_alvo, patentes p_min WHERE p_alvo.id = ? AND p_min.id = ?`
      ).bind(usuario.patente_atual_id, pagina.patente_minima_id).first<{ ok: number }>()
      if (!cmp?.ok) return c.json({ erro: 'sem acesso a esta página' }, 403)
    }
  }

  return c.json(pagina)
})

export default paginas
