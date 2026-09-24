import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { usuarioId: number }

const configuracoesAdmin = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function ehAdmin(db: D1Database, usuarioId: number): Promise<boolean> {
  const u = await db.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()
  return Boolean(u?.administrador_sistema)
}

// GET /configuracoes/todas — todas as chaves (não só as marcadas como
// públicas), pra qualquer usuário AUTENTICADO (não precisa ser admin
// do sistema). Existe porque, desde que o endpoint público
// (GET /configuracoes, fora da autenticação) passou a filtrar só
// `publica = 1`, telas que já exigem login (ex: Projetos, lendo
// `projetos_grupo_responsavel_id`/`projetos_niveis_votantes_ids`)
// ficaram sem como ler configuração operacional que não é secreta,
// só não deveria vazar pra quem nem tem conta. Path diferente de
// `/configuracoes` de propósito, pra não colidir com a rota pública
// (mesmo prefixo, métodos diferentes seria arriscado de garantir).
configuracoesAdmin.get('/todas', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT chave, valor FROM configuracoes_sistema`)
    .all<{ chave: string; valor: string }>()

  const config: Record<string, string> = {}
  for (const linha of results) config[linha.chave] = linha.valor

  return c.json(config)
})

// PATCH /configuracoes — define/atualiza uma ou mais chaves de
// configuração global. Só administradores do sistema.
//
// Body normal: um objeto livre chave/valor (`{ logo_url: '...' }`) —
// comportamento igual ao de sempre, não mexe em `publica`.
//
// Opcionalmente aceita também `chaves_publicas: string[]` no mesmo
// body: quando esse campo vier, TODAS as chaves já existentes na
// tabela são sincronizadas com essa lista — `publica = 1` pras que
// estão nela, `publica = 0` pras demais. Se `chaves_publicas` não for
// enviado, nenhuma chave tem sua visibilidade alterada por esse PATCH.
configuracoesAdmin.patch('/', async (c) => {
  const usuarioId = c.get('usuarioId')
  if (!(await ehAdmin(c.env.DB, usuarioId))) {
    return c.json({ erro: 'só administradores do sistema alteram configurações' }, 403)
  }

  const body = await c.req.json<Record<string, unknown>>()
  const { chaves_publicas: chavesPublicas, ...valores } = body

  for (const [chave, valor] of Object.entries(valores)) {
    await c.env.DB.prepare(
      `INSERT INTO configuracoes_sistema (chave, valor) VALUES (?, ?)
       ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')`
    ).bind(chave, String(valor)).run()
  }

  if (Array.isArray(chavesPublicas)) {
    const publicas = chavesPublicas.filter((v): v is string => typeof v === 'string')
    await c.env.DB.prepare(
      `UPDATE configuracoes_sistema SET publica = CASE WHEN chave IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END`
    ).bind(JSON.stringify(publicas)).run()
  }

  return c.json({ ok: true })
})

export default configuracoesAdmin
