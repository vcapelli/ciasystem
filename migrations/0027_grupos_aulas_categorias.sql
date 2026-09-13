-- Categorias pra organizar as aulas de um grupo, e os campos que
-- faltavam em grupo_aulas (abreviação, slug próprio pra URL individual,
-- categoria).
CREATE TABLE grupo_aulas_categorias (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    grupo_id  INTEGER NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
    nome      TEXT NOT NULL,
    ordem     INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

ALTER TABLE grupo_aulas ADD COLUMN categoria_id INTEGER REFERENCES grupo_aulas_categorias(id);
ALTER TABLE grupo_aulas ADD COLUMN abreviacao TEXT;
ALTER TABLE grupo_aulas ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX idx_grupo_aulas_slug ON grupo_aulas(grupo_id, slug);
