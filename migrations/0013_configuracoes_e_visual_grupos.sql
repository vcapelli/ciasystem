-- =====================================================================
-- CONFIGURAÇÕES DO SISTEMA + VISUAL DOS GRUPOS
-- =====================================================================
-- Tabela genérica de chave/valor pra configurações globais (logo do
-- sistema, e outras que surgirem depois, sem precisar de migration
-- nova pra cada uma). Grupos ganham imagem/logo e cor padrão próprios.
-- =====================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE configuracoes_sistema (
    chave         TEXT PRIMARY KEY,
    valor         TEXT,
    atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

ALTER TABLE grupos ADD COLUMN imagem_url TEXT;
ALTER TABLE grupos ADD COLUMN cor TEXT; -- hex, ex: '#046b2f' — usada como cor de destaque do grupo na UI
