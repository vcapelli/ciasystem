// Aplica o efeito real de um requerimento aprovado sobre o usuário
// alvo, e recalcula o status geral do requerimento a partir do
// status de cada alvo.
//
// Duas formas de identificar o alvo:
//   - `{ usuarioId }` — alvo já existe em `usuarios` (todos os tipos
//     "de progressão": promocao, rebaixamento, licenca etc.)
//   - `{ nickAlvo }` — alvo AINDA NÃO existe (só as 3 portas de
//     entrada: instrucao_inicial, contratacao, e venda_cargo quando
//     é ingresso novo no Corpo Executivo). Nesses casos, esta função
//     CRIA a linha em `usuarios` e devolve o `usuarioId` gerado, pra
//     a rota fazer o backfill de `requerimento_alvos.usuario_id`.

export type IdentificadorAlvo = { usuarioId: number } | { nickAlvo: string }

export interface EfeitoAplicado {
  usuarioId: number
  antes: unknown
  depois: unknown
}

const AGORA = `strftime('%Y-%m-%dT%H:%M:%SZ','now')`

async function buscarPatente(db: D1Database, patenteId: unknown): Promise<{ id: number; corpo: string }> {
  if (!patenteId) throw new Error('dados_especificos.patente_destino_id é obrigatório')
  const patente = await db
    .prepare(`SELECT id, corpo FROM patentes WHERE id = ?`)
    .bind(patenteId)
    .first<{ id: number; corpo: string }>()
  if (!patente) throw new Error('patente_destino_id inválida')
  return patente
}

/**
 * Cria a linha em `usuarios` pra uma das 3 portas de entrada.
 * `tag` é opcional em `dados_especificos` (nem toda porta de entrada
 * atribui TAG na hora — pode vir depois via requerimento tipo 'tag').
 */
async function criarUsuarioDeEntrada(
  db: D1Database,
  nick: string,
  patenteId: number,
  corpo: string,
  tag?: string
): Promise<number> {
  const existente = await db.prepare(`SELECT id FROM usuarios WHERE nick = ?`).bind(nick).first<{ id: number }>()
  if (existente) throw new Error(`já existe uma conta com o nick '${nick}'`)

  const { meta } = await db
    .prepare(
      `INSERT INTO usuarios (nick, tag, corpo, patente_atual_id, data_ingresso, data_ultimo_ato_funcional)
       VALUES (?, ?, ?, ?, ${AGORA}, ${AGORA})`
    )
    .bind(nick, tag ?? null, corpo, patenteId)
    .run()

  return Number(meta.last_row_id)
}

