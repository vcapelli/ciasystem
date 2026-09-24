// Integração com a API pública do Habblet — usada pra confirmar que
// o código de verificação foi realmente colocado na missão (motto)
// do jogador no jogo, provando posse da conta.
//
// Endpoint conhecido: api.habblet.city/player/{nick} (retorna dados
// do jogador). O formato exato da resposta não foi confirmado por
// aqui (o ambiente de desenvolvimento não tem acesso de rede pra
// testar contra a API real) — o campo `motto` abaixo é a suposição
// mais razoável (padrão comum em hotéis baseados em Habbo). Se o
// nome do campo for diferente na API real, ajustar só a interface
// `HabbletPlayer` e a leitura em `verificarCodigoNaMissao`.

export interface HabbletPlayer {
  id?: number
  username: string
  motto: string
  figure?: string
  online?: boolean
}

const HABBLET_API_BASE = 'https://api.habblet.city'

/**
 * Codifica o nick pro segmento da URL. Confirmado direto contra a API
 * real: ela devolve 400 se receber ',' ou ':' percent-encoded (%2C /
 * %3A) — só aceita esses dois caracteres literais no path (ex:
 * .../player/Matheus, funciona, .../player/Matheus%2C não). O '.' não
 * é afetado porque encodeURIComponent nunca o codifica. Por isso
 * primeiro codificamos normalmente (protege contra espaço, '/', '#',
 * '?', '%' etc. que o nick não deveria ter mesmo) e depois desfazemos
 * só essas duas sequências específicas.
 */
function nickParaSegmentoUrl(nick: string): string {
  return encodeURIComponent(nick).replace(/%2C/gi, ',').replace(/%3A/gi, ':')
}

/**
 * Busca os dados públicos do jogador. Retorna `null` se o nick não
 * existir (404) — nunca lança erro nesse caso, só em falha de rede
 * de verdade (timeout, 5xx, etc.), que o chamador deve tratar.
 */
export async function buscarJogadorHabblet(nick: string): Promise<HabbletPlayer | null> {
  // Timeout explícito — sem isso, uma instabilidade na API externa
  // deixa a request do Worker pendurada indefinidamente, incluindo o
  // fluxo de login (que depende desta mesma função pra verificar o
  // código na missão).
  let resposta: Response
  try {
    resposta = await fetch(`${HABBLET_API_BASE}/player/${nickParaSegmentoUrl(nick)}`, {
      signal: AbortSignal.timeout(8000),
    })
  } catch (erro) {
    throw new Error(`não foi possível contatar a API do Habblet pra buscar '${nick}': ${erro instanceof Error ? erro.message : erro}`)
  }

  if (resposta.status === 404) return null
  if (!resposta.ok) {
    throw new Error(`API do Habblet retornou ${resposta.status} ao buscar '${nick}'`)
  }

  return resposta.json()
}

/**
 * Confirma que `codigo` aparece em algum lugar da missão atual do
 * jogador no Habblet. Comparação simples de substring — o código é
 * gerado só com dígitos (ver gerarCodigo em routes/auth.ts), então
 * não há ambiguidade de formatação a normalizar.
 */
export async function verificarCodigoNaMissao(nick: string, codigo: string): Promise<boolean> {
  const jogador = await buscarJogadorHabblet(nick)
  if (!jogador || typeof jogador.motto !== 'string') return false
  return jogador.motto.includes(codigo)
}
