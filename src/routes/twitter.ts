import { Hono } from 'hono'
import { notificar } from '../services/notificacoes'

type Bindings = { DB: D1Database }

const twitter = new Hono<{ Bindings: Bindings }>()

/** Extrai @menções do conteúdo e devolve os usuario_id encontrados (nick exato). */
async function extrairMencoes(db: D1Database, conteudo: string): Promise<number[]> {
  const nicks = [...conteudo.matchAll(/@([a-zA-Z0-9_.\-]+)/g)].map((m) => m[1])
  if (nicks.length === 0) return []

  const ids: number[] = []
  for (const nick of nicks) {
    const u = await db.prepare(`SELECT id FROM usuarios WHERE nick = ?`).bind(nick).first<{ id: number }>()
    if (u) ids.push(u.id)
  }
  return ids
}

// POST /tweets — post original, resposta, retweet (simples ou com
// comentário), com mídia e/ou enquete opcional.
twitter.post('/', async (c) => {
  const body = await c.req.json<{
    autor_id: number
    operado_por_id?: number
    conteudo?: string
    resposta_a_id?: number
    tweet_original_id?: number
    midias?: { tipo: 'imagem' | 'gif'; url: string }[]
    enquete?: { opcoes: string[]; expira_em: string }
  }>()

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO tweets (autor_id, operado_por_id, conteudo, resposta_a_id, tweet_original_id)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(body.autor_id, body.operado_por_id ?? null, body.conteudo ?? null, body.resposta_a_id ?? null, body.tweet_original_id ?? null)
    .run()

  const tweetId = Number(meta.last_row_id)

  if (body.midias?.length) {
    for (const [ordem, midia] of body.midias.entries()) {
      await c.env.DB.prepare(`INSERT INTO tweet_midias (tweet_id, tipo, url, ordem) VALUES (?, ?, ?, ?)`)
        .bind(tweetId, midia.tipo, midia.url, ordem)
        .run()
    }
  }

  if (body.enquete) {
    const { meta: metaEnquete } = await c.env.DB.prepare(
      `INSERT INTO tweet_enquetes (tweet_id, expira_em) VALUES (?, ?)`
    ).bind(tweetId, body.enquete.expira_em).run()
    const enqueteId = metaEnquete.last_row_id

    for (const [ordem, texto] of body.enquete.opcoes.entries()) {
      await c.env.DB.prepare(`INSERT INTO tweet_enquete_opcoes (enquete_id, texto, ordem) VALUES (?, ?, ?)`)
        .bind(enqueteId, texto, ordem)
        .run()
    }
  }

  // Notificações: resposta, retweet, menções.
  if (body.resposta_a_id) {
    const original = await c.env.DB.prepare(`SELECT autor_id FROM tweets WHERE id = ?`)
      .bind(body.resposta_a_id).first<{ autor_id: number }>()
    if (original && original.autor_id !== body.autor_id) {
      await notificar(c.env.DB, original.autor_id, 'tweet_resposta', 'Alguém respondeu seu tweet', {
        referenciaTipo: 'tweet', referenciaId: tweetId,
      })
    }
  }

  if (body.tweet_original_id) {
    const original = await c.env.DB.prepare(`SELECT autor_id FROM tweets WHERE id = ?`)
      .bind(body.tweet_original_id).first<{ autor_id: number }>()
    if (original && original.autor_id !== body.autor_id) {
      await notificar(c.env.DB, original.autor_id, 'tweet_retweet', 'Alguém retuitou seu tweet', {
        referenciaTipo: 'tweet', referenciaId: tweetId,
      })
    }
  }

  if (body.conteudo) {
    const mencionados = await extrairMencoes(c.env.DB, body.conteudo)
    for (const usuarioId of mencionados) {
      if (usuarioId !== body.autor_id) {
        await notificar(c.env.DB, usuarioId, 'tweet_mencao', 'Você foi mencionado em um tweet', {
          referenciaTipo: 'tweet', referenciaId: tweetId,
        })
      }
    }
  }

  return c.json({ id: tweetId }, 201)
})

// GET /tweets — timeline simples (mais recentes primeiro)
twitter.get('/', async (c) => {
  const autorId = c.req.query('autor_id')
  const query = autorId
    ? c.env.DB.prepare(`SELECT * FROM tweets WHERE autor_id = ? AND apagado = 0 ORDER BY criado_em DESC LIMIT 50`).bind(autorId)
    : c.env.DB.prepare(`SELECT * FROM tweets WHERE apagado = 0 ORDER BY criado_em DESC LIMIT 50`)
  const { results } = await query.all()
  return c.json(results)
})

