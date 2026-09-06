// Helper genérico pra criar notificações — reutilizado por qualquer
// módulo (requerimentos, documentos, fórum, twitter etc.) sem cada um
// precisar saber a estrutura da tabela.

export type TipoNotificacao =
  | 'mensagem' | 'noticia' | 'noticia_grupo'
  | 'tweet_resposta' | 'tweet_curtida' | 'tweet_retweet' | 'tweet_mencao'
  | 'seguidor_novo' | 'requerimento_status' | 'documento_revisao'
  | 'emblema_recebido' | 'conquista_alcancada' | 'sistema'

export async function notificar(
  db: D1Database,
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
