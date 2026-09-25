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

import { ehContaProtegida, NICK_CONTA_PROTEGIDA } from './protecao-conta'
import { revogarTodasSessoes } from './auth'

export type IdentificadorAlvo = { usuarioId: number } | { nickAlvo: string }

export interface EfeitoAplicado {
  usuarioId: number
  antes: unknown
  depois: unknown
}

// Quem decidiu (aprovou) o alvo, e a referência de volta pro
// requerimento/alvo — só usado hoje pelo subtipo Medalha de
// 'bonificacao' (ver concederMedalha), pra gravar medalhas.concedida_por_id
// e ligar a medalha ao requerimento (permite desfazer ao
// cancelar/excluir). Os demais tipos ignoram esse parâmetro.
export interface ContextoDecisao {
  decididoPorId: number
  requerimentoId: number | string
  requerimentoAlvoId: number
}

const TIPOS_MEDALHA = ['temporaria', 'efetiva', 'honraria_particular', 'honra']

/**
 * Concede a medalha em si (INSERT em `medalhas`) — usada pelo subtipo
 * 'medalha' de um requerimento de bonificacao aprovado, tanto quando o
 * alvo já existia quanto quando acabou de ser criado (porta de
 * entrada). `dadosEspecificos.motivo` vem de `requerimentos.fundamentacao`
 * (injetado pela rota antes de chamar aplicarEfeitoAprovacao — ver
 * routes/requerimentos.ts) — reaproveita o mesmo campo "Motivo /
 * fundamentação" que o formulário já coleta, sem duplicar UI.
 */
