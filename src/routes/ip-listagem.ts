import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const ipListagem = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

async function podeVerListagemIp(db: D1Database, usuarioId: number): Promise<boolean> {
  if (await ehAdmin(db, usuarioId)) return true
  const permitido = await db.prepare(`SELECT 1 FROM ip_listagem_permissoes WHERE usuario_id = ?`)
    .bind(usuarioId).first()
  return permitido !== null
}

// --- Permissões (quem pode ver a listagem) — só admin do sistema mexe ---

ipListagem.get('/permissoes', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam isso' }, 403)

  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.usuario_id, u.nick AS usuario_nick, d.nick AS definido_por_nick, p.criado_em
     FROM ip_listagem_permissoes p
     JOIN usuarios u ON u.id = p.usuario_id
     LEFT JOIN usuarios d ON d.id = p.definido_por_id
     ORDER BY p.criado_em DESC`
  ).all()
  return c.json(results)
})

ipListagem.post('/permissoes', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam isso' }, 403)

  const body = await c.req.json<{ usuario_id: number }>()
  if (!body.usuario_id) return c.json({ erro: 'usuario_id é obrigatório' }, 400)

  try {
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO ip_listagem_permissoes (usuario_id, definido_por_id) VALUES (?, ?)`
    ).bind(body.usuario_id, usuarioId).run()
    return c.json({ id: meta.last_row_id }, 201)
  } catch {
    return c.json({ erro: 'essa pessoa já tem permissão' }, 409)
  }
})

ipListagem.delete('/permissoes/:id', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) return c.json({ erro: 'só administradores do sistema gerenciam isso' }, 403)

  await c.env.DB.prepare(`DELETE FROM ip_listagem_permissoes WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

// --- Listagem em si ---

// GET /ip-listagem — todo usuário com o último IP visto (via
// logs_eventos), mais um bloco de alertas: qualquer IP usado por MAIS
// DE UMA conta diferente entra na lista de suspeitos.
ipListagem.get('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await podeVerListagemIp(c.env.DB, usuarioId))) {
    return c.json({ erro: 'sem permissão pra ver essa listagem' }, 403)
  }

  const { results: usuariosLista } = await c.env.DB.prepare(
    `SELECT u.id, u.nick, u.tag, u.tipo, u.status, p.nome AS patente_nome,
       (SELECT le.ip FROM logs_eventos le WHERE le.usuario_id = u.id AND le.ip IS NOT NULL ORDER BY le.criado_em DESC LIMIT 1) AS ultimo_ip,
       (SELECT le.criado_em FROM logs_eventos le WHERE le.usuario_id = u.id AND le.ip IS NOT NULL ORDER BY le.criado_em DESC LIMIT 1) AS ultimo_acesso_em,
       (SELECT COUNT(DISTINCT le.ip) FROM logs_eventos le WHERE le.usuario_id = u.id AND le.ip IS NOT NULL) AS total_ips_distintos
     FROM usuarios u
     LEFT JOIN patentes p ON p.id = u.patente_atual_id
     WHERE u.tipo = 'jogador'
     ORDER BY u.nick`
  ).all<{ id: number; nick: string; ultimo_ip: string | null }>()

  // Agrupa por IP pra achar quem compartilha o mesmo IP mais recente
  // com outra conta — indício de multi-conta, não prova definitiva
  // (pode ser rede/wifi compartilhada por coincidência).
  const porIp: Record<string, { id: number; nick: string }[]> = {}
  for (const u of usuariosLista) {
    if (!u.ultimo_ip) continue
    porIp[u.ultimo_ip] ??= []
    porIp[u.ultimo_ip].push({ id: u.id, nick: u.nick })
  }
  const alertas = Object.entries(porIp)
    .filter(([, contas]) => contas.length > 1)
    .map(([ip, contas]) => ({ ip, contas }))

  return c.json({ usuarios: usuariosLista, alertas })
})

export default ipListagem
