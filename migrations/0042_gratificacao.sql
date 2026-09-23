-- Gratificação: requerimento (reaproveita o tipo 'bonificacao', já
-- previsto no CHECK de requerimentos.tipo desde a Fase 1 mas nunca
-- implementado) + tabela de motivos com valor fixo (5/10/15/20/25/50),
-- cadastrada pelo admin — igual a `crimes`, mas pro sentido contrário.
--
-- `motivo_gratificacao_id`/`valor_gratificacao` seguem o mesmo padrão
-- de `crime_id` em requerimentos: colunas simples via ALTER TABLE ADD
-- COLUMN (sem CHECK novo em `tipo`, então não precisa do rebuild
-- completo da tabela feito nas migrações 0004/0040). `valor_gratificacao`
-- congela o valor do motivo no momento da concessão — se o valor do
-- motivo mudar depois no cadastro, gratificações já concedidas não
-- mudam retroativamente, e a listagem/ranking soma sempre o valor
-- congelado.

CREATE TABLE motivos_gratificacao (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    nome    TEXT NOT NULL UNIQUE,
    valor   INTEGER NOT NULL CHECK (valor IN (5, 10, 15, 20, 25, 50)),
    ativo   INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE requerimentos ADD COLUMN motivo_gratificacao_id INTEGER REFERENCES motivos_gratificacao(id);
ALTER TABLE requerimentos ADD COLUMN valor_gratificacao INTEGER;
