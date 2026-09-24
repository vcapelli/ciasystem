import { Hono } from 'hono'
import { ehAdminDoGrupo } from '../services/grupos'
import { resolverAutor } from '../services/autor'
import { buscarJogadorHabblet } from '../services/habblet'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const grupos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

async function pertenceAoGrupo(db: D1Database, usuarioId: number, grupoId: number): Promise<boolean> {
  if (await ehAdminDoGrupo(db, usuarioId, grupoId)) return true
  const membro = await db.prepare(`SELECT 1 FROM usuario_grupos WHERE usuario_id = ? AND grupo_id = ? AND ativo = 1`)
    .bind(usuarioId, grupoId).first()
  return membro !== null
}

// --- Leitura do hub ---

// GET /grupos — lista os grupos ativos, com contagem de membros (pra
// tela de listagem geral). Grupos ocultos só entram na lista pra quem
// é admin do sistema ou já é membro deles.
grupos.get('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  const admin = await ehAdmin(c.env.DB, usuarioId)

  const { results } = await c.env.DB.prepare(
    `SELECT g.*,
       (SELECT COUNT(*) FROM usuario_grupos ug WHERE ug.grupo_id = g.id AND ug.ativo = 1) AS total_membros,
       (SELECT 1 FROM usuario_grupos ug WHERE ug.grupo_id = g.id AND ug.usuario_id = ? AND ug.ativo = 1) AS sou_membro
     FROM grupos g WHERE g.ativo = 1 ORDER BY g.tipo, g.nome`
  ).bind(usuarioId).all<{ oculto: number; sou_membro: number | null }>()

  const visiveis = admin ? results : results.filter((g) => !g.oculto || g.sou_membro)
  return c.json(visiveis)
})

// GET /grupos/todos-cursos — todas as aulas/cursos de todos os
// grupos, pra alimentar o requisito "Curso Concluído" no admin.
// Precisa ficar declarado antes de GET /:slug pra não ser confundido
// com um slug de grupo.
// GET /grupos/onde-sou-admin — grupos onde o usuário autenticado é
// admin (do grupo ou do sistema) — usado pra escolher em nome de qual
// grupo publicar algo (ex: um decreto no Diário Oficial).
grupos.get('/onde-sou-admin', async (c) => {
  const usuarioId = c.get('usuarioId')
  const admin = await ehAdmin(c.env.DB, usuarioId)

  const { results } = await c.env.DB.prepare(
    admin
      ? `SELECT id, codigo, nome, slug, imagem_url FROM grupos WHERE ativo = 1 ORDER BY nome`
      : `SELECT DISTINCT g.id, g.codigo, g.nome, g.slug, g.imagem_url
         FROM usuario_grupos ug JOIN grupos g ON g.id = ug.grupo_id
         WHERE ug.usuario_id = ? AND ug.ativo = 1 AND ug.administrador_grupo = 1 AND g.ativo = 1
         ORDER BY g.nome`
  ).bind(...(admin ? [] : [usuarioId])).all()

  return c.json(results)
})

grupos.get('/todos-cursos', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ga.id, ga.titulo, ga.abreviacao, g.nome AS grupo_nome
     FROM grupo_aulas ga JOIN grupos g ON g.id = ga.grupo_id
     WHERE ga.ativo = 1 ORDER BY g.nome, ga.titulo`
  ).all()
  return c.json(results)
})

// GET /grupos/cursos-concluidos/:usuarioId — cursos aprovados desse
// usuário, de qualquer grupo (pra aba "Cursos" do perfil).
grupos.get('/cursos-concluidos/:usuarioId', async (c) => {
  const { usuarioId } = c.req.param()
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.data_efetiva, r.comentario, ga.titulo AS curso_titulo, ga.abreviacao AS curso_abreviacao,
            g.nome AS grupo_nome, g.slug AS grupo_slug, g.imagem_url AS grupo_imagem_url, ins.nick AS instrutor_nick
     FROM grupo_aula_relatorio_alunos ra
     JOIN grupo_aula_relatorios r ON r.id = ra.relatorio_id
     JOIN grupo_aulas ga ON ga.id = r.aula_id
     JOIN grupos g ON g.id = r.grupo_id
     JOIN usuarios ins ON ins.id = r.instrutor_id
     WHERE ra.usuario_id = ? AND r.aprovado = 1
     ORDER BY r.data_efetiva DESC`
  ).bind(usuarioId).all()
  return c.json(results)
})

