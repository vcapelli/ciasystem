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

export interface CriarRequerimentoInput {
  tipo: TipoRequerimento
  autor_id: number
  alvos: number[]              // um ou mais usuario_id — vira 1 linha por alvo em requerimento_alvos
  dados_especificos?: Record<string, unknown>
  crime_id?: number
  fundamentacao?: string
  autorizado_por_id?: number
  tag_aplicada?: string
  anexos?: string[]             // URLs de prova/imagem
}
