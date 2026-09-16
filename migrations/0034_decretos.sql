-- Diário Oficial: decretos publicados por qualquer grupo (só admin do
-- grupo publica). Numeração sequencial por ano, tipo "postagem" e
-- status "protocolado" (única combinação existente por enquanto, mas
-- deixado como coluna própria pra dar espaço a variação futura sem
-- precisar de migration nova).
CREATE TABLE decretos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    numero          INTEGER NOT NULL,   -- sequencial DENTRO do ano
    ano             INTEGER NOT NULL,
    titulo          TEXT NOT NULL,
    resumo          TEXT NOT NULL,
    conteudo        TEXT NOT NULL,
    tipo            TEXT NOT NULL DEFAULT 'postagem',
    status          TEXT NOT NULL DEFAULT 'protocolado',
    grupo_id        INTEGER NOT NULL REFERENCES grupos(id),
    autor_id        INTEGER NOT NULL REFERENCES usuarios(id),
    operado_por_id  INTEGER REFERENCES usuarios(id), -- preenchido quando autor_id é conta_oficial
    visualizacoes   INTEGER NOT NULL DEFAULT 0,
    criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (ano, numero)
);
CREATE INDEX idx_decretos_criado_em ON decretos(criado_em);
CREATE INDEX idx_decretos_grupo ON decretos(grupo_id);
