import { Hono } from 'hono'
import { podeVerProjetos } from '../services/projetos'
import { podeVerListagemIp } from './ip-listagem'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

// Checagens de visibilidade que não se encaixam em grupo_restrito_id
// nem patente_minima_id (ex: acesso individual concedido por flag,
// como a listagem de IPs) — cada chave aqui usa a MESMA regra de
// permissão da página de verdade, então o item some do menu sozinho
// pra quem não teria acesso ao clicar.
const CHECAGENS_PERMISSAO_MENU: Record<string, (db: D1Database, usuarioId: number) => Promise<boolean>> = {
  projetos: podeVerProjetos,
  ip_listagem: podeVerListagemIp,
}

const menu = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

menu.post('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  const body = await c.req.json<{
    titulo: string
    url?: string
    pagina_customizada_id?: number
    icone?: string
    item_pai_id?: number
    ordem?: number
    grupo_restrito_id?: number
    patente_minima_id?: number
  }>()

  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema gerenciam o menu' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO menu_itens
      (titulo, url, pagina_customizada_id, icone, item_pai_id, ordem, grupo_restrito_id, patente_minima_id, criado_por_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.titulo, body.url ?? null, body.pagina_customizada_id ?? null, body.icone ?? null,
      body.item_pai_id ?? null, body.ordem ?? 0, body.grupo_restrito_id ?? null, body.patente_minima_id ?? null, usuarioId
    )
    .run()

  return c.json({ id: meta.last_row_id }, 201)
})

// GET /menu — árvore de itens visíveis pro usuário autenticado (já
// filtrada por grupo/patente mínima).
menu.get('/', async (c) => {
  const usuarioId = c.get('usuarioId')

  const usuario = await c.env.DB.prepare(`SELECT patente_atual_id FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ patente_atual_id: number | null }>()

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM menu_itens WHERE ativo = 1 ORDER BY item_pai_id, ordem`
  ).all<{
    id: number; titulo: string; url: string | null; pagina_customizada_id: number | null
    icone: string | null; item_pai_id: number | null
    grupo_restrito_id: number | null; patente_minima_id: number | null
    chave_permissao: string | null
  }>()

  const visiveis = []
  for (const item of results) {
    let ok = true
    if (item.grupo_restrito_id !== null) {
      const membro = await c.env.DB.prepare(
        `SELECT 1 FROM usuario_grupos WHERE usuario_id = ? AND grupo_id = ? AND ativo = 1`
      ).bind(usuarioId, item.grupo_restrito_id).first()
      ok = ok && membro !== null
    }
    if (ok && item.patente_minima_id !== null) {
      if (!usuario?.patente_atual_id) {
        ok = false
      } else {
        const cmp = await c.env.DB.prepare(
          `SELECT (p_alvo.ordem >= p_min.ordem AND p_alvo.corpo = p_min.corpo) AS ok
           FROM patentes p_alvo, patentes p_min WHERE p_alvo.id = ? AND p_min.id = ?`
        ).bind(usuario.patente_atual_id, item.patente_minima_id).first<{ ok: number }>()
        ok = ok && Boolean(cmp?.ok)
      }
    }
    if (ok && item.chave_permissao) {
      const checagem = CHECAGENS_PERMISSAO_MENU[item.chave_permissao]
      ok = checagem ? await checagem(c.env.DB, usuarioId) : ok
    }
    if (ok) visiveis.push(item)
  }

  return c.json(visiveis)
})

// GET /menu/todos — lista TODOS os itens ativos, sem filtro de
// visibilidade (pro painel de admin gerenciar). Só admin.
menu.get('/todos', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema gerenciam o menu' }, 403)
  }
  const { results } = await c.env.DB.prepare(`SELECT * FROM menu_itens WHERE ativo = 1 ORDER BY item_pai_id, ordem`).all()
  return c.json(results)
})

// PATCH /menu/:id — edita um item existente, incluindo `chave_permissao`
// (antes só dava pra setar via seed/migração — sem essa rota, mudar a
// permissão de um item de menu exigia UPDATE manual no banco). Só admin.
menu.patch('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema gerenciam o menu' }, 403)
  }

  const id = c.req.param('id')
  const existente = await c.env.DB.prepare(`SELECT id FROM menu_itens WHERE id = ?`).bind(id).first()
  if (!existente) return c.json({ erro: 'item de menu não encontrado' }, 404)

  const body = await c.req.json<{
    titulo?: string
    url?: string | null
    pagina_customizada_id?: number | null
    icone?: string | null
    item_pai_id?: number | null
    ordem?: number
    grupo_restrito_id?: number | null
    patente_minima_id?: number | null
    chave_permissao?: string | null
  }>()

  const campos: string[] = []
  const valores: unknown[] = []
  const set = (coluna: string, valor: unknown) => { campos.push(`${coluna} = ?`); valores.push(valor) }

  if (body.titulo !== undefined) set('titulo', body.titulo)
  if (body.url !== undefined) set('url', body.url)
  if (body.pagina_customizada_id !== undefined) set('pagina_customizada_id', body.pagina_customizada_id)
  if (body.icone !== undefined) set('icone', body.icone)
  if (body.item_pai_id !== undefined) set('item_pai_id', body.item_pai_id)
  if (body.ordem !== undefined) set('ordem', body.ordem)
  if (body.grupo_restrito_id !== undefined) set('grupo_restrito_id', body.grupo_restrito_id)
  if (body.patente_minima_id !== undefined) set('patente_minima_id', body.patente_minima_id)
  if (body.chave_permissao !== undefined) set('chave_permissao', body.chave_permissao)

  if (!campos.length) return c.json({ ok: true })

  valores.push(id)
  await c.env.DB.prepare(`UPDATE menu_itens SET ${campos.join(', ')} WHERE id = ?`).bind(...valores).run()

  return c.json({ ok: true })
})

// DELETE /menu/:id — desativa um item do menu (soft delete). Só admin.
menu.delete('/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema gerenciam o menu' }, 403)
  }
  await c.env.DB.prepare(`UPDATE menu_itens SET ativo = 0 WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

export default menu
