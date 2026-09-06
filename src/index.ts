import { Hono } from 'hono'
import requerimentos from './routes/requerimentos'
import forum from './routes/forum'
import menu from './routes/menu'
import paginas from './routes/paginas'

// `Bindings` descreve os recursos do Cloudflare disponíveis no Worker
// (bindings configurados em wrangler.toml). DB é o D1 (SQLite gerenciado).
type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

// Health check — usar pra confirmar que o deploy e a conexão com o D1
// estão funcionando antes de construir qualquer rota de verdade.
app.get('/health', async (c) => {
  const result = await c.env.DB.prepare('SELECT 1 AS ok').first()
  return c.json({ status: 'ok', db: result })
})

app.route('/requerimentos', requerimentos)
app.route('/forum', forum)
app.route('/menu', menu)
app.route('/paginas', paginas)

// A partir daqui, novas rotas entram como módulos separados em
// src/routes/ (ex: src/routes/grupos.ts), montadas com app.route(...).

export default app