grupos.get('/:slug', async (c) => {
  const usuarioId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const grupo = await c.env.DB.prepare(`SELECT * FROM grupos WHERE slug = ? AND ativo = 1`).bind(slug).first<{ id: number; oculto: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (grupo.oculto && !(await pertenceAoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'grupo não encontrado' }, 404)
  }
  return c.json(grupo)
})

grupos.get('/:slug/membros', async (c) => {
  const usuarioId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const grupo = await c.env.DB.prepare(`SELECT id, oculto FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number; oculto: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (grupo.oculto && !(await pertenceAoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'grupo não encontrado' }, 404)
  }

  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.nick, u.tag, ug.nivel_id, gn.nome AS nivel, gn.abreviacao AS nivel_abreviacao, ug.administrador_grupo, ug.data_ingresso
     FROM usuario_grupos ug
     JOIN usuarios u ON u.id = ug.usuario_id
     JOIN grupo_niveis gn ON gn.id = ug.nivel_id
     WHERE ug.grupo_id = ? AND ug.ativo = 1
     ORDER BY gn.ordem DESC`
  ).bind(grupo.id).all<{ id: number; nick: string }>()

  // Grupo tende a ser pequeno (dezenas, não centenas) — busca a figure
  // de cada um em paralelo, sem travar a resposta se algum falhar.
  const comFigure = await Promise.all(
    results.map(async (membro) => {
      const figure = await buscarJogadorHabblet(membro.nick).then((j) => j?.figure ?? null).catch(() => null)
      return { ...membro, figure }
    })
  )

  return c.json(comFigure)
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
    imagem_url?: string
    cor?: string
    oculto?: boolean
  }>()

  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema criam grupos' }, 403)
  }

  try {
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO grupos (codigo, nome, slug, tipo, permite_aulas, imagem_url, cor, oculto) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(body.codigo, body.nome, body.slug, body.tipo, body.permite_aulas ? 1 : 0, body.imagem_url ?? null, body.cor ?? null, body.oculto ? 1 : 0).run()
    return c.json({ id: meta.last_row_id }, 201)
  } catch {
    return c.json({ erro: 'já existe um grupo com esse código ou slug' }, 409)
  }
})

grupos.patch('/:slug', async (c) => {
  const usuarioId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const body = await c.req.json<{
    nome?: string; tipo?: string; permite_aulas?: boolean; ativo?: boolean
    imagem_url?: string; banner_url?: string; cor?: string; slug?: string; oculto?: boolean
  }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  // Trocar de tipo, ocultar/desocultar ou desativar o grupo continua
  // exclusivo do admin do sistema — o resto (nome, banner, logo, cor,
  // aulas, slug) um admin do grupo já pode mexer.
  const admin = await ehAdmin(c.env.DB, usuarioId)
  if ((body.tipo !== undefined || body.ativo !== undefined || body.oculto !== undefined) && !admin) {
    return c.json({ erro: 'só administradores do sistema mudam o tipo, ocultam ou desativam o grupo' }, 403)
  }
  if (!admin && !(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }
  if (body.slug !== undefined && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.slug)) {
    return c.json({ erro: 'slug precisa ser minúsculo, só letras/números/hífen' }, 400)
  }

  try {
    await c.env.DB.prepare(
      `UPDATE grupos SET
        nome = COALESCE(?, nome), tipo = COALESCE(?, tipo),
        permite_aulas = COALESCE(?, permite_aulas), ativo = COALESCE(?, ativo),
        imagem_url = COALESCE(?, imagem_url), banner_url = COALESCE(?, banner_url), cor = COALESCE(?, cor),
        slug = COALESCE(?, slug), oculto = COALESCE(?, oculto)
       WHERE id = ?`
    )
      .bind(
        body.nome ?? null, body.tipo ?? null,
        body.permite_aulas === undefined ? null : (body.permite_aulas ? 1 : 0),
        body.ativo === undefined ? null : (body.ativo ? 1 : 0),
        body.imagem_url ?? null, body.banner_url ?? null, body.cor ?? null,
        body.slug ?? null,
        body.oculto === undefined ? null : (body.oculto ? 1 : 0),
        grupo.id
      )
      .run()

    return c.json({ ok: true })
  } catch {
    return c.json({ erro: 'já existe um grupo com esse slug' }, 409)
  }
})

// --- Cargos internos (grupo_niveis) ---