async function concederMedalha(
  db: D1Database,
  usuarioId: number,
  dadosEspecificos: Record<string, unknown> | null,
  contexto?: ContextoDecisao
): Promise<void> {
  const medalhaTipo = dadosEspecificos?.medalha_tipo as string | undefined
  if (!medalhaTipo || !TIPOS_MEDALHA.includes(medalhaTipo)) {
    throw new Error(`dados_especificos.medalha_tipo é obrigatório e deve ser um de: ${TIPOS_MEDALHA.join(', ')}`)
  }
  const motivo = (dadosEspecificos?.motivo as string | undefined)?.trim()
  if (!motivo) throw new Error(`motivo/fundamentação é obrigatório pra conceder uma medalha`)
  if (!contexto) throw new Error(`contexto (decididoPorId/requerimentoId/requerimentoAlvoId) é obrigatório pra conceder medalha via requerimento`)

  const expiraEm = medalhaTipo === 'temporaria' ? (dadosEspecificos?.medalha_expira_em as string | undefined) ?? null : null

  await db
    .prepare(
      `INSERT INTO medalhas (usuario_id, tipo, motivo, concedida_por_id, expira_em, requerimento_id, requerimento_alvo_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(usuarioId, medalhaTipo, motivo, contexto.decididoPorId, expiraEm, contexto.requerimentoId, contexto.requerimentoAlvoId)
    .run()
}

const AGORA = `strftime('%Y-%m-%dT%H:%M:%SZ','now')`

// Tipos de requerimento que mexem no nick (transferência de conta) ou
// no status (licença/volta, desligamento, reforma, exoneração) do
// alvo — os dois campos protegidos na conta do dono do sistema (ver
// ehContaProtegida). Promoção/rebaixamento/transferência de corpo NÃO
// entram aqui de propósito: só mexem em patente/cargo, que continuam
// liberados.
const TIPOS_QUE_ALTERAM_NICK_OU_STATUS = new Set([
  'transferencia_conta', 'licenca', 'volta_licenca',
  'desligamento_honroso', 'reforma', 'desligamento_desonroso', 'exoneracao', 'convidado',
])

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
 * `dataIngresso`/`dataUltimoAto` são só pra 'integracao': duas datas
 * históricas independentes — quando a pessoa realmente entrou na
 * organização (`data_ingresso`) e a data do último ato funcional dela
 * no sistema antigo (`data_ultimo_ato_funcional`, base pra contar dias
 * mínimos de promoção — seção 6 do doc-mestre). Se só uma delas for
 * informada, a outra cai pro mesmo valor (fallback simétrico —
 * comportamento de antes, quando só existia uma data pros dois campos,
 * preservado pra quando o admin só tem uma das duas na hora de migrar
 * alguém antigo). `null`/omitido nos dois → comportamento de sempre
 * (AGORA), igual às outras portas de entrada.
 */
async function criarUsuarioDeEntrada(
  db: D1Database,
  nick: string,
  patenteId: number,
  corpo: string,
  tag?: string,
  dataIngresso?: string | null,
  dataUltimoAto?: string | null
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

  // Fallback simétrico: se só uma das duas datas foi informada, usa o
  // mesmo valor pra outra (é melhor que "agora" quando o admin só tem
  // uma referência histórica confiável na hora de migrar alguém).
  const dataIngressoFinal = dataIngresso ?? dataUltimoAto ?? null
  const dataUltimoAtoFinal = dataUltimoAto ?? dataIngresso ?? null

  const { meta } = await db
    .prepare(
      `INSERT INTO usuarios (nick, tag, corpo, patente_atual_id, data_ingresso, data_ultimo_ato_funcional)
       VALUES (?, ?, ?, ?, COALESCE(?, ${AGORA}), COALESCE(?, ${AGORA}))`
    )
    .bind(nick, tag ?? null, corpo, patenteId, dataIngressoFinal, dataUltimoAtoFinal)
    .run()

  return Number(meta.last_row_id)
}

export async function aplicarEfeitoAprovacao(
  db: D1Database,
  tipo: string,
  alvo: IdentificadorAlvo,
  dadosEspecificos: Record<string, unknown> | null,
  contexto?: ContextoDecisao
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

    if (tipo === 'convidado') {
      // Convidado: só a ação 'inclusao' cria conta nova por nick (a
      // 'exclusao' sempre mira um usuarioId já existente — vem do
      // branch "alvo já existe" logo abaixo). Conta sem patente/corpo,
      // eh_convidado = 1 marca pra listagem/telas saberem que não tem
      // "dias no posto"/"dias na polícia" (ver seção 14 do doc-mestre).
      //
      // tipo = 'conta_oficial' (não 'jogador'): a tabela usuarios tem um
      // CHECK de banco que exige corpo/patente_atual_id NOT NULL sempre
      // que tipo='jogador', e só permite ambos NULL quando
      // tipo='conta_oficial' — não é só uma regra de aplicação. Convidado
      // reaproveita esse branch permitido, distinguindo-se de uma conta
      // institucional de verdade só pelo eh_convidado=1 (ver
      // 0053_requerimento_convidado.sql e usuarios.ts, que já filtram
      // eh_convidado nos lugares que assumem conta_oficial = institucional).
      const acao = dadosEspecificos?.acao as string | undefined
      if (acao !== 'inclusao') {
        throw new Error(`requerimento de convidado sem alvo existente só aceita ação 'inclusao' (recebido: '${acao}')`)
      }
      const existente = await db.prepare(`SELECT id FROM usuarios WHERE nick = ?`).bind(alvo.nickAlvo).first<{ id: number }>()
      if (existente) throw new Error(`já existe uma conta com o nick '${alvo.nickAlvo}'`)

      const { meta } = await db
        .prepare(
          `INSERT INTO usuarios (nick, tipo, corpo, patente_atual_id, status, eh_convidado, data_ingresso)
           VALUES (?, 'conta_oficial', NULL, NULL, 'ativo', 1, ${AGORA})`
        )
        .bind(alvo.nickAlvo)
        .run()
      const usuarioId = Number(meta.last_row_id)
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
      if (existente) return aplicarEfeitoAprovacao(db, tipo, { usuarioId: existente.id }, dadosEspecificos, contexto)
    }

    if (tipo === 'bonificacao') {
      // Gratificação comum continua exigindo um usuário já cadastrado
      // (o valor/motivo dela não faz sentido pra quem nunca esteve na
      // organização) — só o subtipo Medalha aceita conceder a alguém
      // ainda sem conta no CIASystem.
      const categoria = dadosEspecificos?.categoria as string | undefined
      if (categoria !== 'medalha') {
        throw new Error(`gratificação comum não aceita alvo por nick — só o subtipo Medalha aceita conceder a alguém ainda não cadastrado`)
      }

      // Nick já tem conta (membro, convidado ou externo de uma medalha
      // anterior) — reaproveita em vez de tentar criar duplicata; a
      // mesma pessoa pode receber várias medalhas ao longo do tempo.
      const existente = await db.prepare(`SELECT id FROM usuarios WHERE nick = ?`).bind(alvo.nickAlvo).first<{ id: number }>()
      if (existente) return aplicarEfeitoAprovacao(db, tipo, { usuarioId: existente.id }, dadosEspecificos, contexto)

      // Cria uma conta "externa" só pra existir como alvo da medalha —
      // eh_externo=1 (ver 0055) marca que não é membro, não é
      // convidado, e não é conta institucional de verdade, apesar de
      // usar tipo='conta_oficial' por baixo dos panos (mesmo motivo do
      // convidado: único valor aceito pelo CHECK com corpo/patente NULL).
      const { meta } = await db
        .prepare(
          `INSERT INTO usuarios (nick, tipo, corpo, patente_atual_id, status, eh_externo, data_ingresso)
           VALUES (?, 'conta_oficial', NULL, NULL, 'ativo', 1, ${AGORA})`
        )
        .bind(alvo.nickAlvo)
        .run()
      const usuarioId = Number(meta.last_row_id)
      await concederMedalha(db, usuarioId, dadosEspecificos, contexto)
      const depois = await db.prepare(`SELECT patente_atual_id, corpo, status, tag, nick, exoneracao_ate FROM usuarios WHERE id = ?`).bind(usuarioId).first()
      return { usuarioId, antes: null, depois }
    }

    if (tipo === 'contratacao' || tipo === 'venda_cargo' || tipo === 'integracao') {
      const patente = await buscarPatente(db, dadosEspecificos?.patente_destino_id)
      const tag = dadosEspecificos?.tag as string | undefined
      const dataIngresso = tipo === 'integracao'
        ? normalizarDataIntegracao(dadosEspecificos?.data as string | undefined)
        : null
      const dataUltimoAto = tipo === 'integracao'
        ? normalizarDataIntegracao(dadosEspecificos?.data_ultimo_ato_funcional as string | undefined)
        : null
      const usuarioId = await criarUsuarioDeEntrada(db, alvo.nickAlvo, patente.id, patente.corpo, tag, dataIngresso, dataUltimoAto)
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
    .prepare(`SELECT patente_atual_id, corpo, status, tag, nick, exoneracao_ate, eh_convidado FROM usuarios WHERE id = ?`)
    .bind(usuarioId)
    .first<{ nick: string; eh_convidado: number }>()

  // Conta do dono do sistema: nenhum desses tipos pode mexer no nick
  // (transferência de conta) nem no status (licença, desligamento,
  // reforma, exoneração) dela — nem por requerimento aprovado por outro
  // admin. Patente/cargo (promoção, rebaixamento etc.) continuam
  // permitidos, só esses dois campos são protegidos aqui.
  if (ehContaProtegida(antes?.nick) && TIPOS_QUE_ALTERAM_NICK_OU_STATUS.has(tipo)) {
    throw new Error(`a conta ${NICK_CONTA_PROTEGIDA} não pode ter nick nem status alterado por requerimento`)
  }

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
    // as duas datas históricas independentes (`data_ingresso` e
    // `data_ultimo_ato_funcional`), com fallback simétrico entre elas
    // quando só uma for informada (comportamento de antes, quando só
    // existia um campo de data pros dois). Se NENHUMA das duas vier
    // preenchida, `data_ingresso` mantém o valor já registrado
    // (COALESCE com a própria coluna) e `data_ultimo_ato_funcional` cai
    // pra AGORA (reaplicar Integração sem informar data é, por si só,
    // um novo ato funcional).
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
      const dataIngressoInformada = normalizarDataIntegracao(dadosEspecificos?.data as string | undefined)
      const dataUltimoAtoInformada = normalizarDataIntegracao(dadosEspecificos?.data_ultimo_ato_funcional as string | undefined)
      const dataIngresso = dataIngressoInformada ?? dataUltimoAtoInformada
      const dataUltimoAto = dataUltimoAtoInformada ?? dataIngressoInformada
      await db
        .prepare(
          `UPDATE usuarios
           SET patente_atual_id = ?, corpo = ?,
               data_ingresso = COALESCE(?, data_ingresso),
               data_ultimo_ato_funcional = COALESCE(?, ${AGORA}),
               tag = COALESCE(?, tag),
               atualizado_em = ${AGORA}
           WHERE id = ?`
        )
        .bind(patenteDestino.id, patenteDestino.corpo, dataIngresso, dataUltimoAto, novaTag, usuarioId)
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
      // Desligado desonroso perde admin (se tivesse) e é derrubado de
      // qualquer sessão já aberta na hora — sem isso, um admin desligado
      // desonrosamente mantinha acesso administrativo pleno até o access
      // token expirar sozinho (até 1h) e o flag de admin nunca era limpo.
      await db
        .prepare(`UPDATE usuarios SET status = 'desligado_desonroso', administrador_sistema = 0, atualizado_em = ${AGORA} WHERE id = ?`)
        .bind(usuarioId)
        .run()
      await revogarTodasSessoes(db, usuarioId)
      break

    // Convidado num alvo que já existe é sempre a ação 'exclusao' (a
    // 'inclusao' cria conta nova e nunca chega aqui — ver o branch
    // "porta de entrada" acima). Reaproveita o status 'desligado_honroso'
    // já existente em vez de um valor novo — a listagem de convidados
    // simplesmente filtra por esse status pra saber quem ainda conta.
    case 'convidado': {
      const acao = dadosEspecificos?.acao as string | undefined
      if (acao !== 'exclusao') {
        throw new Error(`requerimento de convidado sobre alvo existente só aceita ação 'exclusao' (recebido: '${acao}')`)
      }
      // Trava crítica: sem isso, qualquer autenticado (o tipo 'convidado'
      // não passa por checagem de hierarquia — é assim de propósito só
      // pra inclusão) conseguiria mandar 'exclusao' com o id de QUALQUER
      // usuário real (ex: um Comandante-Geral) e desligá-lo instantaneamente
      // (status='desligado_honroso'), sem nenhuma permissão. Confirma no
      // servidor que o alvo é mesmo um convidado antes de aplicar.
      if (!antes?.eh_convidado) {
        throw new Error(`esse usuário não é um convidado — exclusão de convidado só se aplica a contas com eh_convidado=1`)
      }
      await db
        .prepare(`UPDATE usuarios SET status = 'desligado_honroso', atualizado_em = ${AGORA} WHERE id = ?`)
        .bind(usuarioId)
        .run()
      break
    }

    case 'exoneracao': {
      // Mesma trava do desligamento desonroso: zera admin e revoga
      // sessões na hora — requireAuth já bloqueia 'exonerado' a cada
      // request, mas sem isso o flag de admin ficava sujo pra sempre
      // (se a pessoa um dia voltasse por reintegração, herdaria admin
      // de volta sem ninguém ter decidido isso).
      const exoneracaoAte = (dadosEspecificos?.exoneracao_ate as string | undefined) ?? null
      await db
        .prepare(
          `UPDATE usuarios SET status = 'exonerado', exoneracao_ate = ?, administrador_sistema = 0, atualizado_em = ${AGORA} WHERE id = ?`
        )
        .bind(exoneracaoAte, usuarioId)
        .run()
      await revogarTodasSessoes(db, usuarioId)
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

    // Gratificação comum (categoria ausente ou 'gratificacao'): sem
    // efeito sobre `usuarios` por enquanto — o requerimento ainda é
    // aprovado e vira `historico` (valor_gratificacao/motivo_gratificacao_id
    // não são gravados hoje; gap pré-existente, fora do escopo deste
    // pedido). Categoria 'medalha': concede a medalha de verdade.
    case 'bonificacao': {
      const categoria = dadosEspecificos?.categoria as string | undefined
      if (categoria === 'medalha') {
        await concederMedalha(db, usuarioId, dadosEspecificos, contexto)
      }
      break
    }

    default:
      // turno_tarefa / advertencia / cancelamento: dependem de módulos
      // ainda não implementados ou de lógica própria mais complexa.
      // Sem efeito sobre `usuarios` por enquanto — o requerimento ainda
      // é aprovado e vira `historico`.
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
    // requerimento) — reverter significa desfazer a criação. Mas só
    // faz sentido apagar a conta se NADA mais aconteceu com ela desde
    // então: se a pessoa já foi promovida, recebeu medalha, entrou em
    // grupo etc., cancelar a entrada original apagaria esse histórico
    // inteiro (e a conta junto) — recusa nesse caso, em vez de fazer
    // isso silenciosamente. `historico` é o espelho permanente de toda
    // ação já aplicada (ver services/requerimentos.ts), então qualquer
    // linha além da própria entrada já é sinal de acúmulo.
    const outroHistorico = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM historico
         WHERE usuario_id = ? AND NOT (requerimento_id = ? AND requerimento_alvo_id = ?)`
      )
      .bind(usuarioId, requerimentoId, alvoId)
      .first<{ n: number }>()
    if ((outroHistorico?.n ?? 0) > 0) {
      throw new Error(
        `essa conta já acumulou ${outroHistorico!.n} outra(s) ação(ões) desde a entrada — cancelar a porta de entrada apagaria esse histórico e a conta inteira; use desligamento ou exoneração em vez de cancelar`
      )
    }

    // Precisa limpar TODAS as referências que apontam pra esse usuário
    // primeiro (nenhuma tem ON DELETE CASCADE), senão o DELETE falha.
    // `notificacoes` é a mais comum de esquecer: toda aprovação já
    // notifica o próprio alvo ("Seu requerimento foi aprovado"), então
    // um usuário recém-criado por porta de entrada SEMPRE tem pelo
    // menos uma linha lá — sem limpar isso, o DELETE final falhava
    // (FK), o erro era engolido pelo catch antigo, e o usuário (com
    // status 'exonerado' etc.) ficava travado pra sempre.
    // Medalha concedida por esse mesmo requerimento (ex: porta de
    // entrada de uma conta externa criada só pra receber uma Medalha)
    // — sem apagar isso antes, o DELETE FROM usuarios abaixo falha (FK,
    // medalhas.usuario_id não tem CASCADE).
    await db.prepare(`DELETE FROM medalhas WHERE requerimento_alvo_id = ?`).bind(alvoId).run()
    await db.prepare(`DELETE FROM historico WHERE usuario_id = ?`).bind(usuarioId).run()
    await db.prepare(`DELETE FROM notificacoes WHERE usuario_id = ?`).bind(usuarioId).run()
    await db.prepare(`UPDATE requerimento_alvos SET usuario_id = NULL WHERE usuario_id = ?`).bind(usuarioId).run()
    await db.prepare(`UPDATE requerimento_alvos SET decidido_por_id = NULL WHERE decidido_por_id = ?`).bind(usuarioId).run()
    await db.prepare(`DELETE FROM usuarios WHERE id = ?`).bind(usuarioId).run()
  } else {
    // Idem — se esse requerimento tinha concedido uma medalha a um
    // alvo que já existia (não uma porta de entrada), desfaz a
    // concessão junto com o resto do efeito.
    await db.prepare(`DELETE FROM medalhas WHERE requerimento_alvo_id = ?`).bind(alvoId).run()
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
