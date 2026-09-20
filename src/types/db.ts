// Tipo estrutural mínimo compartilhado pelos services que só usam
// `.prepare()` — aceita tanto o binding `D1Database` normal quanto uma
// `D1DatabaseSession` (criada com `.withSession(...)`), sem precisar
// duplicar a assinatura de cada helper. Ver comentário em
// `src/routes/projetos.ts` sobre por que a sessão é necessária ali.
export type D1Like = Pick<D1Database, 'prepare'>