grupos.post('/:slug/niveis', async (c) => {
  const usuarioId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const body = await c.req.json<{ nome: string; ordem: number; abreviacao?: string }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO grupo_niveis (grupo_id, nome, ordem, abreviacao, criado_por_id) VALUES (?, ?, ?, ?, ?)`
  ).bind(grupo.id, body.nome, body.ordem, body.abreviacao ?? null, usuarioId).run()

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
  const body = await c.req.json<{ nome?: string; ordem?: number; abreviacao?: string }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  await c.env.DB.prepare(
    `UPDATE grupo_niveis SET nome = COALESCE(?, nome), ordem = COALESCE(?, ordem), abreviacao = COALESCE(?, abreviacao), atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ? AND grupo_id = ?`
  ).bind(body.nome ?? null, body.ordem ?? null, body.abreviacao ?? null, nivelId, grupo.id).run()

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
  const usuarioId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!(await pertenceAoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'só membros deste grupo (ou administradores) podem ver isso' }, 403)
  }

  const { results } = await c.env.DB.prepare(
    `SELECT gr.id, gr.tipo, gr.motivo, gr.data_efetiva, gr.permissao, gr.criado_em,
            u.nick AS usuario_nick,
            ugAlvo_n.nome AS usuario_cargo_atual,
            reg.nick AS registrado_por_nick,
            ugReg_n.nome AS registrado_por_cargo,
            na.nome AS nivel_anterior_nome, nn.nome AS nivel_novo_nome
     FROM grupo_registros gr
     JOIN usuarios u ON u.id = gr.usuario_id
     LEFT JOIN usuario_grupos ugAlvo ON ugAlvo.usuario_id = gr.usuario_id AND ugAlvo.grupo_id = gr.grupo_id AND ugAlvo.ativo = 1
     LEFT JOIN grupo_niveis ugAlvo_n ON ugAlvo_n.id = ugAlvo.nivel_id
     LEFT JOIN usuarios reg ON reg.id = gr.registrado_por_id
     LEFT JOIN usuario_grupos ugReg ON ugReg.usuario_id = gr.registrado_por_id AND ugReg.grupo_id = gr.grupo_id AND ugReg.ativo = 1
     LEFT JOIN grupo_niveis ugReg_n ON ugReg_n.id = ugReg.nivel_id
     LEFT JOIN grupo_niveis na ON na.id = gr.nivel_anterior_id
     LEFT JOIN grupo_niveis nn ON nn.id = gr.nivel_novo_id
     WHERE gr.grupo_id = ? ORDER BY gr.criado_em DESC`
  ).bind(grupo.id).all()
  return c.json(results)
})

grupos.delete('/:slug/registros/:registroId', async (c) => {
  const usuarioId = c.get('usuarioId')
  const { slug, registroId } = c.req.param()
  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }
  // Só apaga o registro/log — não desfaz o efeito (promoção, admissão
  // etc.) que já foi aplicado. Pra reverter, use outro requerimento.
  await c.env.DB.prepare(`DELETE FROM grupo_registros WHERE id = ? AND grupo_id = ?`).bind(registroId, grupo.id).run()
  return c.json({ ok: true })
})

grupos.post('/:slug/registros', async (c) => {
  const registradoPorId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const body = await c.req.json<{
    usuario_id: number; tipo: string; nivel_anterior_id?: number; nivel_novo_id?: number
    motivo?: string; data_efetiva?: string; permissao?: string
  }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  if (!(await ehAdminDoGrupo(c.env.DB, registradoPorId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO grupo_registros (grupo_id, usuario_id, tipo, nivel_anterior_id, nivel_novo_id, motivo, data_efetiva, permissao, registrado_por_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      grupo.id, body.usuario_id, body.tipo, body.nivel_anterior_id ?? null, body.nivel_novo_id ?? null,
      body.motivo ?? null, body.data_efetiva ?? null, body.permissao ?? null, registradoPorId
    )
    .run()

  if (body.tipo === 'admissao' && body.nivel_novo_id) {
    const jaMembro = await c.env.DB.prepare(`SELECT id FROM usuario_grupos WHERE usuario_id = ? AND grupo_id = ?`)
      .bind(body.usuario_id, grupo.id).first<{ id: number }>()
    if (jaMembro) {
      await c.env.DB.prepare(`UPDATE usuario_grupos SET ativo = 1, nivel_id = ? WHERE id = ?`)
        .bind(body.nivel_novo_id, jaMembro.id).run()
    } else {
      await c.env.DB.prepare(`INSERT INTO usuario_grupos (usuario_id, grupo_id, nivel_id) VALUES (?, ?, ?)`)
        .bind(body.usuario_id, grupo.id, body.nivel_novo_id).run()
    }
  }
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
  const body = await c.req.json<{
    titulo: string; descricao?: string; conteudo: string; abreviacao?: string; slug: string
    categoria_id?: number; nivel_minimo_id?: number; ordem?: number
  }>()

  const grupo = await c.env.DB.prepare(`SELECT id, permite_aulas FROM grupos WHERE slug = ?`)
    .bind(slug).first<{ id: number; permite_aulas: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!grupo.permite_aulas) return c.json({ erro: 'este grupo não permite aulas' }, 400)

  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }
  if (!body.slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.slug)) {
    return c.json({ erro: 'slug precisa ser minúsculo, só letras/números/hífen' }, 400)
  }

  try {
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO grupo_aulas (grupo_id, titulo, descricao, conteudo, abreviacao, slug, categoria_id, nivel_minimo_id, ordem, criado_por_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      grupo.id, body.titulo, body.descricao ?? null, body.conteudo, body.abreviacao ?? null, body.slug,
      body.categoria_id ?? null, body.nivel_minimo_id ?? null, body.ordem ?? 0, usuarioId
    ).run()
    return c.json({ id: meta.last_row_id }, 201)
  } catch {
    return c.json({ erro: 'já existe uma aula com esse slug neste grupo' }, 409)
  }
})

grupos.patch('/:slug/aulas/:aulaId', async (c) => {
  const usuarioId = c.get('usuarioId')
  const { slug, aulaId } = c.req.param()
  const body = await c.req.json<{
    titulo?: string; descricao?: string; conteudo?: string; abreviacao?: string; slug?: string
    categoria_id?: number | null; nivel_minimo_id?: number | null; ordem?: number
  }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  const campos: string[] = []
  const valores: unknown[] = []
  if (body.titulo !== undefined) { campos.push('titulo = ?'); valores.push(body.titulo) }
  if (body.descricao !== undefined) { campos.push('descricao = ?'); valores.push(body.descricao) }
  if (body.conteudo !== undefined) { campos.push('conteudo = ?'); valores.push(body.conteudo) }
  if (body.abreviacao !== undefined) { campos.push('abreviacao = ?'); valores.push(body.abreviacao) }
  if (body.slug !== undefined) { campos.push('slug = ?'); valores.push(body.slug) }
  if (body.categoria_id !== undefined) { campos.push('categoria_id = ?'); valores.push(body.categoria_id) }
  if (body.nivel_minimo_id !== undefined) { campos.push('nivel_minimo_id = ?'); valores.push(body.nivel_minimo_id) }
  if (body.ordem !== undefined) { campos.push('ordem = ?'); valores.push(body.ordem) }
  if (!campos.length) return c.json({ ok: true })

  try {
    await c.env.DB.prepare(
      `UPDATE grupo_aulas SET ${campos.join(', ')}, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND grupo_id = ?`
    ).bind(...valores, aulaId, grupo.id).run()
    return c.json({ ok: true })
  } catch {
    return c.json({ erro: 'já existe uma aula com esse slug neste grupo' }, 409)
  }
})

grupos.delete('/:slug/aulas/:aulaId', async (c) => {
  const usuarioId = c.get('usuarioId')
  const { slug, aulaId } = c.req.param()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  await c.env.DB.prepare(`UPDATE grupo_aulas SET ativo = 0 WHERE id = ? AND grupo_id = ?`).bind(aulaId, grupo.id).run()
  return c.json({ ok: true })
})

// --- Categorias de aula ---

grupos.get('/:slug/aulas-categorias', async (c) => {
  const slug = c.req.param('slug')
  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)

  const { results } = await c.env.DB.prepare(`SELECT * FROM grupo_aulas_categorias WHERE grupo_id = ? ORDER BY ordem, nome`)
    .bind(grupo.id).all()
  return c.json(results)
})

grupos.post('/:slug/aulas-categorias', async (c) => {
  const usuarioId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const body = await c.req.json<{ nome: string; ordem?: number }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  const { meta } = await c.env.DB.prepare(`INSERT INTO grupo_aulas_categorias (grupo_id, nome, ordem) VALUES (?, ?, ?)`)
    .bind(grupo.id, body.nome, body.ordem ?? 0).run()
  return c.json({ id: meta.last_row_id }, 201)
})

grupos.patch('/:slug/aulas-categorias/:catId', async (c) => {
  const usuarioId = c.get('usuarioId')
  const { slug, catId } = c.req.param()
  const body = await c.req.json<{ nome?: string; ordem?: number }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  await c.env.DB.prepare(`UPDATE grupo_aulas_categorias SET nome = COALESCE(?, nome), ordem = COALESCE(?, ordem) WHERE id = ? AND grupo_id = ?`)
    .bind(body.nome ?? null, body.ordem ?? null, catId, grupo.id).run()
  return c.json({ ok: true })
})

grupos.delete('/:slug/aulas-categorias/:catId', async (c) => {
  const usuarioId = c.get('usuarioId')
  const { slug, catId } = c.req.param()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  await c.env.DB.prepare(`UPDATE grupo_aulas SET categoria_id = NULL WHERE categoria_id = ?`).bind(catId).run()
  await c.env.DB.prepare(`DELETE FROM grupo_aulas_categorias WHERE id = ? AND grupo_id = ?`).bind(catId, grupo.id).run()
  return c.json({ ok: true })
})

grupos.get('/:slug/aulas', async (c) => {
  const usuarioId = c.get('usuarioId')
  const slug = c.req.param('slug')

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!(await pertenceAoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'só membros deste grupo (ou administradores) podem ver isso' }, 403)
  }

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
    if (minimo && membro.ordem <= minimo.ordem) visiveis.push(aula)
  }

  return c.json(visiveis)
})

// GET /:slug/aulas/:aulaSlug — uma aula específica (mesma checagem de
// nível mínimo da listagem), pra página individual.
grupos.get('/:slug/aulas/:aulaSlug', async (c) => {
  const usuarioId = c.get('usuarioId')
  const { slug, aulaSlug } = c.req.param()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!(await pertenceAoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'só membros deste grupo (ou administradores) podem ver isso' }, 403)
  }

  const aula = await c.env.DB.prepare(`SELECT * FROM grupo_aulas WHERE grupo_id = ? AND slug = ? AND ativo = 1`)
    .bind(grupo.id, aulaSlug).first<{ nivel_minimo_id: number | null }>()
  if (!aula) return c.json({ erro: 'aula não encontrada' }, 404)

  if (aula.nivel_minimo_id !== null) {
    const membro = await c.env.DB.prepare(
      `SELECT gn.ordem FROM usuario_grupos ug JOIN grupo_niveis gn ON gn.id = ug.nivel_id
       WHERE ug.usuario_id = ? AND ug.grupo_id = ? AND ug.ativo = 1`
    ).bind(usuarioId, grupo.id).first<{ ordem: number }>()
    const minimo = await c.env.DB.prepare(`SELECT ordem FROM grupo_niveis WHERE id = ?`).bind(aula.nivel_minimo_id).first<{ ordem: number }>()
    if (!membro || !minimo || membro.ordem > minimo.ordem) {
      return c.json({ erro: 'você não tem acesso a esta aula' }, 403)
    }
  }

  return c.json(aula)
})

// --- Relatórios de aula ---

grupos.post('/:slug/aulas-relatorios', async (c) => {
  const criadoPorId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const body = await c.req.json<{
    aula_id: number; instrutor_id: number; data_efetiva: string
    aprovado: boolean; comentario?: string; alunos_ids: number[]
  }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!(await ehAdminDoGrupo(c.env.DB, criadoPorId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }
  if (!body.alunos_ids?.length) return c.json({ erro: 'escolha ao menos um aluno' }, 400)

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO grupo_aula_relatorios (grupo_id, aula_id, instrutor_id, data_efetiva, aprovado, comentario, criado_por_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(grupo.id, body.aula_id, body.instrutor_id, body.data_efetiva, body.aprovado ? 1 : 0, body.comentario ?? null, criadoPorId).run()

  for (const alunoId of body.alunos_ids) {
    await c.env.DB.prepare(`INSERT INTO grupo_aula_relatorio_alunos (relatorio_id, usuario_id) VALUES (?, ?)`)
      .bind(meta.last_row_id, alunoId).run()
  }

  return c.json({ id: meta.last_row_id }, 201)
})

grupos.delete('/:slug/aulas-relatorios/:relatorioId', async (c) => {
  const usuarioId = c.get('usuarioId')
  const { slug, relatorioId } = c.req.param()
  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }
  await c.env.DB.prepare(`DELETE FROM grupo_aula_relatorios WHERE id = ? AND grupo_id = ?`).bind(relatorioId, grupo.id).run()
  return c.json({ ok: true })
})

grupos.get('/:slug/aulas-relatorios', async (c) => {
  const usuarioId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const pagina = Math.max(1, Number(c.req.query('pagina')) || 1)
  const porPagina = 10
  const offset = (pagina - 1) * porPagina

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!(await pertenceAoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'só membros deste grupo (ou administradores) podem ver isso' }, 403)
  }

  const { results: relatorios } = await c.env.DB.prepare(
    `SELECT r.*, ga.titulo AS curso_titulo, ins.nick AS instrutor_nick
     FROM grupo_aula_relatorios r
     JOIN grupo_aulas ga ON ga.id = r.aula_id
     JOIN usuarios ins ON ins.id = r.instrutor_id
     WHERE r.grupo_id = ? ORDER BY r.criado_em DESC LIMIT ? OFFSET ?`
  ).bind(grupo.id, porPagina, offset).all<{ id: number }>()

  for (const rel of relatorios as unknown as Record<string, unknown>[]) {
    const { results: alunos } = await c.env.DB.prepare(
      `SELECT u.id, u.nick FROM grupo_aula_relatorio_alunos ra JOIN usuarios u ON u.id = ra.usuario_id WHERE ra.relatorio_id = ?`
    ).bind(rel.id).all()
    rel.alunos = alunos
  }

  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM grupo_aula_relatorios WHERE grupo_id = ?`)
    .bind(grupo.id).first<{ n: number }>()

  return c.json({ relatorios, total: totalRow?.n ?? 0, pagina, por_pagina: porPagina })
})

