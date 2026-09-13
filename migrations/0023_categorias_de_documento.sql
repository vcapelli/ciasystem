-- =====================================================================
-- CATEGORIAS DE DOCUMENTO — administráveis (criar/editar/deletar), com
-- banner próprio. Substitui o antigo `tipo` fixo (enum) por uma
-- tabela de verdade.
-- =====================================================================

CREATE TABLE documentos_categorias (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nome        TEXT NOT NULL UNIQUE,
    banner_url  TEXT,
    ordem       INTEGER NOT NULL DEFAULT 0,
    criado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

INSERT INTO documentos_categorias (nome, ordem) VALUES
  ('Constituição Militar', 1),
  ('Código Penal Militar', 2),
  ('Guia de Defesa do Batalhão', 3),
  ('Outro', 4);

ALTER TABLE documentos ADD COLUMN categoria_id INTEGER REFERENCES documentos_categorias(id);

UPDATE documentos SET categoria_id = (SELECT id FROM documentos_categorias WHERE nome = 'Constituição Militar') WHERE tipo = 'constituicao_militar';
UPDATE documentos SET categoria_id = (SELECT id FROM documentos_categorias WHERE nome = 'Código Penal Militar') WHERE tipo = 'codigo_penal_militar';
UPDATE documentos SET categoria_id = (SELECT id FROM documentos_categorias WHERE nome = 'Guia de Defesa do Batalhão') WHERE tipo = 'guia_defesa_batalhao';
UPDATE documentos SET categoria_id = (SELECT id FROM documentos_categorias WHERE nome = 'Outro') WHERE categoria_id IS NULL;

ALTER TABLE documentos DROP COLUMN tipo;
