import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const ipListagem = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

export async function podeVerListagemIp(db: D1Database, usuarioId: number): Promise<boolean> {
  if (await ehAdmin(db, usuarioId)) return true
  const permitido = await db.prepare(`SELECT 1 FROM ip_listagem_permissoes WHERE usuario_id = ?`)
    .bind(usuarioId).first()
  return permitido !== null
}

// Alerta de possível fake: toda conta que já dividiu, em QUALQUER
// momento do histórico registrado em logs_eventos (não só o IP mais
// recente), um mesmo IP com outra conta. Antes o alerta olhava só
// `ultimo_ip` de cada conta, o que tinha o mesmo problema já corrigido
// na busca (GET /ip-listagem/busca-ip): só pegava a colisão se as duas
// contas estivessem com aquele IP como o ATUAL ao mesmo tempo — uma
// fake que hoje já está noutro IP, mas dividiu um IP com a conta
// principal em algum momento do passado, passava batido. Pedido do
// Vitor em 25/09/2026. Não é prova automática de multi-conta — pode ser
// rede/wifi compartilhada por coincidência (fica dito na UI).
async function buscarAlertasIpDuplicado(
  db: D1Database
): Promise<{ ip: string; contas: { id: number; nick: string }[] }[]> {
  const { results } = await db.prepare(
    `SELECT DISTINCT le.ip, u.id AS usuario_id, u.nick
     FROM logs_eventos le
     JOIN usuarios u ON u.id = le.usuario_id
     WHERE le.ip IS NOT NULL AND u.tipo = 'jogador'`
  ).all<{ ip: string; usuario_id: number; nick: string }>()

  const porIp: Record<string, { id: number; nick: string }[]> = {}
  for (const r of results) {
    porIp[r.ip] ??= []
    porIp[r.ip].push({ id: r.usuario_id, nick: r.nick })
  }

  return Object.entries(porIp)
    .filter(([, contas]) => contas.length > 1)
    .map(([ip, contas]) => ({ ip, contas }))
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

// --- Dashboard de segurança ---

// GET /ip-listagem/dashboard?dias=14 — visão agregada dos logs de
// eventos, com a mesma permissão da listagem de IP (admin do sistema
// ou quem estiver em ip_listagem_permissoes). Não substitui a
// listagem linha-a-linha nem a consulta em /logs — é o resumo pra
// decidir o que vale a pena abrir primeiro: volume de ação por dia,
// os tipos de ação mais comuns, quem mais agiu no período, erros
// (4xx/5xx) e quantos IPs colidem AGORA entre contas diferentes.
ipListagem.get('/dashboard', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await podeVerListagemIp(c.env.DB, usuarioId))) {
    return c.json({ erro: 'sem permissão pra ver essa listagem' }, 403)
  }

  // Clampado entre 1 e 90 dias — sem limite, uma janela absurda (ou
  // negativa) faria um full scan de logs_eventos sem necessidade.
  const dias = Math.min(Math.max(Number(c.req.query('dias')) || 14, 1), 90)
  const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 19) + 'Z'

  const [totais, porDia, porTipo, maisAtivos, porStatus, alertas] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total_eventos,
              COUNT(DISTINCT ip) AS total_ips_distintos,
              COUNT(DISTINCT usuario_id) AS total_usuarios_ativos
         FROM logs_eventos WHERE criado_em >= ?`
    ).bind(desde).first<{ total_eventos: number; total_ips_distintos: number; total_usuarios_ativos: number }>(),

    c.env.DB.prepare(
      `SELECT substr(criado_em, 1, 10) AS dia, COUNT(*) AS total
         FROM logs_eventos WHERE criado_em >= ?
         GROUP BY dia ORDER BY dia`
    ).bind(desde).all<{ dia: string; total: number }>(),

    c.env.DB.prepare(
      `SELECT tipo_evento, COUNT(*) AS total
         FROM logs_eventos WHERE criado_em >= ?
         GROUP BY tipo_evento ORDER BY total DESC LIMIT 10`
    ).bind(desde).all<{ tipo_evento: string; total: number }>(),

    c.env.DB.prepare(
      `SELECT le.usuario_id, u.nick, u.tag, COUNT(*) AS total
         FROM logs_eventos le JOIN usuarios u ON u.id = le.usuario_id
         WHERE le.criado_em >= ? AND le.usuario_id IS NOT NULL
         GROUP BY le.usuario_id ORDER BY total DESC LIMIT 10`
    ).bind(desde).all<{ usuario_id: number; nick: string; tag: string | null; total: number }>(),

    c.env.DB.prepare(
      `SELECT CAST(json_extract(detalhes, '$.status') AS INTEGER) AS status, COUNT(*) AS total
         FROM logs_eventos
         WHERE criado_em >= ? AND CAST(json_extract(detalhes, '$.status') AS INTEGER) >= 400
         GROUP BY status ORDER BY total DESC`
    ).bind(desde).all<{ status: number; total: number }>(),

    // Mesma detecção de colisão da listagem principal (agora pelo
    // HISTÓRICO COMPLETO de IPs, não só o mais recente — ver
    // buscarAlertasIpDuplicado) — aqui só o número entra no card de
    // totais, não a lista de contas.
    buscarAlertasIpDuplicado(c.env.DB),
  ])

  // Preenche os dias sem nenhum evento com 0 — sem isso o gráfico
  // "pula" dias silenciosamente em vez de mostrar o vazio de verdade,
  // e o eixo do gráfico fica com espaçamento irregular.
  const porDiaMapa = new Map((porDia.results ?? []).map((r) => [r.dia, r.total]))
  const eventosPorDia: { dia: string; total: number }[] = []
  for (let i = dias - 1; i >= 0; i--) {
    const dia = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
    eventosPorDia.push({ dia, total: porDiaMapa.get(dia) ?? 0 })
  }

  return c.json({
    janela_dias: dias,
    totais: {
      eventos: totais?.total_eventos ?? 0,
      ips_distintos: totais?.total_ips_distintos ?? 0,
      usuarios_ativos: totais?.total_usuarios_ativos ?? 0,
      alertas_ip_ativos: alertas.length,
    },
    eventos_por_dia: eventosPorDia,
    eventos_por_tipo: porTipo.results ?? [],
    usuarios_mais_ativos: maisAtivos.results ?? [],
    erros_por_status: porStatus.results ?? [],
  })
})

// --- Listagem em si ---

// GET /ip-listagem — todo usuário com o último IP visto (via
// logs_eventos), mais um bloco de alertas: qualquer IP já usado, em
// qualquer momento do histórico, por MAIS DE UMA conta diferente entra
// na lista de suspeitos (ver buscarAlertasIpDuplicado).
ipListagem.get('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await podeVerListagemIp(c.env.DB, usuarioId))) {
    return c.json({ erro: 'sem permissão pra ver essa listagem' }, 403)
  }

  const [{ results: usuariosLista }, alertas] = await Promise.all([
    c.env.DB.prepare(
      `SELECT u.id, u.nick, u.tag, u.tipo, u.status, p.nome AS patente_nome,
         (SELECT le.ip FROM logs_eventos le WHERE le.usuario_id = u.id AND le.ip IS NOT NULL ORDER BY le.criado_em DESC LIMIT 1) AS ultimo_ip,
         (SELECT le.criado_em FROM logs_eventos le WHERE le.usuario_id = u.id AND le.ip IS NOT NULL ORDER BY le.criado_em DESC LIMIT 1) AS ultimo_acesso_em,
         (SELECT COUNT(DISTINCT le.ip) FROM logs_eventos le WHERE le.usuario_id = u.id AND le.ip IS NOT NULL) AS total_ips_distintos
       FROM usuarios u
       LEFT JOIN patentes p ON p.id = u.patente_atual_id
       WHERE u.tipo = 'jogador'
       ORDER BY u.nick`
    ).all<{ id: number; nick: string; ultimo_ip: string | null }>(),
    buscarAlertasIpDuplicado(c.env.DB),
  ])

  return c.json({ usuarios: usuariosLista, alertas })
})

// GET /ip-listagem/usuario/:usuarioId — todos os IPs distintos já usados
// por essa conta (agrupados a partir de logs_eventos), cada um com
// quantas vezes apareceu e quando foi visto pela primeira/última vez.
// Ordenado por último acesso decrescente (IP mais recente primeiro) —
// pedido do Vitor em 25/09/2026, pra expandir a linha do usuário na
// listagem principal (GET /ip-listagem) e ver o histórico completo, não
// só o último IP.
ipListagem.get('/usuario/:usuarioId', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await podeVerListagemIp(c.env.DB, usuarioId))) {
    return c.json({ erro: 'sem permissão pra ver essa listagem' }, 403)
  }

  const alvoId = c.req.param('usuarioId')
  const { results } = await c.env.DB.prepare(
    `SELECT ip, COUNT(*) AS total_acessos, MIN(criado_em) AS primeiro_acesso_em, MAX(criado_em) AS ultimo_acesso_em
     FROM logs_eventos
     WHERE usuario_id = ? AND ip IS NOT NULL
     GROUP BY ip
     ORDER BY ultimo_acesso_em DESC`
  ).bind(alvoId).all<{ ip: string; total_acessos: number; primeiro_acesso_em: string; ultimo_acesso_em: string }>()

  return c.json(results)
})

// GET /ip-listagem/busca-ip?ip=X — ids de conta que já usaram, EM
// QUALQUER MOMENTO do histórico, um IP contendo esse texto — não só o
// mais recente. Bug relatado pelo Vitor em 25/09/2026: a busca da
// listagem principal (GET /ip-listagem) filtra no cliente comparando só
// com `ultimo_ip` de cada conta, então uma conta que já usou aquele IP
// mas não é mais o IP atual dela nunca aparecia na busca — só a conta
// pra quem aquele IP AINDA é o mais recente. Esse endpoint completa a
// busca no cliente com o histórico completo (ver ips-usuarios.html).
ipListagem.get('/busca-ip', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await podeVerListagemIp(c.env.DB, usuarioId))) {
    return c.json({ erro: 'sem permissão pra ver essa listagem' }, 403)
  }

  const ip = c.req.query('ip')?.trim()
  if (!ip) return c.json([])

  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT usuario_id FROM logs_eventos WHERE usuario_id IS NOT NULL AND ip LIKE ?`
  ).bind(`%${ip}%`).all<{ usuario_id: number }>()

  return c.json(results.map((r) => r.usuario_id))
})

export default ipListagem