// --- Meta semanal (só relevante em grupos com permite_aulas = 1) ---

// Segunda a domingo da semana que contém `dataRef` (ou hoje, se omitida).
// Sempre em UTC — o mesmo padrão usado nas datas ISO gravadas no banco.
function limitesSemana(dataRef?: string): { inicio: string; fim: string } {
  const base = dataRef ? new Date(`${dataRef}T00:00:00Z`) : new Date()
  const diaSemana = base.getUTCDay() // 0 = domingo, 1 = segunda, ...
  const deslocamento = diaSemana === 0 ? 6 : diaSemana - 1 // dias desde a última segunda
  const inicio = new Date(base)
  inicio.setUTCDate(base.getUTCDate() - deslocamento)
  const fim = new Date(inicio)
  fim.setUTCDate(inicio.getUTCDate() + 6)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { inicio: fmt(inicio), fim: fmt(fim) }
}

// GET /grupos/:slug/meta — configuração atual (qualquer membro pode
// ver, pro dashboard saber se a meta está ativa e quanto vale).
grupos.get('/:slug/meta', async (c) => {
  const usuarioId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const grupo = await c.env.DB.prepare(
    `SELECT id, meta_semanal_ativa, meta_semanal_quantidade FROM grupos WHERE slug = ?`
  ).bind(slug).first<{ id: number; meta_semanal_ativa: number; meta_semanal_quantidade: number | null }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!(await pertenceAoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'só membros deste grupo (ou administradores) podem ver isso' }, 403)
  }

  const { results: niveis } = await c.env.DB.prepare(`SELECT nivel_id FROM grupo_meta_niveis WHERE grupo_id = ?`)
    .bind(grupo.id).all<{ nivel_id: number }>()

  return c.json({
    ativa: Boolean(grupo.meta_semanal_ativa),
    quantidade: grupo.meta_semanal_quantidade,
    niveis_ids: niveis.map((n) => n.nivel_id),
  })
})

