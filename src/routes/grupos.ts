import { Hono } from 'hono'
import { ehAdminDoGrupo } from '../services/grupos'

type Bindings = { DB: D1Database }

const grupos = new Hono<{ Bindings: Bindings }>()

// GET /grupos/:slug — dados básicos do hub (pra montar a tela inicial)
grupos.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  const grupo = await c.env.DB.prepare(`SELECT * FROM grupos WHERE slug = ? AND ativo = 1`).bind(slug).first()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  return c.json(grupo)
})

// GET /grupos/:slug/membros — listagem de membros do hub
grupos.get('/:slug/membros', async (c) => {
  const slug = c.req.param('slug')
  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.nick, u.tag, gn.nome AS nivel, ug.administrador_grupo, ug.data_ingresso
     FROM usuario_grupos ug
     JOIN usuarios u ON u.id = ug.usuario_id
     JOIN grupo_niveis gn ON gn.id = ug.nivel_id
     WHERE ug.grupo_id = ? AND ug.ativo = 1
     ORDER BY gn.ordem DESC`
  ).bind(grupo.id).all()

  return c.json(results)
})

// GET /grupos/:slug/registros — requerimentos internos do grupo
grupos.get('/:slug/registros', async (c) => {
  const slug = c.req.param('slug')
  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM grupo_registros WHERE grupo_id = ? ORDER BY criado_em DESC`
  ).bind(grupo.id).all()

  return c.json(results)
})

