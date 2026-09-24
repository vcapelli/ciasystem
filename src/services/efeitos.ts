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
 * Normaliza a data histórica informada num requerimento de
 * 'integracao' (`dados_especificos.data`) pro mesmo formato ISO usado
 * em todo o resto do schema. O formulário manda só a data (input
 * type="date", ex: '2024-03-15') — completa com T12:00:00Z (meio-dia
 * UTC, não meia-noite): meia-noite UTC já é o dia anterior em qualquer
 * fuso negativo (ex: 2026-09-04T00:00:00Z vira 2026-09-03 21:00 em
 * UTC-3), fazendo o dia exibido "andar pra trás" um dia. Meio-dia UTC
 * nunca cruza a virada do dia em nenhum fuso horário real (-12 a +14).
 * Se já vier um timestamp completo (ex: chamada direta na API), usa
 * como está. `undefined`/vazio → `null` (cai no fallback pra AGORA em
 * quem chama).
 */
export function normalizarDataIntegracao(data: string | undefined | null): string | null {
  if (!data) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(data) ? `${data}T12:00:00Z` : data
}

/**
 * Cria a linha em `usuarios` pra uma das portas de entrada (instrução
 * inicial, contratação, venda de cargo, ou integração — migração de
 * alguém que já estava na organização antes do CIASystem existir).
 * `tag` é opcional em `dados_especificos` (nem toda porta de entrada
 * atribui TAG na hora — pode vir depois via requerimento tipo 'tag').
 * `dataCustomizada` é só pra 'integracao': define `data_ingresso` e
 * `data_ultimo_ato_funcional` com a data real de ingresso na
 * organização (fluxo antigo), em vez de "agora" — sem isso, migrar
 * alguém resetaria o tempo de serviço já cumprido e travaria a próxima
 * promoção, que depende de dias corridos desde o último ato funcional
 * (seção 6 do doc-mestre). `null`/omitido → comportamento de sempre
 * (AGORA), igual às outras portas de entrada.
 */