// PATCH /grupos/:slug/meta — só admin do grupo (mesma permissão de
// mexer na hierarquia interna).
grupos.patch('/:slug/meta', async (c) => {
  const usuarioId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  const body = await c.req.json<{ ativa?: boolean; quantidade?: number | null; niveis_ids?: number[] }>()

  if (body.ativa && (!body.quantidade || body.quantidade < 1)) {
    return c.json({ erro: 'defina uma quantidade de aulas por semana maior que zero pra ativar a meta' }, 400)
  }

  await c.env.DB.prepare(`UPDATE grupos SET meta_semanal_ativa = ?, meta_semanal_quantidade = ? WHERE id = ?`)
    .bind(body.ativa ? 1 : 0, body.quantidade ?? null, grupo.id).run()

  if (body.niveis_ids) {
    await c.env.DB.prepare(`DELETE FROM grupo_meta_niveis WHERE grupo_id = ?`).bind(grupo.id).run()
    for (const nivelId of body.niveis_ids) {
      await c.env.DB.prepare(`INSERT INTO grupo_meta_niveis (grupo_id, nivel_id) VALUES (?, ?)`)
        .bind(grupo.id, nivelId).run()
    }
  }

  return c.json({ ok: true })
})

// GET /grupos/:slug/meta/dashboard?semana=YYYY-MM-DD — qualquer membro
// pode ver (é o painel de acompanhamento, não a configuração). `semana`
// é qualquer data dentro da semana desejada; sem isso, usa a atual.
// Conta "aulas dadas" via `criado_em` (ver comentário na migração
// 0043) e isenta quem ingressou no grupo dentro da própria semana
// mostrada — de propósito só nessa semana: quem entrou numa semana
// passada já foi cobrado normalmente desde então.
grupos.get('/:slug/meta/dashboard', async (c) => {
  const usuarioId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const grupo = await c.env.DB.prepare(
    `SELECT id, meta_semanal_ativa, meta_semanal_quantidade FROM grupos WHERE slug = ?`
  ).bind(slug).first<{ id: number; meta_semanal_ativa: number; meta_semanal_quantidade: number | null }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!(await pertenceAoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'só membros deste grupo (ou administradores) podem ver isso' }, 403)
  }

  const { inicio, fim } = limitesSemana(c.req.query('semana'))
  const semanaAtual = limitesSemana()

  const { results: niveisAplicaveis } = await c.env.DB.prepare(`SELECT nivel_id FROM grupo_meta_niveis WHERE grupo_id = ?`)
    .bind(grupo.id).all<{ nivel_id: number }>()
  const idsNiveis = niveisAplicaveis.map((n) => n.nivel_id)

  let membros: Record<string, unknown>[] = []
  if (idsNiveis.length) {
    const placeholders = idsNiveis.map(() => '?').join(',')
    const inicioIso = `${inicio}T00:00:00Z`
    const fimIso = `${fim}T23:59:59Z`
    const { results } = await c.env.DB.prepare(
      `SELECT u.id, u.nick, u.tag, ug.nivel_id, gn.nome AS nivel_nome, gn.abreviacao AS nivel_abreviacao, ug.data_ingresso,
        (SELECT COUNT(*) FROM grupo_aula_relatorios r WHERE r.grupo_id = ? AND r.instrutor_id = u.id AND r.criado_em BETWEEN ? AND ?) AS aulas_dadas
       FROM usuario_grupos ug
       JOIN usuarios u ON u.id = ug.usuario_id
       JOIN grupo_niveis gn ON gn.id = ug.nivel_id
       WHERE ug.grupo_id = ? AND ug.ativo = 1 AND ug.nivel_id IN (${placeholders})
       ORDER BY gn.ordem, u.nick`
    ).bind(grupo.id, inicioIso, fimIso, grupo.id, ...idsNiveis)
      .all<{ id: number; nick: string; tag: string | null; nivel_id: number; nivel_nome: string; nivel_abreviacao: string | null; data_ingresso: string; aulas_dadas: number }>()

    membros = results.map((m) => ({
      ...m,
      isento: m.data_ingresso >= inicioIso && m.data_ingresso <= fimIso,
      cumpriu: grupo.meta_semanal_quantidade ? m.aulas_dadas >= grupo.meta_semanal_quantidade : true,
    }))
  }

  return c.json({
    ativa: Boolean(grupo.meta_semanal_ativa),
    quantidade: grupo.meta_semanal_quantidade,
    semana_inicio: inicio,
    semana_fim: fim,
    semana_atual: inicio === semanaAtual.inicio,
    tem_niveis_configurados: idsNiveis.length > 0,
    membros,
  })
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
  const usuarioId = c.get('usuarioId')
  const { slug, caminho } = c.req.param()
  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!(await pertenceAoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'só membros deste grupo (ou administradores) podem ver isso' }, 403)
  }

  const pagina = await c.env.DB.prepare(`SELECT * FROM grupo_paginas WHERE grupo_id = ? AND caminho = ? AND ativo = 1`)
    .bind(grupo.id, caminho).first()

  if (!pagina) return c.json({ erro: 'página não encontrada' }, 404)
  return c.json(pagina)
})

