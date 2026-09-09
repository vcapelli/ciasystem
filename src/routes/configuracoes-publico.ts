import { Hono } from 'hono'

type Bindings = { DB: D1Database }

const configuracoesPublico = new Hono<{ Bindings: Bindings }>()

// GET /configuracoes — chave/valor públicas do sistema (ex: logo).
// Fica FORA da autenticação de propósito: a tela de login precisa
// mostrar a logo antes de qualquer token existir.
configuracoesPublico.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT chave, valor FROM configuracoes_sistema`).all()
  const mapa: Record<string, string | null> = {}
  for (const linha of results as { chave: string; valor: string | null }[]) {
    mapa[linha.chave] = linha.valor
  }
  return c.json(mapa)
})

export default configuracoesPublico