async function criarUsuarioDeEntrada(
  db: D1Database,
  nick: string,
  patenteId: number,
  corpo: string,
  tag?: string,
  dataCustomizada?: string | null
): Promise<number> {
  const existente = await db.prepare(`SELECT id FROM usuarios WHERE nick = ?`).bind(nick).first<{ id: number }>()
  if (existente) throw new Error(`já existe uma conta com o nick '${nick}'`)

  // `usuarios.tag` é UNIQUE no schema — sem essa checagem, tentar usar
  // uma TAG já ocupada (fácil de acontecer, são só 2-3 caracteres)
  // derruba o INSERT com um erro cru de constraint do SQLite em vez de
  // uma mensagem que dá pra entender e corrigir.
  if (tag) {
    const tagEmUso = await db.prepare(`SELECT id, nick FROM usuarios WHERE tag = ?`).bind(tag).first<{ id: number; nick: string }>()
    if (tagEmUso) throw new Error(`a TAG '${tag}' já está em uso por '${tagEmUso.nick}'`)
  }

  const { meta } = await db
    .prepare(
      `INSERT INTO usuarios (nick, tag, corpo, patente_atual_id, data_ingresso, data_ultimo_ato_funcional)
       VALUES (?, ?, ?, ?, COALESCE(?, ${AGORA}), COALESCE(?, ${AGORA}))`
    )
    .bind(nick, tag ?? null, corpo, patenteId, dataCustomizada ?? null, dataCustomizada ?? null)
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
      const depois = await db.prepare(`SELECT patente_atual_id, corpo, status, tag, nick, exoneracao_ate FROM usuarios WHERE id = ?`).bind(usuarioId).first()
      return { usuarioId, antes: null, depois }
    }

    if (tipo === 'integracao') {
      // Integração é usada especificamente pra migrar quem já está na
      // organização — é comum a conta já existir (ex: uma tentativa
      // anterior que criou o usuário mas falhou num passo seguinte, ou
      // o admin só quer corrigir/completar uma migração já feita). Em
      // vez de derrubar com "já existe uma conta com o nick X", trata
      // como uma atualização da conta existente: reaproveita o branch
      // "alvo já existe" abaixo (mesmo efeito de patente/TAG/data), que
      // também grava o snapshot "antes" de verdade (em vez de `null`),
      // então cancelar essa integração depois volta a conta pro estado
      // anterior de verdade em vez de tentar apagá-la.
      const existente = await db.prepare(`SELECT id FROM usuarios WHERE nick = ?`).bind(alvo.nickAlvo).first<{ id: number }>()
      if (existente) return aplicarEfeitoAprovacao(db, tipo, { usuarioId: existente.id }, dadosEspecificos)
    }

    if (tipo === 'contratacao' || tipo === 'venda_cargo' || tipo === 'integracao') {
      const patente = await buscarPatente(db, dadosEspecificos?.patente_destino_id)
      const tag = dadosEspecificos?.tag as string | undefined
      const dataCustomizada = tipo === 'integracao'
        ? normalizarDataIntegracao(dadosEspecificos?.data as string | undefined)
        : null
      const usuarioId = await criarUsuarioDeEntrada(db, alvo.nickAlvo, patente.id, patente.corpo, tag, dataCustomizada)
      const depois = await db.prepare(`SELECT patente_atual_id, corpo, status, tag, nick, exoneracao_ate FROM usuarios WHERE id = ?`).bind(usuarioId).first()
      return { usuarioId, antes: null, depois }
    }

    if (tipo === 'exoneracao') {
      // Alvo nunca foi membro — cria com uma patente-base (Soldado) só
      // pra existir no schema (jogador sempre precisa de patente/corpo)
      // e já aplica a exoneração em seguida.
      const soldado = await db
        .prepare(`SELECT id FROM patentes WHERE corpo='militar' AND nome='Soldado'`)
        .first<{ id: number }>()
      if (!soldado) throw new Error('patente Soldado não encontrada — a Fase 1 foi aplicada?')
      const usuarioId = await criarUsuarioDeEntrada(db, alvo.nickAlvo, soldado.id, 'militar')
      const exoneracaoAte = (dadosEspecificos?.exoneracao_ate as string | undefined) ?? null
      await db.prepare(`UPDATE usuarios SET status = 'exonerado', exoneracao_ate = ?, atualizado_em = ${AGORA} WHERE id = ?`)
        .bind(exoneracaoAte, usuarioId).run()
      const depois = await db.prepare(`SELECT patente_atual_id, corpo, status, tag, nick, exoneracao_ate FROM usuarios WHERE id = ?`).bind(usuarioId).first()
      return { usuarioId, antes: null, depois }
    }

    throw new Error(`tipo '${tipo}' não suporta alvo por nick (usuário precisa já existir)`)
  }

  // --- Alvo já existe: os demais tipos, todos "de progressão" ---
  const usuarioId = alvo.usuarioId
  const antes = await db
    .prepare(`SELECT patente_atual_id, corpo, status, tag, nick, exoneracao_ate FROM usuarios WHERE id = ?`)
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

    // Integração usada num usuário que já existe no CIASystem (ex:
    // corrigir/completar uma migração feita antes de tempo) — mesma
    // ideia da porta de entrada acima: patente/cargo + TAG opcional +
    // a data histórica de `data_ultimo_ato_funcional`, sem forçar
    // AGORA quando uma data foi informada.
    case 'integracao': {
      const patenteDestino = await buscarPatente(db, dadosEspecificos?.patente_destino_id)
      const novaTag = (dadosEspecificos?.tag as string | undefined) ?? null
      if (novaTag) {
        if (!/^[A-Za-z0-9]{2,3}$/.test(novaTag)) {
          throw new Error(`TAG deve ter 2 ou 3 caracteres alfanuméricos`)
        }
        const tagEmUso = await db.prepare(`SELECT id, nick FROM usuarios WHERE tag = ? AND id != ?`)
          .bind(novaTag, usuarioId).first<{ id: number; nick: string }>()
        if (tagEmUso) throw new Error(`a TAG '${novaTag}' já está em uso por '${tagEmUso.nick}'`)
      }
      const dataCustomizada = normalizarDataIntegracao(dadosEspecificos?.data as string | undefined)
      await db
        .prepare(
          `UPDATE usuarios
           SET patente_atual_id = ?, corpo = ?,
               data_ultimo_ato_funcional = COALESCE(?, ${AGORA}),
               tag = COALESCE(?, tag),
               atualizado_em = ${AGORA}
           WHERE id = ?`
        )
        .bind(patenteDestino.id, patenteDestino.corpo, dataCustomizada, novaTag, usuarioId)
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
      if (!/^[A-Za-z0-9]{2,3}$/.test(novaTag)) {
        throw new Error(`TAG deve ter 2 ou 3 caracteres alfanuméricos`)
      }
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
    .prepare(`SELECT patente_atual_id, corpo, status, tag, nick, exoneracao_ate FROM usuarios WHERE id = ?`)
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

// Reverte o efeito aplicado a UM alvo, usando o snapshot "antes"
// gravado no histórico no momento da aprovação. Usado por cancelar e
// excluir — quando um admin desfaz um requerimento porque ele foi
// indevido, a pessoa volta a ser exatamente quem era antes.
//
// NÃO é mais usada pela expiração automática de exoneração temporária
// (ver `tornarCivilAposExoneracaoExpirada` abaixo) — vencer o prazo
// tem um efeito diferente de ser cancelado: não restaura o posto
// anterior, vira civil.
//
// IMPORTANTE: ao contrário de antes, uma falha aqui agora é
// PROPAGADA (throw) em vez de engolida em silêncio. Um `catch {}`
// mudo fazia o admin achar que cancelar/excluir tinha funcionado
// quando na real nada mudou (ex: usuário continuava com status
// 'exonerado' pra sempre) — muito pior que a operação falhar
// visivelmente. Quem chama decide o que fazer com o erro.
export async function reverterEfeitoAlvo(db: D1Database, requerimentoId: string | number, alvoId: number, usuarioId: number | null) {
  if (usuarioId === null) return
  const registroHistorico = await db.prepare(
    `SELECT detalhes FROM historico WHERE requerimento_id = ? AND requerimento_alvo_id = ?`
  ).bind(requerimentoId, alvoId).first<{ detalhes: string | null }>()
  if (!registroHistorico?.detalhes) return

  const { antes } = JSON.parse(registroHistorico.detalhes) as {
    antes: {
      patente_atual_id: number; corpo: string; status: string; tag: string | null; nick: string
      exoneracao_ate?: string | null; grupos_ativos?: number[]
    } | null
  }

  if (antes === null) {
    // Era uma porta de entrada (o usuário não existia antes deste
    // requerimento) — reverter significa desfazer a criação. Precisa
    // limpar TODAS as referências que apontam pra esse usuário
    // primeiro (nenhuma tem ON DELETE CASCADE), senão o DELETE falha.
    // `notificacoes` é a mais comum de esquecer: toda aprovação já
    // notifica o próprio alvo ("Seu requerimento foi aprovado"), então
    // um usuário recém-criado por porta de entrada SEMPRE tem pelo
    // menos uma linha lá — sem limpar isso, o DELETE final falhava
    // (FK), o erro era engolido pelo catch antigo, e o usuário (com
    // status 'exonerado' etc.) ficava travado pra sempre.
    await db.prepare(`DELETE FROM historico WHERE usuario_id = ?`).bind(usuarioId).run()
    await db.prepare(`DELETE FROM notificacoes WHERE usuario_id = ?`).bind(usuarioId).run()
    await db.prepare(`UPDATE requerimento_alvos SET usuario_id = NULL WHERE usuario_id = ?`).bind(usuarioId).run()
    await db.prepare(`UPDATE requerimento_alvos SET decidido_por_id = NULL WHERE decidido_por_id = ?`).bind(usuarioId).run()
    await db.prepare(`DELETE FROM usuarios WHERE id = ?`).bind(usuarioId).run()
  } else {
    await db.prepare(
      `UPDATE usuarios SET patente_atual_id = ?, corpo = ?, status = ?, tag = ?, nick = ?, exoneracao_ate = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
    ).bind(antes.patente_atual_id, antes.corpo, antes.status, antes.tag, antes.nick, antes.exoneracao_ate ?? null, usuarioId).run()

    if (Array.isArray(antes.grupos_ativos)) {
      for (const grupoId of antes.grupos_ativos) {
        await db.prepare(`UPDATE usuario_grupos SET ativo = 1 WHERE usuario_id = ? AND grupo_id = ?`)
          .bind(usuarioId, grupoId).run()
      }
    }
  }
}

// Quando o prazo de uma exoneração TEMPORÁRIA vence (cron diário em
// index.ts), a pessoa não recupera automaticamente o posto/TAG/grupos
// que tinha antes — ela vira civil, mesmo efeito de um Desligamento
// Honroso (sai de todos os grupos, perde a TAG, mantém patente/corpo
// como registro histórico) e precisaria reingressar normalmente se
// quiser voltar à organização. Decisão confirmada com Vitor em
// 22/09/2026 — diferente de CANCELAR uma exoneração (que corrige um
// erro/injustiça e por isso usa `reverterEfeitoAlvo`, restaurando o
// posto anterior de verdade).
export async function tornarCivilAposExoneracaoExpirada(db: D1Database, usuarioId: number): Promise<void> {
  await db.prepare(`UPDATE usuario_grupos SET ativo = 0 WHERE usuario_id = ?`).bind(usuarioId).run()
  await db
    .prepare(
      `UPDATE usuarios SET status = 'desligado_honroso', tag = NULL, exoneracao_ate = NULL, atualizado_em = ${AGORA} WHERE id = ?`
    )
    .bind(usuarioId)
    .run()
}
