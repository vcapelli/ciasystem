import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { reverterEfeitoAlvo } from './services/efeitos'
import auth from './routes/auth'
import { requireAuth } from './services/auth'
import configuracoesPublico from './routes/configuracoes-publico'
import configuracoesAdmin from './routes/configuracoes-admin'
import requerimentos from './routes/requerimentos'
import forum from './routes/forum'
import menu from './routes/menu'
import paginas from './routes/paginas'
import { criarRotaDistincao } from './routes/distincoes'
import conquistas from './routes/conquistas'
import medalhas from './routes/medalhas'
import cursos from './routes/cursos'
import grupos from './routes/grupos'
import documentos from './routes/documentos'
import mensagens from './routes/mensagens'
import noticias from './routes/noticias'
import notificacoes from './routes/notificacoes'
import twitter from './routes/twitter'
import seguidores from './routes/seguidores'
import sugestoes from './routes/sugestoes'
import tickets from './routes/tickets'
import logs from './routes/logs'
import usuarios from './routes/usuarios'
import patentes from './routes/patentes'
import crimes from './routes/crimes'
import habblet from './routes/habblet'
import bannersPerfil from './routes/banners-perfil'
import listagens from './routes/listagens'
import permissoes from './routes/permissoes'
import requisitosPatente from './routes/requisitos-patente'
import documentosPermissoes from './routes/documentos-permissoes'

// `Bindings` descreve os recursos do Cloudflare disponíveis no Worker
// (bindings configurados em wrangler.toml + secrets). `Variables` é o
// que o middleware de auth injeta no contexto pro resto da cadeia ler.
type Bindings = {
  DB: D1Database
  JWT_SECRET: string
}
type Variables = {
  usuarioId: number
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Handler global de erro — sem isso, uma exceção não tratada em
// qualquer rota vira um 500 genérico e o stack trace real some do
// `wrangler tail` (só aparece a mensagem curta). Com isso, o stack
// completo vai pro log, mesmo que o cliente só veja um erro limpo.
app.onError((err, c) => {
  console.error('Erro não tratado:', err instanceof Error ? err.stack : err)
  return c.json({ erro: 'erro interno do servidor' }, 500)
})

// CORS: o frontend (ciasystem.vitorcape.com.br) fica em domínio
// diferente da API (api-rpg[-dev].vitorcape.com.br) — precisa liberar
// explicitamente. Os endereços locais cobrem o desenvolvimento do
// frontend antes de subir pro domínio de verdade.
app.use('*', cors({
  origin: [
    'https://ciasystem.vitorcape.com.br',
    'http://localhost:8788',
    'http://127.0.0.1:8788',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
  ],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
}))

// Health check e login ficam FORA da autenticação.
app.get('/health', async (c) => {
  const result = await c.env.DB.prepare('SELECT 1 AS ok').first()
  return c.json({ status: 'ok', db: result })
})
app.route('/auth', auth)
app.route('/configuracoes', configuracoesPublico)

// Sub-app separado pra tudo que exige login — o middleware é
// registrado ANTES de qualquer rota dentro dele, então roda sempre
// primeiro pra qualquer path aqui dentro, sem ambiguidade de ordem.
const protegido = new Hono<{ Bindings: Bindings; Variables: Variables }>()
protegido.use('*', requireAuth)

protegido.route('/requerimentos', requerimentos)
protegido.route('/forum', forum)
protegido.route('/menu', menu)
protegido.route('/paginas', paginas)
protegido.route('/emblemas', criarRotaDistincao('emblemas'))
protegido.route('/honrarias', criarRotaDistincao('honrarias'))
protegido.route('/conquistas', conquistas)
protegido.route('/medalhas', medalhas)
protegido.route('/cursos', cursos)
protegido.route('/grupos', grupos)
protegido.route('/documentos', documentos)
protegido.route('/mensagens', mensagens)
protegido.route('/noticias', noticias)
protegido.route('/notificacoes', notificacoes)
protegido.route('/tweets', twitter)
protegido.route('/seguidores', seguidores)
protegido.route('/sugestoes', sugestoes)
protegido.route('/tickets', tickets)
protegido.route('/logs', logs)
protegido.route('/usuarios', usuarios)
protegido.route('/patentes', patentes)
protegido.route('/crimes', crimes)
protegido.route('/habblet', habblet)
protegido.route('/banners-perfil', bannersPerfil)
protegido.route('/listagens', listagens)
protegido.route('/permissoes-requerimentos', permissoes)
protegido.route('/requisitos-patente', requisitosPatente)
protegido.route('/documentos-permissoes', documentosPermissoes)
protegido.route('/configuracoes', configuracoesAdmin)

app.route('/', protegido)

// A partir daqui, novas rotas protegidas entram no `protegido`, não
// direto no `app` (senão ficam sem autenticação por engano).

// Cron diário: reverte exonerações temporárias cujo prazo já passou —
// mesma lógica de "cancelar" (usa o snapshot de antes da aprovação),
// já que expirar o prazo tem o mesmo efeito de desfazer a punição.
async function processarExoneracoesExpiradas(db: D1Database) {
  const { results: expirados } = await db.prepare(
    `SELECT id FROM usuarios WHERE status = 'exonerado' AND exoneracao_ate IS NOT NULL
     AND exoneracao_ate <= strftime('%Y-%m-%dT%H:%M:%SZ','now')`
  ).all<{ id: number }>()

  for (const usuario of expirados) {
    const alvo = await db.prepare(
      `SELECT ra.id AS alvo_id, ra.requerimento_id FROM requerimento_alvos ra
       JOIN requerimentos r ON r.id = ra.requerimento_id
       WHERE ra.usuario_id = ? AND r.tipo = 'exoneracao' AND ra.status = 'aprovado'
       ORDER BY ra.decidido_em DESC LIMIT 1`
    ).bind(usuario.id).first<{ alvo_id: number; requerimento_id: number }>()

    if (alvo) {
      await reverterEfeitoAlvo(db, alvo.requerimento_id, alvo.alvo_id, usuario.id)
    }
    // Sempre limpa o prazo, mesmo se não achou o requerimento (evita
    // tentar reverter de novo no próximo cron caso algo tenha falhado).
    await db.prepare(`UPDATE usuarios SET exoneracao_ate = NULL WHERE id = ?`).bind(usuario.id).run()
  }
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: { DB: D1Database }, ctx: ExecutionContext) {
    ctx.waitUntil(processarExoneracoesExpiradas(env.DB))
  },
}
