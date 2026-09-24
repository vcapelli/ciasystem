import { Hono } from 'hono'

type Bindings = { DB: D1Database }

const configuracoesPublico = new Hono<{ Bindings: Bindings }>()

// GET /configuracoes — chave/valor públicas do sistema (ex: logo).
// Fica FORA da autenticação de propósito: a tela de login precisa
// mostrar a logo antes de qualquer token existir. Só devolve as
// chaves marcadas como `publica = 1` — configurações internas (ex:
// ids de grupo/nível usados por projetos) não devem vazar aqui; quem
// grava isso é o PATCH /configuracoes (admin), que decide o que é
// público via `chaves_publicas`.
configuracoesPublico.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT chave, valor FROM configuracoes_sistema WHERE publica = 1`).all()
  const mapa: Record<string, string | null> = {}
  for (const linha of results as { chave: string; valor: string | null }[]) {
    mapa[linha.chave] = linha.valor
  }
  return c.json(mapa)
})

export default configuracoesPublico
