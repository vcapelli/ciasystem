import { Hono } from 'hono'

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

// A partir daqui, rotas reais entram como módulos separados em
// src/routes/ (ex: src/routes/usuarios.ts, src/routes/requerimentos.ts),
// montados aqui com app.route('/usuarios', usuariosRouter).

export default app
