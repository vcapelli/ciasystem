// Bloqueio progressivo por chave (ex: "login-senha:<nick>"), persistido
// no D1 — Workers não tem memória compartilhada entre requests/instâncias,
// então um contador em variável de módulo não funcionaria (cada
// instância veria sua própria contagem, e reiniciaria a zero a
// qualquer momento).
//
// Decai sozinho: se a última tentativa foi há mais de 1h, a contagem
// zera antes de contar a atual — evita que alguém fique "sujo" pra
// sempre por causa de um pico isolado de dias atrás, sem precisar de
// nenhum job de limpeza separado.

const JANELA_DECAIMENTO_MS = 60 * 60 * 1000 // 1h sem nenhuma tentativa nova -> zera o contador
const LIMITE_ANTES_DE_BLOQUEAR = 3 // as primeiras 3 tentativas nunca bloqueiam
const ESCALA_BLOQUEIO_SEGUNDOS = [30, 60, 5 * 60, 15 * 60, 30 * 60] // 30s, 1min, 5min, 15min, 30min (teto)

export interface StatusBloqueio {
  bloqueado: boolean
  segundosRestantes: number
}

async function lerContador(db: D1Database, chave: string): Promise<{ tentativas: number; bloqueadoAte: string | null }> {
  const row = await db
    .prepare(`SELECT tentativas, bloqueado_ate, atualizado_em FROM tentativas_acesso WHERE chave = ?`)
    .bind(chave)
    .first<{ tentativas: number; bloqueado_ate: string | null; atualizado_em: string }>()
  if (!row) return { tentativas: 0, bloqueadoAte: null }

  const decaiu = Date.now() - new Date(row.atualizado_em).getTime() > JANELA_DECAIMENTO_MS
  return decaiu ? { tentativas: 0, bloqueadoAte: null } : { tentativas: row.tentativas, bloqueadoAte: row.bloqueado_ate }
}

/** Chama ANTES de gastar trabalho numa tentativa (bcrypt.compare, gerar
 * código etc.) — recusa direto se a chave ainda estiver bloqueada. */
export async function checarBloqueio(db: D1Database, chave: string): Promise<StatusBloqueio> {
  const { bloqueadoAte } = await lerContador(db, chave)
  if (!bloqueadoAte) return { bloqueado: false, segundosRestantes: 0 }
  const restante = Math.ceil((new Date(bloqueadoAte).getTime() - Date.now()) / 1000)
  return restante > 0 ? { bloqueado: true, segundosRestantes: restante } : { bloqueado: false, segundosRestantes: 0 }
}

/** Chama depois de uma tentativa malsucedida (senha errada, nick
 * inexistente) ou de qualquer chamada a uma rota só de "disparo"
 * (solicitar-codigo, que não tem noção de certo/errado). Incrementa e,
 * a partir da tentativa nº 4, define um bloqueio com duração crescente. */
export async function registrarTentativa(db: D1Database, chave: string): Promise<StatusBloqueio> {
  const atual = await lerContador(db, chave)
  const tentativas = atual.tentativas + 1

  let bloqueadoAte: string | null = null
  let segundosRestantes = 0
  if (tentativas > LIMITE_ANTES_DE_BLOQUEAR) {
    const idx = Math.min(tentativas - LIMITE_ANTES_DE_BLOQUEAR - 1, ESCALA_BLOQUEIO_SEGUNDOS.length - 1)
    segundosRestantes = ESCALA_BLOQUEIO_SEGUNDOS[idx]
    bloqueadoAte = new Date(Date.now() + segundosRestantes * 1000).toISOString()
  }

  await db
    .prepare(
      `INSERT INTO tentativas_acesso (chave, tentativas, bloqueado_ate, atualizado_em)
       VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       ON CONFLICT(chave) DO UPDATE SET tentativas = excluded.tentativas, bloqueado_ate = excluded.bloqueado_ate, atualizado_em = excluded.atualizado_em`
    )
    .bind(chave, tentativas, bloqueadoAte)
    .run()

  return { bloqueado: bloqueadoAte !== null, segundosRestantes }
}

/** Chama depois de uma autenticação bem-sucedida — zera o contador
 * pra não penalizar tentativas legítimas futuras por erros antigos. */
export async function limparTentativas(db: D1Database, chave: string): Promise<void> {
  await db.prepare(`DELETE FROM tentativas_acesso WHERE chave = ?`).bind(chave).run()
}

/** Mensagem padrão de erro 429, com o tempo restante arredondado pra
 * cima em minutos (nunca "0 min" — no mínimo "1 min"). */
export function mensagemBloqueio(status: StatusBloqueio): string {
  const minutos = Math.max(1, Math.ceil(status.segundosRestantes / 60))
  return `muitas tentativas — tente de novo em ${minutos} min`
}
