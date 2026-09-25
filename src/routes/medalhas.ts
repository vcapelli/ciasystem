import { Hono } from 'hono'
import { buscarJogadorHabblet } from '../services/habblet'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const medalhas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// TODO: checar os limites do doc-mestre antes de conceder (medalha
// temporária: máx. 30/dia e 700/mês por policial) — não implementado.
medalhas.post('/', async (c) => {
  const concedidaPorId = c.get('usuarioId')
  const body = await c.req.json<{
    usuario_id: number
    tipo: 'temporaria' | 'efetiva' | 'honraria_particular' | 'honra'
    motivo: string
    quantidade?: number
    expira_em?: string
  }>()

  if (body.usuario_id === concedidaPorId && !(await ehAdmin(c.env.DB, concedidaPorId))) {
    return c.json({ erro: 'você não pode conceder medalha a si mesmo' }, 403)
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO medalhas (usuario_id, tipo, motivo, quantidade, concedida_por_id, expira_em)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(body.usuario_id, body.tipo, body.motivo, body.quantidade ?? 1, concedidaPorId, body.expira_em ?? null).run()

  return c.json({ id: meta.last_row_id }, 201)
})

medalhas.get('/usuario/:usuarioId', async (c) => {
  const usuarioId = c.req.param('usuarioId')
  const { results } = await c.env.DB.prepare(`SELECT * FROM medalhas WHERE usuario_id = ? ORDER BY data_concessao DESC`)
    .bind(usuarioId).all()
  return c.json(results)
})

// GET /medalhas — listagem geral de todas as medalhas concedidas
// (efetivas/honrarias/honra ficam "permanentes" pro frontend, temporária
// tem data de validade), usada pela página de Honrarias (/listagens/
// honrarias.html — fica em "MAIS" no menu, ver frontend/assets/honrarias.js).
// Busca a figure de cada nick distinto em paralelo (mesma ideia de
// buscarRequerimentosComFigure em routes/requerimentos.ts) — conta
// institucional/externa não tem personagem de verdade no Habblet, então
// figure_fixa (quando tiver) sempre tem prioridade.
medalhas.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.usuario_id, m.tipo, m.motivo, m.quantidade, m.concedida_por_id, m.data_concessao, m.expira_em,
            u.nick, u.tag, u.figure_fixa,
            cp.nick AS concedida_por_nick
     FROM medalhas m
     JOIN usuarios u ON u.id = m.usuario_id
     LEFT JOIN usuarios cp ON cp.id = m.concedida_por_id
     ORDER BY m.data_concessao DESC`
  ).all<{ nick: string; figure_fixa: string | null }>()

  const nicksParaBuscar = [...new Set(
    results.filter((m) => m.nick && !m.figure_fixa).map((m) => m.nick)
  )]
  const figurasPorNick: Record<string, string | null> = {}
  await Promise.all(
    nicksParaBuscar.map(async (nick) => {
      figurasPorNick[nick] = await buscarJogadorHabblet(nick).then((j) => j?.figure ?? null).catch(() => null)
    })
  )

  const comFigure = results.map((m) => ({
    ...m,
    figure: m.figure_fixa || figurasPorNick[m.nick] || null,
  }))

  return c.json(comFigure)
})

export default medalhas
