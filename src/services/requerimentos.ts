// Regras de negócio do módulo de Requerimentos, separadas da camada
// de rotas (src/routes/requerimentos.ts só deve orquestrar chamadas
// pra cá, sem lógica de domínio misturada).

/**
 * Gera a TAG interna do requerimento (não confundir com a TAG pessoal
 * do policial). Formato provisório: prefixo do tipo + timestamp curto
 * + sufixo aleatório, só pra garantir unicidade sem round-trip ao
 * banco antes do INSERT. Ajuste o formato conforme a convenção que
 * vocês quiserem usar (ex: visível pro usuário nos posts do fórum).
 */
export function gerarTagRequerimento(tipo: string): string {
  const prefixo = tipo.slice(0, 3).toUpperCase()
  const timestamp = Date.now().toString(36).toUpperCase()
  const sufixo = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `${prefixo}-${timestamp}-${sufixo}`
}

/**
 * TODO (Fase 2, próximo passo): checagem de hierarquia.
 * Recebe a patente/cargo de quem está tentando agir (autor) e a
 * patente/cargo do alvo, consulta `diretrizes_hierarquia` pra saber
 * se a ação (`promover`/`rebaixar`/`advertir`/`demitir`/`exonerar`/
 * `licenciar`) é permitida. Isso SEMPRE roda no Worker, nunca confia
 * em dado vindo do cliente — ver seção 5 do doc-mestre.
 *
 * Assinatura sugerida:
 * async function podeAgirSobre(
 *   db: D1Database,
 *   acao: 'promover' | 'rebaixar' | 'advertir' | 'demitir' | 'exonerar' | 'licenciar',
 *   patenteOrigemId: number,
 *   patenteAlvoId: number,
 * ): Promise<boolean>
 */

/**
 * TODO (Fase 2, próximo passo): checagem de permissão de gestão.
 * Consulta `requerimentos_permissoes` (por usuario_id OU grupo_id,
 * respeitando o `tipo` NULL = todos) pra saber se quem está tentando
 * aprovar/reprovar/cancelar tem esse poder pro tipo do requerimento
 * em questão. Lembrar: concessão por grupo é dinâmica — se a pessoa
 * saiu do grupo, perde o poder na hora (resolver via JOIN em
 * usuario_grupos, nunca cache).
 */
