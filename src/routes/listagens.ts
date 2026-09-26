import { Hono } from 'hono'
import type { D1Like } from '../types/db'

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

// Integração e Reforma guardam uma data histórica própria dentro de
// dados_especificos (data/data_ultimo_ato_funcional pra integração,
// data_reforma pra reforma) — o `criado_em` do requerimento só reflete
// quando ele foi registrado no sistema, não a data real do ato (que
// pode ser bem anterior, ex: migração de um cadastro antigo da
// planilha). Sem isso, a "identificação" mostrada nas listagens sai com
// a data de hoje em vez da data histórica (mesmo bug já corrigido no
// perfil-dashboard.html e no card de requerimento — ver notas-tecnicas
// no projeto: essa lógica tende a se duplicar entre arquivos e precisa
// ficar sincronizada em todos eles).
function dataEfetivaIdentificacao(tipo: string, dadosEspecificosJson: string | null, criadoEm: string): string {
  if (!dadosEspecificosJson) return criadoEm
  try {
    const dados = JSON.parse(dadosEspecificosJson) as Record<string, unknown>
    if (tipo === 'integracao') return (dados.data_ultimo_ato_funcional as string) || (dados.data as string) || criadoEm
    if (tipo === 'reforma') return (dados.data_reforma as string) || criadoEm
    return criadoEm
  } catch {
    return criadoEm
  }
}

