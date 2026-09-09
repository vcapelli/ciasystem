import { Hono } from 'hono'
import { ehAdminDoGrupo } from '../services/grupos'
import { resolverAutor } from '../services/autor'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const grupos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// --- Leitura do hub ---

// GET /grupos — lista todos os grupos ativos, com contagem de membros
// (pra tela de listagem geral).
grupos.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT g.*,
       (SELECT COUNT(*) FROM usuario_grupos ug WHERE ug.grupo_id = g.id AND ug.ativo = 1) AS total_membros
     FROM grupos g WHERE g.ativo = 1 ORDER BY g.tipo, g.nome`
  ).all()
  return c.json(results)
})

grupos.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  const grupo = await c.env.DB.prepare(`SELECT * FROM grupos WHERE slug = ? AND ativo = 1`).bind(slug).first()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  return c.json(grupo)
})

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

// --- Gestão do grupo em si ---

grupos.post('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  const body = await c.req.json<{
    codigo: string
    nome: string
    slug: string
    tipo: 'companhia' | 'subcompanhia' | 'orgao_topo' | 'setor_inteligencia'
    permite_aulas?: boolean
  }>()

  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema criam grupos' }, 403)
  }

  try {
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO grupos (codigo, nome, slug, tipo, permite_aulas) VALUES (?, ?, ?, ?, ?)`
    ).bind(body.codigo, body.nome, body.slug, body.tipo, body.permite_aulas ? 1 : 0).run()
    return c.json({ id: meta.last_row_id }, 201)
  } catch {
    return c.json({ erro: 'já existe um grupo com esse código ou slug' }, 409)
  }
})

grupos.patch('/:slug', async (c) => {
  const usuarioId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const body = await c.req.json<{ nome?: string; tipo?: string; permite_aulas?: boolean; ativo?: boolean }>()

  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema editam grupos' }, 403)
  }

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  await c.env.DB.prepare(
    `UPDATE grupos SET
      nome = COALESCE(?, nome), tipo = COALESCE(?, tipo),
      permite_aulas = COALESCE(?, permite_aulas), ativo = COALESCE(?, ativo)
     WHERE id = ?`
  )
    .bind(
      body.nome ?? null, body.tipo ?? null,
      body.permite_aulas === undefined ? null : (body.permite_aulas ? 1 : 0),
      body.ativo === undefined ? null : (body.ativo ? 1 : 0),
      grupo.id
    )
    .run()

  return c.json({ ok: true })
})

// --- Cargos internos (grupo_niveis) ---

