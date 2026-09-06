// Registro de eventos genérico — usuario_id opcional (NULL em eventos
// automáticos/sistema, sem uma pessoa por trás). `tipo_evento` é texto
// livre de propósito: novos tipos de ação não exigem alteração de
// schema, só o Worker passar a gravar esse valor.

export async function registrarEvento(
  db: D1Database,
  usuarioId: number | null,
  tipoEvento: string,
  opcoes?: {
    referenciaTipo?: string
    referenciaId?: number
    ip?: string
    userAgent?: string
    detalhes?: unknown
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO logs_eventos (usuario_id, tipo_evento, referencia_tipo, referencia_id, ip, user_agent, detalhes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      usuarioId,
      tipoEvento,
      opcoes?.referenciaTipo ?? null,
      opcoes?.referenciaId ?? null,
      opcoes?.ip ?? null,
      opcoes?.userAgent ?? null,
      opcoes?.detalhes ? JSON.stringify(opcoes.detalhes) : null
    )
    .run()
}
