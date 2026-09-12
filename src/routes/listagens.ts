import { Hono } from 'hono'

type Bindings = { DB: D1Database }

const listagens = new Hono<{ Bindings: Bindings }>()

interface MembroListagem {
  id: number
  nick: string
  tag: string | null
  status: string
  ultimo_tipo: string | null
  ultimo_autor_tag: string | null
  ultimo_requerimento_em: string | null
}

type MembroBase = Omit<MembroListagem, 'ultimo_tipo' | 'ultimo_autor_tag' | 'ultimo_requerimento_em'>

// Usuários desligados/exonerados só aparecem nas próprias listagens
// deles — nunca nas de hierarquia/TAGs, mesmo que a patente/TAG ainda
// esteja gravada no registro.
const EXCLUI_DESLIGADOS_EXONERADOS = `u.status NOT IN ('desligado_honroso', 'desligado_desonroso', 'exonerado')`

// Preenche, pra cada usuário, o tipo/TAG do autor/data do requerimento
// mais recente onde ele foi alvo — o frontend usa isso pra montar a
// mesma "identificação" (nick [prefixo+TAG] data) usada nos cards de
// requerimento, reaproveitando a lógica de lá.
async function anexarIdentificacao(db: D1Database, membros: MembroBase[]): Promise<MembroListagem[]> {
  if (!membros.length) return membros as MembroListagem[]

  const ids = membros.map((m) => m.id)
  const placeholders = ids.map(() => '?').join(',')
  const { results } = await db.prepare(
    `SELECT ra.usuario_id, r.tipo, r.criado_em, au.tag AS autor_tag
     FROM requerimento_alvos ra
     JOIN requerimentos r ON r.id = ra.requerimento_id
     LEFT JOIN usuarios au ON au.id = r.autor_id
     WHERE ra.usuario_id IN (${placeholders})
     ORDER BY r.criado_em DESC`
  ).bind(...ids).all<{ usuario_id: number; tipo: string; criado_em: string; autor_tag: string | null }>()

  const maisRecentePorUsuario: Record<number, { tipo: string; criado_em: string; autor_tag: string | null }> = {}
  for (const r of results) {
    if (!(r.usuario_id in maisRecentePorUsuario)) maisRecentePorUsuario[r.usuario_id] = r
  }

  return membros.map((m) => {
    const info = maisRecentePorUsuario[m.id]
    return {
      ...m,
      ultimo_tipo: info?.tipo ?? null,
      ultimo_autor_tag: info?.autor_tag ?? null,
      ultimo_requerimento_em: info?.criado_em ?? null,
    }
  })
}

// Igual a anexarIdentificacao, mas específico pra exoneração — traz o
// crime e o prazo (exoneracao_ate), pro frontend montar o formato
// próprio dessa "identificação" (igual ao card de requerimento).
interface MembroExonerado extends MembroListagem {
  crime_nome: string | null
  exoneracao_ate: string | null
}
async function anexarIdentificacaoExoneracao(db: D1Database, membros: MembroBase[]): Promise<MembroExonerado[]> {
  if (!membros.length) return membros as MembroExonerado[]

  const ids = membros.map((m) => m.id)
  const placeholders = ids.map(() => '?').join(',')
  const { results } = await db.prepare(
    `SELECT ra.usuario_id, r.tipo, r.criado_em, r.dados_especificos, au.tag AS autor_tag, cr.nome AS crime_nome
     FROM requerimento_alvos ra
     JOIN requerimentos r ON r.id = ra.requerimento_id
     LEFT JOIN usuarios au ON au.id = r.autor_id
     LEFT JOIN crimes cr ON cr.id = r.crime_id
     WHERE ra.usuario_id IN (${placeholders}) AND r.tipo = 'exoneracao'
     ORDER BY r.criado_em DESC`
  ).bind(...ids).all<{ usuario_id: number; tipo: string; criado_em: string; dados_especificos: string | null; autor_tag: string | null; crime_nome: string | null }>()

  const maisRecentePorUsuario: Record<number, typeof results[number]> = {}
  for (const r of results) {
    if (!(r.usuario_id in maisRecentePorUsuario)) maisRecentePorUsuario[r.usuario_id] = r
  }

  return membros.map((m) => {
    const info = maisRecentePorUsuario[m.id]
    let exoneracaoAte: string | null = null
    if (info?.dados_especificos) {
      try { exoneracaoAte = JSON.parse(info.dados_especificos)?.exoneracao_ate ?? null } catch {}
    }
    return {
      ...m,
      ultimo_tipo: info?.tipo ?? null,
      ultimo_autor_tag: info?.autor_tag ?? null,
      ultimo_requerimento_em: info?.criado_em ?? null,
      crime_nome: info?.crime_nome ?? null,
      exoneracao_ate: exoneracaoAte,
    }
  })
}

const SELECT_MEMBRO = `u.id, u.nick, u.tag, u.status`