export async function aplicarEfeitoAprovacao(
  db: D1Database,
  tipo: string,
  alvo: IdentificadorAlvo,
  dadosEspecificos: Record<string, unknown> | null
): Promise<EfeitoAplicado> {
  // --- Portas de entrada: o alvo pode ainda não existir ---
  if ('nickAlvo' in alvo) {
    if (tipo === 'instrucao_inicial') {
      const soldado = await db
        .prepare(`SELECT id FROM patentes WHERE corpo='militar' AND nome='Soldado'`)
        .first<{ id: number }>()
      if (!soldado) throw new Error('patente Soldado não encontrada — a Fase 1 foi aplicada?')
      const usuarioId = await criarUsuarioDeEntrada(db, alvo.nickAlvo, soldado.id, 'militar')
      const depois = await db.prepare(`SELECT patente_atual_id, corpo, status, tag, nick FROM usuarios WHERE id = ?`).bind(usuarioId).first()
      return { usuarioId, antes: null, depois }
    }

    if (tipo === 'contratacao' || tipo === 'venda_cargo') {
      const patente = await buscarPatente(db, dadosEspecificos?.patente_destino_id)
      const tag = dadosEspecificos?.tag as string | undefined
      const usuarioId = await criarUsuarioDeEntrada(db, alvo.nickAlvo, patente.id, patente.corpo, tag)
      const depois = await db.prepare(`SELECT patente_atual_id, corpo, status, tag, nick FROM usuarios WHERE id = ?`).bind(usuarioId).first()
      return { usuarioId, antes: null, depois }
    }

    throw new Error(`tipo '${tipo}' não suporta alvo por nick (usuário precisa já existir)`)
  }

  // --- Alvo já existe: os demais tipos, todos "de progressão" ---
  const usuarioId = alvo.usuarioId
  const antes = await db
    .prepare(`SELECT patente_atual_id, corpo, status, tag, nick FROM usuarios WHERE id = ?`)
    .bind(usuarioId)
    .first()

  switch (tipo) {
    case 'promocao':
    case 'rebaixamento':
    case 'contratacao':
    case 'venda_cargo':
    case 'transferencia_corpo': {
      const patenteDestino = await buscarPatente(db, dadosEspecificos?.patente_destino_id)
      await db
        .prepare(
          `UPDATE usuarios
           SET patente_atual_id = ?, corpo = ?, data_ultimo_ato_funcional = ${AGORA}, atualizado_em = ${AGORA}
           WHERE id = ?`
        )
        .bind(patenteDestino.id, patenteDestino.corpo, usuarioId)
        .run()
      break
    }

    case 'licenca':
    case 'reserva':
      // NOTA: `usuarios.status` não tem valor próprio pra 'reserva' —
      // usando 'licenca' pros dois por enquanto.
      await db
        .prepare(`UPDATE usuarios SET status = 'licenca', atualizado_em = ${AGORA} WHERE id = ?`)
        .bind(usuarioId)
        .run()
      break

    case 'volta_licenca':
      await db
        .prepare(`UPDATE usuarios SET status = 'ativo', atualizado_em = ${AGORA} WHERE id = ?`)
        .bind(usuarioId)
        .run()
      break

    case 'desligamento_honroso':
    case 'reforma': {
      // "Volta a civil": sai de todos os grupos e perde a TAG (some das
      // listagens), mas mantém patente/corpo como registro histórico —
      // o schema não permite jogador sem patente/corpo. O histórico de
      // requerimentos nunca é tocado aqui, continua todo visível.
      const gruposAtivos = await db
        .prepare(`SELECT grupo_id FROM usuario_grupos WHERE usuario_id = ? AND ativo = 1`)
        .bind(usuarioId)
        .all<{ grupo_id: number }>()

      await db.prepare(`UPDATE usuario_grupos SET ativo = 0 WHERE usuario_id = ?`).bind(usuarioId).run()
      await db
        .prepare(`UPDATE usuarios SET status = ?, tag = NULL, atualizado_em = ${AGORA} WHERE id = ?`)
        .bind(tipo === 'reforma' ? 'reformado' : 'desligado_honroso', usuarioId)
        .run()

      // Grava quais grupos ficaram inativos, junto do snapshot "antes"
      // — sem isso, cancelar depois não saberia quais grupos devolver.
      ;(antes as Record<string, unknown>).grupos_ativos = gruposAtivos.results.map((g) => g.grupo_id)
      break
    }

    case 'desligamento_desonroso':
      await db
        .prepare(`UPDATE usuarios SET status = 'desligado_desonroso', atualizado_em = ${AGORA} WHERE id = ?`)
        .bind(usuarioId)
        .run()
      break

    case 'exoneracao': {
      const exoneracaoAte = (dadosEspecificos?.exoneracao_ate as string | undefined) ?? null
      await db
        .prepare(
          `UPDATE usuarios SET status = 'exonerado', exoneracao_ate = ?, atualizado_em = ${AGORA} WHERE id = ?`
        )
        .bind(exoneracaoAte, usuarioId)
        .run()
      break
    }

    case 'tag': {
      const novaTag = dadosEspecificos?.tag as string | undefined
      if (!novaTag) throw new Error(`dados_especificos.tag é obrigatório para o tipo 'tag'`)
      await db
        .prepare(`UPDATE usuarios SET tag = ?, atualizado_em = ${AGORA} WHERE id = ?`)
        .bind(novaTag, usuarioId)
        .run()
      break
    }

    case 'transferencia_conta': {
      const novoNick = dadosEspecificos?.novo_nick as string | undefined
      if (!novoNick) throw new Error(`dados_especificos.novo_nick é obrigatório para transferência de conta`)

      // Congela o nick atual em todo requerimento já existente desse
      // usuário (que hoje é exibido via join ao vivo com `usuarios`) —
      // sem isso, trocar o nick mudaria retroativamente o nome exibido
      // em requerimentos antigos.
      await db
        .prepare(`UPDATE requerimento_alvos SET nick_alvo = (SELECT nick FROM usuarios WHERE id = ?) WHERE usuario_id = ? AND nick_alvo IS NULL`)
        .bind(usuarioId, usuarioId)
        .run()

      await db.prepare(`UPDATE usuarios SET nick = ?, atualizado_em = ${AGORA} WHERE id = ?`).bind(novoNick, usuarioId).run()
      break
    }

    default:
      // turno_tarefa / bonificacao / advertencia / cancelamento:
      // dependem de módulos ainda não implementados ou de lógica
      // própria mais complexa. Sem efeito sobre `usuarios` por
      // enquanto — o requerimento ainda é aprovado e vira `historico`.
      break
  }

  const depois = await db
    .prepare(`SELECT patente_atual_id, corpo, status, tag, nick FROM usuarios WHERE id = ?`)
    .bind(usuarioId)
    .first()

  return { usuarioId, antes, depois }
}

/**
 * Recalcula `requerimentos.status` a partir do status de cada
 * `requerimento_alvos`. Regra assumida (confirmar com Vitor):
 *   - qualquer alvo ainda 'pendente' → requerimento continua 'pendente'
 *   - todos 'cancelado' → requerimento vira 'cancelado'
 *   - ao menos 1 'aprovado' → requerimento vira 'aprovado'
 *   - senão → 'reprovado'
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
