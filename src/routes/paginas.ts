import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const paginas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// GET /paginas — lista todas as páginas (inclusive inativas) pro painel
// de administração. Admin-only: aqui ninguém enxerga conteúdo de página
// nenhuma, só metadados pra montar a tabela de gerenciamento.
paginas.get('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema gerenciam páginas customizadas' }, 403)
  }

  const { results } = await c.env.DB.prepare(
    `SELECT pc.id, pc.titulo, pc.caminho, pc.tipo, pc.publica, pc.ativo,
            pc.grupo_restrito_id, pc.patente_minima_id, pc.criado_em, pc.atualizado_em,
            g.nome AS grupo_restrito_nome, p.nome AS patente_minima_nome,
            uc.nick AS criado_por_nick
     FROM paginas_customizadas pc
     LEFT JOIN grupos g ON g.id = pc.grupo_restrito_id
     LEFT JOIN patentes p ON p.id = pc.patente_minima_id
     LEFT JOIN usuarios uc ON uc.id = pc.criado_por_id
     ORDER BY pc.titulo`
  ).all()

  return c.json(results)
})

// GET /paginas/admin/:id — traz a página completa (com conteudo_html) pra
// edição no painel, sem passar pelas checagens de acesso de quem visita.
paginas.get('/admin/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema gerenciam páginas customizadas' }, 403)
  }

  const pagina = await c.env.DB.prepare(`SELECT * FROM paginas_customizadas WHERE id = ?`)
    .bind(c.req.param('id')).first()
  if (!pagina) return c.json({ erro: 'página não encontrada' }, 404)

  return c.json(pagina)
})

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

paginas.patch('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  const id = c.req.param('id')

  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema editam páginas customizadas' }, 403)
  }

  const existente = await c.env.DB.prepare(`SELECT id FROM paginas_customizadas WHERE id = ?`).bind(id).first()
  if (!existente) return c.json({ erro: 'página não encontrada' }, 404)

  const body = await c.req.json<{
    titulo?: string
    caminho?: string
    tipo?: 'independente' | 'dependente'
    conteudo_html?: string
    publica?: boolean
    grupo_restrito_id?: number | null
    patente_minima_id?: number | null
    ativo?: boolean
  }>()

  if (body.caminho !== undefined) {
    const outraComMesmoCaminho = await c.env.DB.prepare(
      `SELECT id FROM paginas_customizadas WHERE caminho = ? AND id != ?`
    ).bind(body.caminho, id).first()
    if (outraComMesmoCaminho) return c.json({ erro: `já existe uma página com o caminho '${body.caminho}'` }, 409)
  }

  const campos: string[] = []
  const valores: unknown[] = []

  if (body.titulo !== undefined) { campos.push('titulo = ?'); valores.push(body.titulo) }
  if (body.caminho !== undefined) { campos.push('caminho = ?'); valores.push(body.caminho) }
  if (body.tipo !== undefined) { campos.push('tipo = ?'); valores.push(body.tipo) }
  if (body.conteudo_html !== undefined) { campos.push('conteudo_html = ?'); valores.push(body.conteudo_html) }
  if (body.publica !== undefined) { campos.push('publica = ?'); valores.push(body.publica ? 1 : 0) }
  if (body.grupo_restrito_id !== undefined) { campos.push('grupo_restrito_id = ?'); valores.push(body.grupo_restrito_id) }
  if (body.patente_minima_id !== undefined) { campos.push('patente_minima_id = ?'); valores.push(body.patente_minima_id) }
  if (body.ativo !== undefined) { campos.push('ativo = ?'); valores.push(body.ativo ? 1 : 0) }

  if (!campos.length) return c.json({ erro: 'nada pra atualizar' }, 400)

  campos.push(`atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')`)
  campos.push('atualizado_por_id = ?')
  valores.push(usuarioId)
  valores.push(id)

  await c.env.DB.prepare(`UPDATE paginas_customizadas SET ${campos.join(', ')} WHERE id = ?`)
    .bind(...valores).run()

  return c.json({ ok: true })
})

paginas.delete('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  const id = c.req.param('id')

  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema removem páginas customizadas' }, 403)
  }

  const existente = await c.env.DB.prepare(`SELECT id FROM paginas_customizadas WHERE id = ?`).bind(id).first()
  if (!existente) return c.json({ erro: 'página não encontrada' }, 404)

  // Soft-delete: some in ativo = 0 em vez de apagar de verdade, consistente
  // com o resto do sistema — o histórico da página não some, só deixa de
  // ficar acessível.
  await c.env.DB.prepare(
    `UPDATE paginas_customizadas
     SET ativo = 0, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'), atualizado_por_id = ?
     WHERE id = ?`
  ).bind(usuarioId, id).run()

  return c.json({ ok: true })
})

export default paginas
