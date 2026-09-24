// Protege a conta "vcapelli" (dono do sistema) contra ter nick, senha,
// status ou tipo de conta alterados — mesmo por outro administrador do
// sistema, que tem bypass total de hierarquia em quase toda checagem
// do app. Sem isso, uma conta admin comprometida (ou um erro humano)
// poderia trocar o nick/senha do dono, desligá-lo ou converter a conta
// pra "conta_oficial", trancando-o de fora do próprio sistema sem
// nenhuma trava. Patente/cargo, TAG, biografia e o resto continuam
// editáveis normalmente — só esses 4 campos são bloqueados.

export const NICK_CONTA_PROTEGIDA = 'vcapelli'

export function ehContaProtegida(nick: string | null | undefined): boolean {
  return (nick ?? '').toLowerCase() === NICK_CONTA_PROTEGIDA
}
