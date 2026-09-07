import { Hono } from 'hono'
import auth from './routes/auth'
import { requireAuth } from './services/auth'
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

// Health check e login ficam FORA da autenticação.
app.get('/health', async (c) => {
  const result = await c.env.DB.prepare('SELECT 1 AS ok').first()
  return c.json({ status: 'ok', db: result })
})
app.route('/auth', auth)

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

app.route('/', protegido)

// A partir daqui, novas rotas protegidas entram no `protegido`, não
// direto no `app` (senão ficam sem autenticação por engano).

export default app
