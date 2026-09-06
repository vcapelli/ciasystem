// Aplica o efeito real de um requerimento aprovado sobre o usuário
// alvo (mudar patente, status, TAG etc.), e recalcula o status geral
// do requerimento a partir do status de cada alvo.
//
// Cobertura atual: promocao, rebaixamento, contratacao, venda_cargo,
// transferencia_corpo (todos mudam patente_atual_id + corpo),
// licenca, reserva, volta_licenca, desligamento_honroso,
// desligamento_desonroso, exoneracao (mudam status), tag (muda a TAG
// pessoal).
//
// Fora de escopo por enquanto (ver comentário no `default` do switch):
// instrucao_inicial, turno_tarefa, bonificacao, transferencia_conta,
// advertencia, cancelamento.

export interface EfeitoAplicado {
  antes: unknown
  depois: unknown
}

export async function aplicarEfeitoAprovacao(
  db: D1Database,
  tipo: string,
  usuarioId: number,
  dadosEspecificos: Record<string, unknown> | null
): Promise<EfeitoAplicado> {
  const antes = await db
    .prepare(`SELECT patente_atual_id, corpo, status, tag FROM usuarios WHERE id = ?`)
    .bind(usuarioId)
    .first()

  const agora = `strftime('%Y-%m-%dT%H:%M:%SZ','now')`

  switch (tipo) {
    case 'promocao':
    case 'rebaixamento':
    case 'contratacao':
    case 'venda_cargo':
    case 'transferencia_corpo': {
      const destino = dadosEspecificos?.patente_destino_id
      if (!destino) {
        throw new Error(`dados_especificos.patente_destino_id é obrigatório para o tipo '${tipo}'`)
      }
      const patenteDestino = await db
        .prepare(`SELECT id, corpo FROM patentes WHERE id = ?`)
        .bind(destino)
        .first<{ id: number; corpo: string }>()
      if (!patenteDestino) throw new Error('patente_destino_id inválida')

      await db
        .prepare(
          `UPDATE usuarios
           SET patente_atual_id = ?, corpo = ?, data_ultimo_ato_funcional = ${agora}, atualizado_em = ${agora}
           WHERE id = ?`
        )
        .bind(patenteDestino.id, patenteDestino.corpo, usuarioId)
        .run()
      break
    }

    case 'licenca':
    case 'reserva':
      // NOTA: `usuarios.status` não tem valor próprio pra 'reserva' —
      // usando 'licenca' pros dois por enquanto. Confirmar com Vitor
      // se reserva precisa de status distinto.
      await db
        .prepare(`UPDATE usuarios SET status = 'licenca', atualizado_em = ${agora} WHERE id = ?`)
        .bind(usuarioId)
        .run()
      break

    case 'volta_licenca':
      await db
        .prepare(`UPDATE usuarios SET status = 'ativo', atualizado_em = ${agora} WHERE id = ?`)
        .bind(usuarioId)
        .run()
      break

    case 'desligamento_honroso':
      await db
        .prepare(`UPDATE usuarios SET status = 'desligado_honroso', atualizado_em = ${agora} WHERE id = ?`)
        .bind(usuarioId)
        .run()
      break

    case 'desligamento_desonroso':
      await db
        .prepare(`UPDATE usuarios SET status = 'desligado_desonroso', atualizado_em = ${agora} WHERE id = ?`)
        .bind(usuarioId)
        .run()
      break

    case 'exoneracao': {
      const exoneracaoAte = (dadosEspecificos?.exoneracao_ate as string | undefined) ?? null
      await db
        .prepare(
          `UPDATE usuarios SET status = 'exonerado', exoneracao_ate = ?, atualizado_em = ${agora} WHERE id = ?`
        )
        .bind(exoneracaoAte, usuarioId)
        .run()
      break
    }

    case 'tag': {
      const novaTag = dadosEspecificos?.tag as string | undefined
      if (!novaTag) throw new Error(`dados_especificos.tag é obrigatório para o tipo 'tag'`)
      await db
        .prepare(`UPDATE usuarios SET tag = ?, atualizado_em = ${agora} WHERE id = ?`)
        .bind(novaTag, usuarioId)
        .run()
      break
    }

    default:
      // instrucao_inicial: exige repensar o CHECK de `usuarios`, que
      // hoje obriga corpo/patente desde a criação — não dá pra
      // "nascer sem patente" e só ganhar uma na aprovação, do jeito
      // que o schema está hoje.
      // turno_tarefa / bonificacao / transferencia_conta / advertencia
      // / cancelamento: dependem de módulos ainda não implementados
      // (medalhas, grupos avançados, punições) ou de lógica própria
      // mais complexa (cancelamento reverte uma ação anterior, não
      // aplica uma nova). Sem efeito sobre `usuarios` por enquanto —
      // o requerimento ainda assim é aprovado e vira `historico`.
      break
  }

  const depois = await db
    .prepare(`SELECT patente_atual_id, corpo, status, tag FROM usuarios WHERE id = ?`)
    .bind(usuarioId)
    .first()

  return { antes, depois }
}

/**
 * Recalcula `requerimentos.status` a partir do status de cada
 * `requerimento_alvos`. Regra assumida (confirmar com Vitor se bate
 * com o comportamento esperado no painel):
 *   - qualquer alvo ainda 'pendente' → requerimento continua 'pendente'
 *   - todos 'cancelado' → requerimento vira 'cancelado'
 *   - ao menos 1 'aprovado' (mesmo com outros 'reprovado' no meio) →
 *     requerimento vira 'aprovado'
 *   - só então, se nenhum foi aprovado → 'reprovado'
 */
export async function recalcularStatusRequerimento(db: D1Database, requerimentoId: number): Promise<string> {
  const { results } = await db
    .prepare(`SELECT status FROM requerimento_alvos WHERE requerimento_id = ?`)
    .bind(requerimentoId)
    .all<{ status: string }>()

  const statuses = results.map((r) => r.status)

  let novoStatus: string
  if (statuses.some((s) => s === 'pendente')) {
    novoStatus = 'pendente'
  } else if (statuses.every((s) => s === 'cancelado')) {
    novoStatus = 'cancelado'
  } else if (statuses.some((s) => s === 'aprovado')) {
    novoStatus = 'aprovado'
  } else {
    novoStatus = 'reprovado'
  }

  await db
    .prepare(
      `UPDATE requerimentos SET status = ?, decidido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
    )
    .bind(novoStatus, requerimentoId)
    .run()

  return novoStatus
}