grupos.post('/:slug/niveis', async (c) => {
  const usuarioId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const body = await c.req.json<{ nome: string; ordem: number }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO grupo_niveis (grupo_id, nome, ordem, criado_por_id) VALUES (?, ?, ?, ?)`
  ).bind(grupo.id, body.nome, body.ordem, usuarioId).run()

  return c.json({ id: meta.last_row_id }, 201)
})

grupos.get('/:slug/niveis', async (c) => {
  const slug = c.req.param('slug')
  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  const { results } = await c.env.DB.prepare(`SELECT * FROM grupo_niveis WHERE grupo_id = ? ORDER BY ordem`).bind(grupo.id).all()
  return c.json(results)
})

grupos.patch('/:slug/niveis/:nivelId', async (c) => {
  const usuarioId = c.get('usuarioId')
  const { slug, nivelId } = c.req.param()
  const body = await c.req.json<{ nome?: string; ordem?: number }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  await c.env.DB.prepare(
    `UPDATE grupo_niveis SET nome = COALESCE(?, nome), ordem = COALESCE(?, ordem), atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ? AND grupo_id = ?`
  ).bind(body.nome ?? null, body.ordem ?? null, nivelId, grupo.id).run()

  return c.json({ ok: true })
})

grupos.delete('/:slug/niveis/:nivelId', async (c) => {
  const usuarioId = c.get('usuarioId')
  const { slug, nivelId } = c.req.param()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
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

grupos.post('/:slug/membros', async (c) => {
  const usuarioId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const body = await c.req.json<{ usuario_id: number; nivel_id: number; administrador_grupo?: boolean }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  try {
    await c.env.DB.prepare(
      `INSERT INTO usuario_grupos (usuario_id, grupo_id, nivel_id, administrador_grupo) VALUES (?, ?, ?, ?)`
    ).bind(body.usuario_id, grupo.id, body.nivel_id, body.administrador_grupo ? 1 : 0).run()
  } catch {
    return c.json({ erro: 'usuário já é membro deste grupo' }, 409)
  }

  await c.env.DB.prepare(
    `INSERT INTO grupo_registros (grupo_id, usuario_id, tipo, nivel_novo_id, registrado_por_id) VALUES (?, ?, 'admissao', ?, ?)`
  ).bind(grupo.id, body.usuario_id, body.nivel_id, usuarioId).run()

  return c.json({ ok: true }, 201)
})

grupos.patch('/:slug/membros/:usuarioId', async (c) => {
  const editadoPorId = c.get('usuarioId')
  const { slug, usuarioId: alvoId } = c.req.param()
  const body = await c.req.json<{ nivel_id?: number; administrador_grupo?: boolean; ativo?: boolean }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, editadoPorId, grupo.id))) {
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
      alvoId, grupo.id
    )
    .run()

  return c.json({ ok: true })
})

// --- Registros internos ---

grupos.get('/:slug/registros', async (c) => {
  const slug = c.req.param('slug')
  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  const { results } = await c.env.DB.prepare(`SELECT * FROM grupo_registros WHERE grupo_id = ? ORDER BY criado_em DESC`)
    .bind(grupo.id).all()
  return c.json(results)
})

grupos.post('/:slug/registros', async (c) => {
  const registradoPorId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const body = await c.req.json<{
    usuario_id: number; tipo: string; nivel_anterior_id?: number; nivel_novo_id?: number; motivo?: string
  }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, registradoPorId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO grupo_registros (grupo_id, usuario_id, tipo, nivel_anterior_id, nivel_novo_id, motivo, registrado_por_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(grupo.id, body.usuario_id, body.tipo, body.nivel_anterior_id ?? null, body.nivel_novo_id ?? null, body.motivo ?? null, registradoPorId)
    .run()

  if ((body.tipo === 'promocao' || body.tipo === 'rebaixamento') && body.nivel_novo_id) {
    await c.env.DB.prepare(`UPDATE usuario_grupos SET nivel_id = ? WHERE grupo_id = ? AND usuario_id = ?`)
      .bind(body.nivel_novo_id, grupo.id, body.usuario_id).run()
  }
  if (body.tipo === 'saida') {
    await c.env.DB.prepare(`UPDATE usuario_grupos SET ativo = 0 WHERE grupo_id = ? AND usuario_id = ?`)
      .bind(grupo.id, body.usuario_id).run()
  }

  return c.json({ id: meta.last_row_id }, 201)
})

// --- Aulas ---

grupos.post('/:slug/aulas', async (c) => {
  const usuarioId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const body = await c.req.json<{ titulo: string; descricao?: string; conteudo: string; nivel_minimo_id?: number; ordem?: number }>()

  const grupo = await c.env.DB.prepare(`SELECT id, permite_aulas FROM grupos WHERE slug = ?`)
    .bind(slug).first<{ id: number; permite_aulas: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!grupo.permite_aulas) return c.json({ erro: 'este grupo não permite aulas' }, 400)

  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO grupo_aulas (grupo_id, titulo, descricao, conteudo, nivel_minimo_id, ordem, criado_por_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(grupo.id, body.titulo, body.descricao ?? null, body.conteudo, body.nivel_minimo_id ?? null, body.ordem ?? 0, usuarioId).run()

  return c.json({ id: meta.last_row_id }, 201)
})

grupos.get('/:slug/aulas', async (c) => {
  const usuarioId = c.get('usuarioId')
  const slug = c.req.param('slug')

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  const { results } = await c.env.DB.prepare(`SELECT * FROM grupo_aulas WHERE grupo_id = ? AND ativo = 1 ORDER BY ordem`)
    .bind(grupo.id).all<{ id: number; nivel_minimo_id: number | null }>()

  const membro = await c.env.DB.prepare(
    `SELECT gn.ordem FROM usuario_grupos ug JOIN grupo_niveis gn ON gn.id = ug.nivel_id
     WHERE ug.usuario_id = ? AND ug.grupo_id = ? AND ug.ativo = 1`
  ).bind(usuarioId, grupo.id).first<{ ordem: number }>()

  const visiveis = []
  for (const aula of results) {
    if (aula.nivel_minimo_id === null) { visiveis.push(aula); continue }
    if (!membro) continue
    const minimo = await c.env.DB.prepare(`SELECT ordem FROM grupo_niveis WHERE id = ?`).bind(aula.nivel_minimo_id).first<{ ordem: number }>()
    if (minimo && membro.ordem >= minimo.ordem) visiveis.push(aula)
  }

  return c.json(visiveis)
})

// --- Páginas do hub ---

grupos.post('/:slug/paginas', async (c) => {
  const usuarioId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const body = await c.req.json<{ titulo: string; caminho: string; conteudo_html: string; eh_pagina_inicial?: boolean; ordem?: number }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  try {
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO grupo_paginas (grupo_id, titulo, caminho, conteudo_html, eh_pagina_inicial, ordem, criado_por_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(grupo.id, body.titulo, body.caminho, body.conteudo_html, body.eh_pagina_inicial ? 1 : 0, body.ordem ?? 0, usuarioId).run()
    return c.json({ id: meta.last_row_id }, 201)
  } catch {
    return c.json({ erro: 'já existe uma página com esse caminho, ou já existe uma página inicial neste grupo' }, 409)
  }
})

grupos.get('/:slug/paginas/:caminho', async (c) => {
  const { slug, caminho } = c.req.param()
  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  const pagina = await c.env.DB.prepare(`SELECT * FROM grupo_paginas WHERE grupo_id = ? AND caminho = ? AND ativo = 1`)
    .bind(grupo.id, caminho).first()

  if (!pagina) return c.json({ erro: 'página não encontrada' }, 404)
  return c.json(pagina)
})

// --- Notícias de grupo ---

grupos.post('/:slug/noticias', async (c) => {
  const usuarioId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const { titulo, conteudo, postar_como_conta_id } = await c.req.json<{
    titulo: string; conteudo: string; postar_como_conta_id?: number
  }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  let autor
  try {
    autor = await resolverAutor(c.env.DB, usuarioId, postar_como_conta_id)
  } catch (err) {
    return c.json({ erro: err instanceof Error ? err.message : 'erro ao resolver autor' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO grupo_noticias (grupo_id, titulo, conteudo, autor_id, operado_por_id) VALUES (?, ?, ?, ?, ?)`
  ).bind(grupo.id, titulo, conteudo, autor.autorId, autor.operadoPorId).run()

  return c.json({ id: meta.last_row_id }, 201)
})

