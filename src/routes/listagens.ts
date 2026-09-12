import { Hono } from 'hono'

type Bindings = { DB: D1Database }

const listagens = new Hono<{ Bindings: Bindings }>()

// Cada listagem é só um filtro diferente sobre a mesma consulta base
// — mantém o "estado atual" de cada categoria, no espírito das abas
// da planilha antiga (seção 8 do doc-mestre), agora ao vivo.
const FILTROS: Record<string, string> = {
  soldados: `p.nome = 'Soldado'`,
  'corpo-de-pracas': `p.sub_corpo IN ('pracas', 'pracas_especiais')`,
  'corpo-de-oficiais': `p.sub_corpo = 'oficiais'`,
  'corpo-executivo': `u.corpo = 'executivo'`,
  tags: `u.tag IS NOT NULL`,
  reformados: `u.status = 'reformado'`,
  exonerados: `u.status = 'exonerado'`,
}

// GET /listagens/:tipo
listagens.get('/:tipo', async (c) => {
  const tipo = c.req.param('tipo')
  const filtro = FILTROS[tipo]
  if (!filtro) return c.json({ erro: `listagem '${tipo}' não existe` }, 404)

  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.nick, u.tag, u.status, u.corpo, u.data_ultimo_ato_funcional,
            p.nome AS patente_nome, p.ordem AS patente_ordem
     FROM usuarios u
     LEFT JOIN patentes p ON p.id = u.patente_atual_id
     WHERE ${filtro}
     ORDER BY p.ordem DESC, u.nick`
  ).all()

  return c.json(results)
})

export default listagens