// POST /grupos/:slug/registros — lança admissão/saída/licença/promoção/
// rebaixamento/advertência interna, restrito a admin do grupo.
grupos.post('/:slug/registros', async (c) => {
  const slug = c.req.param('slug')
  const body = await c.req.json<{
    usuario_id: number
    tipo: string
    nivel_anterior_id?: number
    nivel_novo_id?: number
    motivo?: string
    registrado_por_id: number
  }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, body.registrado_por_id, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO grupo_registros (grupo_id, usuario_id, tipo, nivel_anterior_id, nivel_novo_id, motivo, registrado_por_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(grupo.id, body.usuario_id, body.tipo, body.nivel_anterior_id ?? null, body.nivel_novo_id ?? null, body.motivo ?? null, body.registrado_por_id)
    .run()

  // Se for promoção/rebaixamento interno, já atualiza o nível atual do membro.
  if ((body.tipo === 'promocao' || body.tipo === 'rebaixamento') && body.nivel_novo_id) {
    await c.env.DB.prepare(`UPDATE usuario_grupos SET nivel_id = ? WHERE grupo_id = ? AND usuario_id = ?`)
      .bind(body.nivel_novo_id, grupo.id, body.usuario_id)
      .run()
  }
  if (body.tipo === 'saida') {
    await c.env.DB.prepare(`UPDATE usuario_grupos SET ativo = 0 WHERE grupo_id = ? AND usuario_id = ?`)
      .bind(grupo.id, body.usuario_id)
      .run()
  }

  return c.json({ id: meta.last_row_id }, 201)
})

// --- Aulas (só se grupos.permite_aulas = 1) ---

grupos.post('/:slug/aulas', async (c) => {
  const slug = c.req.param('slug')
  const body = await c.req.json<{
    titulo: string
    descricao?: string
    conteudo: string
    nivel_minimo_id?: number
    ordem?: number
    criado_por_id: number
  }>()

  const grupo = await c.env.DB.prepare(`SELECT id, permite_aulas FROM grupos WHERE slug = ?`)
    .bind(slug)
    .first<{ id: number; permite_aulas: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!grupo.permite_aulas) return c.json({ erro: 'este grupo não permite aulas' }, 400)

  if (!(await ehAdminDoGrupo(c.env.DB, body.criado_por_id, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO grupo_aulas (grupo_id, titulo, descricao, conteudo, nivel_minimo_id, ordem, criado_por_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(grupo.id, body.titulo, body.descricao ?? null, body.conteudo, body.nivel_minimo_id ?? null, body.ordem ?? 0, body.criado_por_id)
    .run()

  return c.json({ id: meta.last_row_id }, 201)
})

// GET /grupos/:slug/aulas?usuario_id=123 — lista aulas visíveis pro nível do usuário
grupos.get('/:slug/aulas', async (c) => {
  const slug = c.req.param('slug')
  const usuarioId = c.req.query('usuario_id')

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM grupo_aulas WHERE grupo_id = ? AND ativo = 1 ORDER BY ordem`
  ).bind(grupo.id).all<{ id: number; nivel_minimo_id: number | null }>()

  if (!usuarioId) return c.json(results.filter((a) => a.nivel_minimo_id === null))

  const membro = await c.env.DB.prepare(
    `SELECT gn.ordem FROM usuario_grupos ug JOIN grupo_niveis gn ON gn.id = ug.nivel_id
     WHERE ug.usuario_id = ? AND ug.grupo_id = ? AND ug.ativo = 1`
  ).bind(usuarioId, grupo.id).first<{ ordem: number }>()

  const visiveis = []
  for (const aula of results) {
    if (aula.nivel_minimo_id === null) {
      visiveis.push(aula)
      continue
    }
    if (!membro) continue
    const minimo = await c.env.DB.prepare(`SELECT ordem FROM grupo_niveis WHERE id = ?`)
      .bind(aula.nivel_minimo_id)
      .first<{ ordem: number }>()
    if (minimo && membro.ordem >= minimo.ordem) visiveis.push(aula)
  }

  return c.json(visiveis)
})

// --- Páginas do hub ---

grupos.post('/:slug/paginas', async (c) => {
  const slug = c.req.param('slug')
  const body = await c.req.json<{
    titulo: string
    caminho: string
    conteudo_html: string
    eh_pagina_inicial?: boolean
    ordem?: number
    criado_por_id: number
  }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, body.criado_por_id, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  try {
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO grupo_paginas (grupo_id, titulo, caminho, conteudo_html, eh_pagina_inicial, ordem, criado_por_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(grupo.id, body.titulo, body.caminho, body.conteudo_html, body.eh_pagina_inicial ? 1 : 0, body.ordem ?? 0, body.criado_por_id)
      .run()
    return c.json({ id: meta.last_row_id }, 201)
  } catch (err) {
    return c.json({ erro: 'já existe uma página com esse caminho, ou já existe uma página inicial neste grupo' }, 409)
  }
})

grupos.get('/:slug/paginas/:caminho', async (c) => {
  const { slug, caminho } = c.req.param()
  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  const pagina = await c.env.DB.prepare(
    `SELECT * FROM grupo_paginas WHERE grupo_id = ? AND caminho = ? AND ativo = 1`
  ).bind(grupo.id, caminho).first()

  if (!pagina) return c.json({ erro: 'página não encontrada' }, 404)
  return c.json(pagina)
})

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId)
    .first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// --- Gestão do grupo em si ---

// POST /grupos — cria um grupo novo (companhia/subcompanhia/órgão),
// restrito a administradores do sistema.
grupos.post('/', async (c) => {
  const body = await c.req.json<{
    codigo: string
    nome: string
    slug: string
    tipo: 'companhia' | 'subcompanhia' | 'orgao_topo' | 'setor_inteligencia'
    permite_aulas?: boolean
    criado_por_id: number
  }>()

  if (!(await ehAdmin(c.env.DB, body.criado_por_id))) {
    return c.json({ erro: 'só administradores do sistema criam grupos' }, 403)
  }

  try {
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO grupos (codigo, nome, slug, tipo, permite_aulas) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(body.codigo, body.nome, body.slug, body.tipo, body.permite_aulas ? 1 : 0)
      .run()
    return c.json({ id: meta.last_row_id }, 201)
  } catch {
    return c.json({ erro: `já existe um grupo com esse código ou slug` }, 409)
  }
})

// PATCH /grupos/:slug — edita dados do grupo, restrito a admin do sistema
grupos.patch('/:slug', async (c) => {
  const slug = c.req.param('slug')
  const body = await c.req.json<{
    nome?: string
    tipo?: string
    permite_aulas?: boolean
    ativo?: boolean
    editado_por_id: number
  }>()

  if (!(await ehAdmin(c.env.DB, body.editado_por_id))) {
    return c.json({ erro: 'só administradores do sistema editam grupos' }, 403)
  }

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  await c.env.DB.prepare(
    `UPDATE grupos SET
      nome = COALESCE(?, nome),
      tipo = COALESCE(?, tipo),
      permite_aulas = COALESCE(?, permite_aulas),
      ativo = COALESCE(?, ativo)
     WHERE id = ?`
  )
    .bind(
      body.nome ?? null,
      body.tipo ?? null,
      body.permite_aulas === undefined ? null : (body.permite_aulas ? 1 : 0),
      body.ativo === undefined ? null : (body.ativo ? 1 : 0),
      grupo.id
    )
    .run()

  return c.json({ ok: true })
})

// --- Cargos internos (grupo_niveis) ---
// Criar/editar/remover é sempre restrito a admin do grupo (ou admin
// do sistema) — a checagem de admin do sistema dentro de
// ehAdminDoGrupo cobre o caso de criar o PRIMEIRO nível/admin de um
// grupo recém-criado, quando ainda não existe ninguém com
// administrador_grupo=1 nele.

grupos.post('/:slug/niveis', async (c) => {
  const slug = c.req.param('slug')
  const body = await c.req.json<{ nome: string; ordem: number; criado_por_id: number }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, body.criado_por_id, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO grupo_niveis (grupo_id, nome, ordem, criado_por_id) VALUES (?, ?, ?, ?)`
  )
    .bind(grupo.id, body.nome, body.ordem, body.criado_por_id)
    .run()

  return c.json({ id: meta.last_row_id }, 201)
})

grupos.get('/:slug/niveis', async (c) => {
  const slug = c.req.param('slug')
  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  const { results } = await c.env.DB.prepare(`SELECT * FROM grupo_niveis WHERE grupo_id = ? ORDER BY ordem`)
    .bind(grupo.id)
    .all()
  return c.json(results)
})

grupos.patch('/:slug/niveis/:nivelId', async (c) => {
  const { slug, nivelId } = c.req.param()
  const body = await c.req.json<{ nome?: string; ordem?: number; editado_por_id: number }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, body.editado_por_id, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  await c.env.DB.prepare(
    `UPDATE grupo_niveis SET
      nome = COALESCE(?, nome),
      ordem = COALESCE(?, ordem),
      atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ? AND grupo_id = ?`
  )
    .bind(body.nome ?? null, body.ordem ?? null, nivelId, grupo.id)
    .run()

  return c.json({ ok: true })
})

grupos.delete('/:slug/niveis/:nivelId', async (c) => {
  const { slug, nivelId } = c.req.param()
  const editadoPorId = Number(c.req.query('editado_por_id'))

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, editadoPorId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  try {
    await c.env.DB.prepare(`DELETE FROM grupo_niveis WHERE id = ? AND grupo_id = ?`).bind(nivelId, grupo.id).run()
    return c.json({ ok: true })
  } catch {
    return c.json({ erro: 'não é possível remover: existem membros ou registros usando este cargo' }, 409)
  }
})

// --- Membros (usuario_grupos) ---

// POST /grupos/:slug/membros — vincula um usuário ao grupo com um
// nível inicial. Cobre também o caso de adicionar o primeiro admin
// interno (administrador_sistema faz bypass em ehAdminDoGrupo).
grupos.post('/:slug/membros', async (c) => {
  const slug = c.req.param('slug')
  const body = await c.req.json<{
    usuario_id: number
    nivel_id: number
    administrador_grupo?: boolean
    adicionado_por_id: number
  }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, body.adicionado_por_id, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  try {
    await c.env.DB.prepare(
      `INSERT INTO usuario_grupos (usuario_id, grupo_id, nivel_id, administrador_grupo) VALUES (?, ?, ?, ?)`
    )
      .bind(body.usuario_id, grupo.id, body.nivel_id, body.administrador_grupo ? 1 : 0)
      .run()
  } catch {
    return c.json({ erro: 'usuário já é membro deste grupo' }, 409)
  }

  await c.env.DB.prepare(
    `INSERT INTO grupo_registros (grupo_id, usuario_id, tipo, nivel_novo_id, registrado_por_id)
     VALUES (?, ?, 'admissao', ?, ?)`
  )
    .bind(grupo.id, body.usuario_id, body.nivel_id, body.adicionado_por_id)
    .run()

  return c.json({ ok: true }, 201)
})

// PATCH /grupos/:slug/membros/:usuarioId — muda nível, status de admin,
// ou remove do grupo (ativo=false).
grupos.patch('/:slug/membros/:usuarioId', async (c) => {
  const { slug, usuarioId } = c.req.param()
  const body = await c.req.json<{
    nivel_id?: number
    administrador_grupo?: boolean
    ativo?: boolean
    editado_por_id: number
  }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, body.editado_por_id, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  await c.env.DB.prepare(
    `UPDATE usuario_grupos SET
      nivel_id = COALESCE(?, nivel_id),
      administrador_grupo = COALESCE(?, administrador_grupo),
      ativo = COALESCE(?, ativo)
     WHERE usuario_id = ? AND grupo_id = ?`
  )
    .bind(
      body.nivel_id ?? null,
      body.administrador_grupo === undefined ? null : (body.administrador_grupo ? 1 : 0),
      body.ativo === undefined ? null : (body.ativo ? 1 : 0),
      usuarioId,
      grupo.id
    )
    .run()

  return c.json({ ok: true })
})

// --- Notícias de grupo ---

grupos.post('/:slug/noticias', async (c) => {
  const slug = c.req.param('slug')
  const body = await c.req.json<{ titulo: string; conteudo: string; autor_id: number; operado_por_id?: number }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, body.autor_id, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO grupo_noticias (grupo_id, titulo, conteudo, autor_id, operado_por_id) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(grupo.id, body.titulo, body.conteudo, body.autor_id, body.operado_por_id ?? null)
    .run()

  return c.json({ id: meta.last_row_id }, 201)
})

grupos.post('/:slug/noticias/:noticiaId/publicar', async (c) => {
  const { slug, noticiaId } = c.req.param()
  const { publicado_por_id } = await c.req.json<{ publicado_por_id: number }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, publicado_por_id, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  await c.env.DB.prepare(
    `UPDATE grupo_noticias SET status = 'publicada', publicado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ? AND grupo_id = ?`
  ).bind(noticiaId, grupo.id).run()

  return c.json({ ok: true })
})

grupos.get('/:slug/noticias', async (c) => {
  const slug = c.req.param('slug')
  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM grupo_noticias WHERE grupo_id = ? ORDER BY criado_em DESC`
  ).bind(grupo.id).all()

  return c.json(results)
})

export default grupos