// PATCH /:slug/paginas/:caminho — edita o conteúdo; cria a página na
// hora se ainda não existir (usado pelo Regimento Interno, que toda
// grupo tem por padrão mas começa vazio).
grupos.patch('/:slug/paginas/:caminho', async (c) => {
  const usuarioId = c.get('usuarioId')
  const { slug, caminho } = c.req.param()
  const body = await c.req.json<{ titulo?: string; conteudo_html: string }>()

  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }

  const existente = await c.env.DB.prepare(`SELECT id FROM grupo_paginas WHERE grupo_id = ? AND caminho = ?`)
    .bind(grupo.id, caminho).first<{ id: number }>()

  if (existente) {
    await c.env.DB.prepare(
      `UPDATE grupo_paginas SET conteudo_html = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'), atualizado_por_id = ?, ativo = 1 WHERE id = ?`
    ).bind(body.conteudo_html, usuarioId, existente.id).run()
  } else {
    await c.env.DB.prepare(
      `INSERT INTO grupo_paginas (grupo_id, titulo, caminho, conteudo_html, criado_por_id) VALUES (?, ?, ?, ?, ?)`
    ).bind(grupo.id, body.titulo ?? caminho, caminho, body.conteudo_html, usuarioId).run()
  }

  return c.json({ ok: true })
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
  const usuarioId = c.get('usuarioId')
  const slug = c.req.param('slug')
  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!(await pertenceAoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'só membros deste grupo (ou administradores) podem ver isso' }, 403)
  }

  const { results } = await c.env.DB.prepare(
    `SELECT n.*, u.nick AS autor_nick, gn.nome AS autor_cargo
     FROM grupo_noticias n
     JOIN usuarios u ON u.id = n.autor_id
     LEFT JOIN usuario_grupos ug ON ug.usuario_id = n.autor_id AND ug.grupo_id = n.grupo_id AND ug.ativo = 1
     LEFT JOIN grupo_niveis gn ON gn.id = ug.nivel_id
     WHERE n.grupo_id = ? ORDER BY n.criado_em DESC`
  ).bind(grupo.id).all()
  return c.json(results)
})

