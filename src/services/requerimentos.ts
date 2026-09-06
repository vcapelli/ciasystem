// Regras de negócio do módulo de Requerimentos, separadas da camada
// de rotas (src/routes/requerimentos.ts só deve orquestrar chamadas
// pra cá, sem lógica de domínio misturada).

/**
 * Gera a TAG interna do requerimento (não confundir com a TAG pessoal
 * do policial). Formato provisório: prefixo do tipo + timestamp curto
 * + sufixo aleatório, só pra garantir unicidade sem round-trip ao
 * banco antes do INSERT.
 */
export function gerarTagRequerimento(tipo: string): string {
  const prefixo = tipo.slice(0, 3).toUpperCase()
  const timestamp = Date.now().toString(36).toUpperCase()
  const sufixo = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `${prefixo}-${timestamp}-${sufixo}`
}

export type AcaoGestaoRequerimento = 'aprovar' | 'cancelar'

/**
 * Verifica se `usuarioId` pode aprovar/reprovar (ação 'aprovar') ou
 * cancelar (ação 'cancelar') requerimentos do `tipo` informado,
 * consultando `requerimentos_permissoes`.
 *
 * A concessão pode ter vindo por usuário direto OU por grupo — nesse
 * segundo caso é sempre resolvida dinamicamente via `usuario_grupos`
 * (ativo = 1), nunca cacheada: se a pessoa saiu do grupo, perde o
 * poder na hora. `rp.tipo IS NULL` = a concessão vale pra todos os
 * tipos de requerimento.
 *
 * `administrador_sistema` faz bypass total — checar isso ANTES de
 * chamar esta função (evita uma query desnecessária pra quem já tem
 * acesso total).
 */
export async function podeGerirRequerimento(
  db: D1Database,
  usuarioId: number,
  tipo: string,
  acao: AcaoGestaoRequerimento
): Promise<boolean> {
  const coluna = acao === 'aprovar' ? 'pode_aprovar' : 'pode_cancelar'

  const row = await db
    .prepare(
      `SELECT 1
       FROM requerimentos_permissoes rp
       LEFT JOIN usuario_grupos ug
         ON ug.grupo_id = rp.grupo_id AND ug.usuario_id = ? AND ug.ativo = 1
       WHERE (rp.usuario_id = ? OR ug.usuario_id IS NOT NULL)
         AND (rp.tipo IS NULL OR rp.tipo = ?)
         AND rp.${coluna} = 1
       LIMIT 1`
    )
    .bind(usuarioId, usuarioId, tipo)
    .first()

  return row !== null
}

/** Mapeia o tipo de requerimento pra ação de hierarquia correspondente
 * (usada em conjunto com services/hierarquia.ts::podeAgirSobre).
 * `null` = tipo não representa uma ação de hierarquia sobre outro
 * usuário (ex: instrucao_inicial, tag, turno_tarefa não têm "alvo
 * hierárquico" no sentido de promover/rebaixar/etc).
 */
export function acaoHierarquiaDoTipo(
  tipo: string
): 'promover' | 'rebaixar' | 'advertir' | 'demitir' | 'exonerar' | 'licenciar' | null {
  switch (tipo) {
    case 'promocao':
      return 'promover'
    case 'rebaixamento':
      return 'rebaixar'
    case 'advertencia':
      return 'advertir'
    case 'desligamento_honroso':
    case 'desligamento_desonroso':
      return 'demitir'
    case 'exoneracao':
      return 'exonerar'
    case 'licenca':
    case 'volta_licenca':
    case 'reserva':
      return 'licenciar'
    default:
      return null
  }
}