// GET /tweets/:id — detalhe com mídia, contagens e enquete
twitter.get('/:id', async (c) => {
  const id = c.req.param('id')

  const tweet = await c.env.DB.prepare(`SELECT * FROM tweets WHERE id = ? AND apagado = 0`).bind(id).first()
  if (!tweet) return c.json({ erro: 'não encontrado' }, 404)

  const { results: midias } = await c.env.DB.prepare(`SELECT * FROM tweet_midias WHERE tweet_id = ? ORDER BY ordem`).bind(id).all()

  const curtidas = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM tweet_curtidas WHERE tweet_id = ?`).bind(id).first<{ n: number }>()
  const respostas = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM tweets WHERE resposta_a_id = ? AND apagado = 0`).bind(id).first<{ n: number }>()
  const retweets = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM tweets WHERE tweet_original_id = ? AND apagado = 0`).bind(id).first<{ n: number }>()

  const enquete = await c.env.DB.prepare(`SELECT * FROM tweet_enquetes WHERE tweet_id = ?`).bind(id).first<{ id: number; expira_em: string }>()
  let enqueteDetalhe = null
  if (enquete) {
    const { results: opcoes } = await c.env.DB.prepare(
      `SELECT o.id, o.texto, o.ordem, COUNT(v.id) AS votos
       FROM tweet_enquete_opcoes o LEFT JOIN tweet_enquete_votos v ON v.opcao_id = o.id
       WHERE o.enquete_id = ? GROUP BY o.id ORDER BY o.ordem`
    ).bind(enquete.id).all()
    enqueteDetalhe = { expira_em: enquete.expira_em, opcoes }
  }

  return c.json({
    ...tweet,
    midias,
    contagens: { curtidas: curtidas?.n ?? 0, respostas: respostas?.n ?? 0, retweets: retweets?.n ?? 0 },
    enquete: enqueteDetalhe,
  })
})

// DELETE /tweets/:id — soft delete, só o autor ou admin do sistema
twitter.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const usuarioId = Number(c.req.query('usuario_id'))

  const tweet = await c.env.DB.prepare(`SELECT autor_id FROM tweets WHERE id = ?`).bind(id).first<{ autor_id: number }>()
  if (!tweet) return c.json({ erro: 'não encontrado' }, 404)

  const admin = await c.env.DB.prepare(`SELECT administrador_sistema FROM usuarios WHERE id = ?`)
    .bind(usuarioId).first<{ administrador_sistema: number }>()

  if (tweet.autor_id !== usuarioId && !admin?.administrador_sistema) {
    return c.json({ erro: 'só o autor ou um administrador do sistema pode apagar' }, 403)
  }

  await c.env.DB.prepare(`UPDATE tweets SET apagado = 1 WHERE id = ?`).bind(id).run()
  return c.json({ ok: true })
})

// POST /tweets/:id/curtir — alterna (curte se não curtiu, descurte se já tinha curtido)
twitter.post('/:id/curtir', async (c) => {
  const id = c.req.param('id')
  const { usuario_id } = await c.req.json<{ usuario_id: number }>()

  const existente = await c.env.DB.prepare(`SELECT id FROM tweet_curtidas WHERE tweet_id = ? AND usuario_id = ?`)
    .bind(id, usuario_id).first<{ id: number }>()

  if (existente) {
    await c.env.DB.prepare(`DELETE FROM tweet_curtidas WHERE id = ?`).bind(existente.id).run()
    return c.json({ curtido: false })
  }

  await c.env.DB.prepare(`INSERT INTO tweet_curtidas (tweet_id, usuario_id) VALUES (?, ?)`).bind(id, usuario_id).run()

  const tweet = await c.env.DB.prepare(`SELECT autor_id FROM tweets WHERE id = ?`).bind(id).first<{ autor_id: number }>()
  if (tweet && tweet.autor_id !== usuario_id) {
    await notificar(c.env.DB, tweet.autor_id, 'tweet_curtida', 'Alguém curtiu seu tweet', {
      referenciaTipo: 'tweet', referenciaId: Number(id),
    })
  }

  return c.json({ curtido: true })
})

// POST /tweets/:id/enquete/votar
twitter.post('/:id/enquete/votar', async (c) => {
  const tweetId = c.req.param('id')
  const { opcao_id, usuario_id } = await c.req.json<{ opcao_id: number; usuario_id: number }>()

  const enquete = await c.env.DB.prepare(`SELECT id, expira_em FROM tweet_enquetes WHERE tweet_id = ?`)
    .bind(tweetId).first<{ id: number; expira_em: string }>()
  if (!enquete) return c.json({ erro: 'este tweet não tem enquete' }, 404)

  if (new Date(enquete.expira_em) < new Date()) {
    return c.json({ erro: 'enquete encerrada' }, 400)
  }

  try {
    await c.env.DB.prepare(`INSERT INTO tweet_enquete_votos (enquete_id, opcao_id, usuario_id) VALUES (?, ?, ?)`)
      .bind(enquete.id, opcao_id, usuario_id)
      .run()
  } catch {
    return c.json({ erro: 'você já votou nesta enquete' }, 409)
  }

  return c.json({ ok: true })
})

export default twitter
