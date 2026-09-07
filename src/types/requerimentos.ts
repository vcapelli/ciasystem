// Tipos compartilhados do módulo de Requerimentos.
// Espelham o CHECK de `requerimentos.tipo` no schema — mantenha os
// dois sincronizados manualmente (SQLite não exporta enums pro TS).

export type TipoRequerimento =
  | 'instrucao_inicial'
  | 'promocao'
  | 'rebaixamento'
  | 'advertencia'
  | 'licenca'
  | 'volta_licenca'
  | 'reserva'
  | 'transferencia_conta'
  | 'transferencia_corpo'
  | 'venda_cargo'
  | 'contratacao'
  | 'tag'
  | 'turno_tarefa'
  | 'reforma'
  | 'desligamento_honroso'
  | 'desligamento_desonroso'
  | 'exoneracao'
  | 'bonificacao'
  | 'cancelamento'

export type StatusRequerimento = 'pendente' | 'aprovado' | 'reprovado' | 'cancelado'

/**
 * Um alvo é `number` (usuario_id de alguém que já existe no sistema)
 * OU `string` (nick de alguém que ainda não tem conta — só possível
 * pras 3 portas de entrada: instrucao_inicial, contratacao, e
 * venda_cargo quando é um ingresso novo no Corpo Executivo).
 */
export type AlvoRequerimento = number | string

export interface CriarRequerimentoInput {
  tipo: TipoRequerimento
  alvos: AlvoRequerimento[]
  dados_especificos?: Record<string, unknown>
  crime_id?: number
  fundamentacao?: string
  autorizado_por_id?: number
  tag_aplicada?: string
  anexos?: string[]             // URLs de prova/imagem
}
