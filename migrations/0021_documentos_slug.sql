-- Slug legível pra URL própria de cada documento (ex: /documentos/constituicao-militar).
ALTER TABLE documentos ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX idx_documentos_slug ON documentos(slug);