grupos.post('/:slug/noticias/:noticiaId/publicar', async (c) => {
  const usuarioId = c.get('usuarioId')
  const { slug, noticiaId } = c.req.param()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  await c.env.DB.prepare(
    `UPDATE grupo_noticias SET status = 'publicada', publicado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND grupo_id = ?`
  ).bind(noticiaId, grupo.id).run()

  return c.json({ ok: true })
})

grupos.get('/:slug/noticias', async (c) => {
  const slug = c.req.param('slug')
  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  const { results } = await c.env.DB.prepare(`SELECT * FROM grupo_noticias WHERE grupo_id = ? ORDER BY criado_em DESC`)
    .bind(grupo.id).all()
  return c.json(results)
})

// GET /grupos/usuario/:usuarioId — grupos que esse usuário integra
// (pra página de perfil).
grupos.get('/usuario/:usuarioId', async (c) => {
  const usuarioId = c.req.param('usuarioId')

  const { results } = await c.env.DB.prepare(
    `SELECT g.id, g.codigo, g.nome, g.slug, g.tipo, gn.nome AS nivel_nome
     FROM usuario_grupos ug
     JOIN grupos g ON g.id = ug.grupo_id
     JOIN grupo_niveis gn ON gn.id = ug.nivel_id
     WHERE ug.usuario_id = ? AND ug.ativo = 1
     ORDER BY g.nome`
  ).bind(usuarioId).all()

  return c.json(results)
})

export default grupos