// Preenche, pra cada usuário, o tipo/TAG do autor/data do requerimento
// mais recente onde ele foi alvo — o frontend usa isso pra montar a
// mesma "identificação" (nick [prefixo+TAG] data) usada nos cards de
// requerimento, reaproveitando a lógica de lá.
async function anexarIdentificacao(db: D1Like, membros: MembroBase[]): Promise<MembroListagem[]> {
  if (!membros.length) return membros as MembroListagem[]

  const ids = membros.map((m) => m.id)
  const placeholders = ids.map(() => '?').join(',')
  const { results } = await db.prepare(
    `SELECT ra.usuario_id, r.tipo, r.criado_em, r.dados_especificos, COALESCE(r.tag_grupo_override, au.tag) AS autor_tag
     FROM requerimento_alvos ra
     JOIN requerimentos r ON r.id = ra.requerimento_id
     LEFT JOIN usuarios au ON au.id = r.autor_id
     WHERE ra.usuario_id IN (${placeholders})
     ORDER BY r.criado_em DESC`
  ).bind(...ids).all<{ usuario_id: number; tipo: string; criado_em: string; dados_especificos: string | null; autor_tag: string | null }>()

  const maisRecentePorUsuario: Record<number, typeof results[number]> = {}
  for (const r of results) {
    if (!(r.usuario_id in maisRecentePorUsuario)) maisRecentePorUsuario[r.usuario_id] = r
  }

  return membros.map((m) => {
    const info = maisRecentePorUsuario[m.id]
    return {
      ...m,
      ultimo_tipo: info?.tipo ?? null,
      ultimo_autor_tag: info?.autor_tag ?? null,
      ultimo_requerimento_em: info ? dataEfetivaIdentificacao(info.tipo, info.dados_especificos, info.criado_em) : null,
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
async function anexarIdentificacaoExoneracao(db: D1Like, membros: MembroBase[]): Promise<MembroExonerado[]> {
  if (!membros.length) return membros as MembroExonerado[]

  const ids = membros.map((m) => m.id)
  const placeholders = ids.map(() => '?').join(',')
  const { results } = await db.prepare(
    `SELECT ra.usuario_id, r.tipo, r.criado_em, r.dados_especificos, COALESCE(r.tag_grupo_override, au.tag) AS autor_tag, cr.nome AS crime_nome
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

  // Sessão 'first-primary': a primeira query de cada sessão sempre vai
  // pro banco primário, garantindo que essa listagem nunca leia de uma
  // réplica D1 atrasada em relação a uma aprovação/cancelamento feito
  // segundos antes (ex: exonerar alguém e recarregar a listagem na
  // sequência mostrando identificação incompleta/vazia). Mesmo padrão
  // usado em routes/projetos.ts.
  const db = c.env.DB.withSession('first-primary')

  // --- TAGs: lista única, achatada — nick, TAG e avatar ---
  if (tipo === 'tags') {
    const { results } = await db.prepare(
      `SELECT nick, tag FROM usuarios u WHERE tag IS NOT NULL AND ${EXCLUI_DESLIGADOS_EXONERADOS} ORDER BY nick`
    ).all()
    return c.json({ tipoVisual: 'flat', itens: results })
  }

  // --- Exonerados: dois grupos fixos por duração, identificação própria ---
  if (tipo === 'exonerados') {
    const { results } = await db.prepare(
      `SELECT ${SELECT_MEMBRO} FROM usuarios u WHERE u.status = 'exonerado' AND u.exoneracao_ate IS NOT NULL ORDER BY u.nick`
    ).all<MembroBase>()
    const { results: permanentes } = await db.prepare(
      `SELECT ${SELECT_MEMBRO} FROM usuarios u WHERE u.status = 'exonerado' AND u.exoneracao_ate IS NULL ORDER BY u.nick`
    ).all<MembroBase>()

    return c.json({
      tipoVisual: 'agrupado',
      formatoExoneracao: true,
      grupos: [
        { titulo: 'Exoneração Temporária', cor: 'amarelo', itens: await anexarIdentificacaoExoneracao(db, results) },
        { titulo: 'Exoneração Permanente', cor: 'vermelho', itens: await anexarIdentificacaoExoneracao(db, permanentes) },
      ],
    })
  }

  // --- Desligados: dois grupos fixos, honroso/desonroso ---
  if (tipo === 'desligados') {
    const { results: honrosos } = await db.prepare(
      `SELECT ${SELECT_MEMBRO} FROM usuarios u WHERE u.status = 'desligado_honroso' ORDER BY u.nick`
    ).all<MembroBase>()
    const { results: desonrosos } = await db.prepare(
      `SELECT ${SELECT_MEMBRO} FROM usuarios u WHERE u.status = 'desligado_desonroso' ORDER BY u.nick`
    ).all<MembroBase>()

    return c.json({
      tipoVisual: 'agrupado',
      grupos: [
        { titulo: 'Desligamento Honroso', cor: 'verde', itens: await anexarIdentificacao(db, honrosos) },
        { titulo: 'Desligamento Desonroso', cor: 'vermelho', itens: await anexarIdentificacao(db, desonrosos) },
      ],
    })
  }

  // --- Reformados: agrupado por patente, só os grupos que têm gente ---
  if (tipo === 'reformados') {
    const { results } = await db.prepare(
      `SELECT ${SELECT_MEMBRO}, p.nome AS patente_nome, p.ordem AS patente_ordem
       FROM usuarios u LEFT JOIN patentes p ON p.id = u.patente_atual_id
       WHERE u.status = 'reformado' ORDER BY p.ordem DESC, u.nick`
    ).all<{ patente_nome: string | null } & MembroBase>()

    const comIdentificacao = await anexarIdentificacao(db, results)
    const grupos: { titulo: string; cor: string; itens: MembroListagem[] }[] = []
    const indice: Record<string, number> = {}
    for (const m of comIdentificacao as (MembroListagem & { patente_nome: string | null })[]) {
      const chave = m.patente_nome || 'Sem patente/cargo'
      if (!(chave in indice)) { indice[chave] = grupos.length; grupos.push({ titulo: chave, cor: 'escuro', itens: [] }) }
      grupos[indice[chave]].itens.push(m)
    }
    return c.json({ tipoVisual: 'agrupado', grupos })
  }

  // --- Gratificação: ranking do mês (maior total primeiro), com
  // seletor de mês — usa `?mes=YYYY-MM` (padrão: mês corrente). O total
  // soma `valor_gratificacao` (já congelado na criação, não recalcula
  // a partir do motivo atual) de requerimentos aprovados do tipo
  // 'bonificacao' — reinício mensal é só um efeito do filtro por mês,
  // não existe zeragem/job nenhum: o mês anterior continua consultável
  // via `mes`, e a lista de meses disponíveis alimenta o seletor.
  //
  // Medalha (dados_especificos.categoria = 'medalha', ver 0055) NÃO é
  // gratificação em raros — não tem valor_gratificacao nenhum pra
  // somar, então entra aqui excluída (o WHERE abaixo tira essas linhas
  // do JOIN inteiro, não só da soma) — sem isso, quem só recebeu
  // medalha aparecia no ranking com "+null" (SUM de um grupo 100%
  // NULL). COALESCE cobre o resto (gratificação comum sem
  // valor_gratificacao gravado — gap pré-existente, documentado em
  // claude/medalha-honrarias-2026-09-25.md) pra nunca mais exibir a
  // string "null" aqui.
  if (tipo === 'gratificacao') {
    const mes = c.req.query('mes') || new Date().toISOString().slice(0, 7)
    const FILTRO_NAO_MEDALHA = `(r.dados_especificos IS NULL OR json_extract(r.dados_especificos, '$.categoria') IS NOT 'medalha')`

    const { results: itens } = await db.prepare(
      `SELECT u.id, u.nick, u.tag, COALESCE(SUM(r.valor_gratificacao), 0) AS total
       FROM requerimentos r
       JOIN requerimento_alvos ra ON ra.requerimento_id = r.id
       JOIN usuarios u ON u.id = ra.usuario_id
       WHERE r.tipo = 'bonificacao' AND r.status = 'aprovado' AND strftime('%Y-%m', r.criado_em) = ? AND ${FILTRO_NAO_MEDALHA}
       GROUP BY u.id
       ORDER BY total DESC, u.nick`
    ).bind(mes).all<{ id: number; nick: string; tag: string | null; total: number }>()

    const { results: mesesDisponiveis } = await db.prepare(
      `SELECT DISTINCT strftime('%Y-%m', r.criado_em) AS mes
       FROM requerimentos r WHERE r.tipo = 'bonificacao' AND r.status = 'aprovado' AND ${FILTRO_NAO_MEDALHA}
       ORDER BY mes DESC`
    ).all<{ mes: string }>()

    return c.json({
      tipoVisual: 'ranking',
      mes,
      mesesDisponiveis: mesesDisponiveis.map((m) => m.mes).filter(Boolean),
      itens,
    })
  }

  // --- Corpos com hierarquia de patente: soldados, corpo-de-pracas,
  // corpo-de-oficiais, corpo-executivo — mostra TODAS as patentes da
  // faixa, mesmo vazias. "Alto Comando Militar" (a patente suprema)
  // aparece tanto em Corpo de Oficiais quanto em Corpo Executivo.
  const FILTRO_PATENTES: Record<string, string> = {
    soldados: `nome = 'Soldado'`,
    'corpo-de-pracas': `sub_corpo IN ('pracas', 'pracas_especiais') AND nome != 'Soldado'`,
    'corpo-de-oficiais': `sub_corpo = 'oficiais'`,
    'corpo-executivo': `corpo = 'executivo' OR eh_suprema = 1`,
  }
  const FILTRO_PATENTES_JOIN: Record<string, string> = {
    soldados: `p.nome = 'Soldado'`,
    'corpo-de-pracas': `p.sub_corpo IN ('pracas', 'pracas_especiais') AND p.nome != 'Soldado'`,
    'corpo-de-oficiais': `p.sub_corpo = 'oficiais'`,
    'corpo-executivo': `p.corpo = 'executivo' OR p.eh_suprema = 1`,
  }
  const filtroPatentes = FILTRO_PATENTES[tipo]
  if (!filtroPatentes) return c.json({ erro: `listagem '${tipo}' não existe` }, 404)

  const { results: patentes } = await db.prepare(
    `SELECT id, nome, ordem, cor, vagas FROM patentes WHERE ativo = 1 AND (${filtroPatentes}) ORDER BY ordem DESC`
  ).all<{ id: number; nome: string; ordem: number; cor: string | null; vagas: number | null }>()

  const { results: membros } = await db.prepare(
    `SELECT ${SELECT_MEMBRO}, u.patente_atual_id
     FROM usuarios u JOIN patentes p ON p.id = u.patente_atual_id
     WHERE (${FILTRO_PATENTES_JOIN[tipo]}) AND ${EXCLUI_DESLIGADOS_EXONERADOS}
     ORDER BY p.ordem DESC, u.nick`
  ).all<{ patente_atual_id: number } & MembroBase>()

  const comIdentificacao = await anexarIdentificacao(db, membros)
  // `vagas` vem direto da tabela `patentes` (seção 2.3 do documento-mestre
  // — só Corpo de Oficiais e Chanceler têm limite; o resto fica `null`).
  // NÃO inclui aqui a regra da "vaga extraordinária" (a cada 5 oficiais da
  // mesma patente em licença, abre 1 vaga temporária) — o número mostrado
  // é sempre o limite normal, mesmo se colar exatamente que o card também
  // lista quem está de licença no rodapé.
  const membrosComIdentificacao = comIdentificacao as (MembroListagem & { patente_atual_id: number })[]
  const grupos = patentes.map((p) => ({
    titulo: p.nome,
    cor: p.cor || (p.ordem === patentes[0]?.ordem ? 'dourado' : 'escuro'),
    vagas: p.vagas,
    itens: membrosComIdentificacao.filter((m) => m.patente_atual_id === p.id),
  }))

  // Alguém com `patente_atual_id` apontando pra uma patente desativada
  // (`ativo = 0`) não some mais em silêncio — antes ficava de fora de
  // todo grupo (só patentes ativas viram grupo) sem nenhum aviso. Junta
  // esses casos num grupo à parte, só quando existirem.
  const idsPatentesAtivas = new Set(patentes.map((p) => p.id))
  const comPatenteDesativada = membrosComIdentificacao.filter((m) => !idsPatentesAtivas.has(m.patente_atual_id))
  if (comPatenteDesativada.length) {
    grupos.push({ titulo: 'Patente desativada', cor: 'escuro', vagas: null, itens: comPatenteDesativada })
  }

  return c.json({ tipoVisual: 'agrupado', grupos })
})

export default listagens
