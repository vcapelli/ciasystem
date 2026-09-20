// Helper genérico pra criar notificações — reutilizado por qualquer
// módulo (requerimentos, documentos, fórum, twitter etc.) sem cada um
// precisar saber a estrutura da tabela.

import type { D1Like } from '../types/db'

export type TipoNotificacao =
  | 'mensagem' | 'noticia' | 'noticia_grupo'
  | 'tweet_resposta' | 'tweet_curtida' | 'tweet_retweet' | 'tweet_mencao'
  | 'seguidor_novo' | 'requerimento_status' | 'documento_revisao' | 'documento_revisao_pendente'
  | 'emblema_recebido' | 'conquista_alcancada' | 'sistema'
  | 'projeto_responsavel' | 'projeto_status' | 'projeto_votacao_aberta'

export async function notificar(
  db: D1Like,
  usuarioId: number,
  tipo: TipoNotificacao,
  titulo: string,
  opcoes?: { corpo?: string; referenciaTipo?: string; referenciaId?: number }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO notificacoes (usuario_id, tipo, titulo, corpo, referencia_tipo, referencia_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(usuarioId, tipo, titulo, opcoes?.corpo ?? null, opcoes?.referenciaTipo ?? null, opcoes?.referenciaId ?? null)
    .run()
}
