-- Categorias de decreto, geridas pelo admin do sistema (mesmo padrão
-- de documentos_categorias). Todo decreto pertence a uma.
CREATE TABLE decretos_categorias (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nome        TEXT NOT NULL UNIQUE,
    ordem       INTEGER NOT NULL DEFAULT 0,
    criado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Categoria padrão pra decretos já existentes não ficarem sem uma.
INSERT INTO decretos_categorias (nome, ordem) VALUES ('Geral', 1);

ALTER TABLE decretos ADD COLUMN categoria_id INTEGER NOT NULL DEFAULT 1 REFERENCES decretos_categorias(id);