grupos.delete('/:slug/noticias/:noticiaId', async (c) => {
  const usuarioId = c.get('usuarioId')
  const { slug, noticiaId } = c.req.param()
  const grupo = await c.env.DB.prepare(`SELECT id FROM grupos WHERE slug = ?`).bind(slug).first<{ id: number }>()
  if (!grupo) return c.json({ erro: 'grupo não encontrado' }, 404)
  if (!(await ehAdminDoGrupo(c.env.DB, usuarioId, grupo.id))) {
    return c.json({ erro: 'sem permissão de administrador neste grupo' }, 403)
  }
  await c.env.DB.prepare(`DELETE FROM grupo_noticias WHERE id = ? AND grupo_id = ?`).bind(noticiaId, grupo.id).run()
  return c.json({ ok: true })
})

// GET /grupos/usuario/:usuarioId — grupos que esse usuário integra
// (pra página de perfil).
grupos.get('/usuario/:usuarioId', async (c) => {
  const visitanteId = c.get('usuarioId')
  const usuarioId = c.req.param('usuarioId')
  const admin = await ehAdmin(c.env.DB, visitanteId)

  const { results } = await c.env.DB.prepare(
    `SELECT g.id, g.codigo, g.nome, g.slug, g.tipo, g.imagem_url, g.oculto, gn.nome AS nivel_nome, gn.abreviacao AS nivel_abreviacao
     FROM usuario_grupos ug
     JOIN grupos g ON g.id = ug.grupo_id
     JOIN grupo_niveis gn ON gn.id = ug.nivel_id
     WHERE ug.usuario_id = ? AND ug.ativo = 1
     ORDER BY g.nome`
  ).bind(usuarioId).all<{ id: number; oculto: number }>()

  // Grupo oculto não aparece no perfil de terceiros pra quem não é
  // admin do sistema nem membro dele — senão o perfil vaza que o
  // grupo existe pra qualquer visitante.
  const visiveis = admin
    ? results
    : (await Promise.all(results.map(async (g) => ((!g.oculto || await pertenceAoGrupo(c.env.DB, visitanteId, g.id)) ? g : null))))
        .filter((g): g is typeof results[number] => g !== null)

  return c.json(visiveis)
})

export default grupos