// GET /listagens/:tipo
listagens.get('/:tipo', async (c) => {
  const tipo = c.req.param('tipo')

  // --- TAGs: lista única, achatada — nick, TAG e avatar ---
  if (tipo === 'tags') {
    const { results } = await c.env.DB.prepare(
      `SELECT nick, tag FROM usuarios u WHERE tag IS NOT NULL AND ${EXCLUI_DESLIGADOS_EXONERADOS} ORDER BY nick`
    ).all()
    return c.json({ tipoVisual: 'flat', itens: results })
  }

  // --- Exonerados: dois grupos fixos por duração, identificação própria ---
  if (tipo === 'exonerados') {
    const { results } = await c.env.DB.prepare(
      `SELECT ${SELECT_MEMBRO} FROM usuarios u WHERE u.status = 'exonerado' AND u.exoneracao_ate IS NOT NULL ORDER BY u.nick`
    ).all<MembroBase>()
    const { results: permanentes } = await c.env.DB.prepare(
      `SELECT ${SELECT_MEMBRO} FROM usuarios u WHERE u.status = 'exonerado' AND u.exoneracao_ate IS NULL ORDER BY u.nick`
    ).all<MembroBase>()

    return c.json({
      tipoVisual: 'agrupado',
      formatoExoneracao: true,
      grupos: [
        { titulo: 'Exoneração Temporária', cor: 'amarelo', itens: await anexarIdentificacaoExoneracao(c.env.DB, results) },
        { titulo: 'Exoneração Permanente', cor: 'vermelho', itens: await anexarIdentificacaoExoneracao(c.env.DB, permanentes) },
      ],
    })
  }

  // --- Desligados: dois grupos fixos, honroso/desonroso ---
  if (tipo === 'desligados') {
    const { results: honrosos } = await c.env.DB.prepare(
      `SELECT ${SELECT_MEMBRO} FROM usuarios u WHERE u.status = 'desligado_honroso' ORDER BY u.nick`
    ).all<MembroBase>()
    const { results: desonrosos } = await c.env.DB.prepare(
      `SELECT ${SELECT_MEMBRO} FROM usuarios u WHERE u.status = 'desligado_desonroso' ORDER BY u.nick`
    ).all<MembroBase>()

    return c.json({
      tipoVisual: 'agrupado',
      grupos: [
        { titulo: 'Desligamento Honroso', cor: 'verde', itens: await anexarIdentificacao(c.env.DB, honrosos) },
        { titulo: 'Desligamento Desonroso', cor: 'vermelho', itens: await anexarIdentificacao(c.env.DB, desonrosos) },
      ],
    })
  }

  // --- Reformados: agrupado por patente, só os grupos que têm gente ---
  if (tipo === 'reformados') {
    const { results } = await c.env.DB.prepare(
      `SELECT ${SELECT_MEMBRO}, p.nome AS patente_nome, p.ordem AS patente_ordem
       FROM usuarios u LEFT JOIN patentes p ON p.id = u.patente_atual_id
       WHERE u.status = 'reformado' ORDER BY p.ordem DESC, u.nick`
    ).all<{ patente_nome: string | null } & MembroBase>()

    const comIdentificacao = await anexarIdentificacao(c.env.DB, results)
    const grupos: { titulo: string; cor: string; itens: MembroListagem[] }[] = []
    const indice: Record<string, number> = {}
    for (const m of comIdentificacao as (MembroListagem & { patente_nome: string | null })[]) {
      const chave = m.patente_nome || 'Sem patente/cargo'
      if (!(chave in indice)) { indice[chave] = grupos.length; grupos.push({ titulo: chave, cor: 'escuro', itens: [] }) }
      grupos[indice[chave]].itens.push(m)
    }
    return c.json({ tipoVisual: 'agrupado', grupos })
  }

  // --- Corpos com hierarquia de patente: soldados, corpo-de-pracas,
  // corpo-de-oficiais, corpo-executivo — mostra TODAS as patentes da
  // faixa, mesmo vazias. "Alto Comando Militar" (a patente suprema)
  // aparece tanto em Corpo de Oficiais quanto em Corpo Executivo.
  const FILTRO_PATENTES: Record<string, string> = {
    soldados: `nome = 'Soldado'`,
    'corpo-de-pracas': `sub_corpo IN ('pracas', 'pracas_especiais') AND nome != 'Soldado'`,
    'corpo-de-oficiais': `sub_corpo = 'oficiais'`,
    'corpo-executivo': `corpo = 'executivo' OR nome = 'Alto Comando Militar'`,
  }
  const FILTRO_PATENTES_JOIN: Record<string, string> = {
    soldados: `p.nome = 'Soldado'`,
    'corpo-de-pracas': `p.sub_corpo IN ('pracas', 'pracas_especiais') AND p.nome != 'Soldado'`,
    'corpo-de-oficiais': `p.sub_corpo = 'oficiais'`,
    'corpo-executivo': `p.corpo = 'executivo' OR p.nome = 'Alto Comando Militar'`,
  }
  const filtroPatentes = FILTRO_PATENTES[tipo]
  if (!filtroPatentes) return c.json({ erro: `listagem '${tipo}' não existe` }, 404)

  const { results: patentes } = await c.env.DB.prepare(
    `SELECT id, nome, ordem, cor FROM patentes WHERE ativo = 1 AND (${filtroPatentes}) ORDER BY ordem DESC`
  ).all<{ id: number; nome: string; ordem: number; cor: string | null }>()

  const { results: membros } = await c.env.DB.prepare(
    `SELECT ${SELECT_MEMBRO}, u.patente_atual_id
     FROM usuarios u JOIN patentes p ON p.id = u.patente_atual_id
     WHERE (${FILTRO_PATENTES_JOIN[tipo]}) AND ${EXCLUI_DESLIGADOS_EXONERADOS}
     ORDER BY p.ordem DESC, u.nick`
  ).all<{ patente_atual_id: number } & MembroBase>()

  const comIdentificacao = await anexarIdentificacao(c.env.DB, membros)
  const grupos = patentes.map((p) => ({
    titulo: p.nome,
    cor: p.cor || (p.ordem === patentes[0]?.ordem ? 'dourado' : 'escuro'),
    itens: (comIdentificacao as (MembroListagem & { patente_atual_id: number })[]).filter((m) => m.patente_atual_id === p.id),
  }))

  return c.json({ tipoVisual: 'agrupado', grupos })
})

export default listagens
