-- Duas formas de identificação diferente da pessoal ao postar um
-- requerimento:
--  1) TAG do próprio grupo (só membro de Órgão de Topo/Setor de
--     Inteligência, ex: postar como "COR" em vez da TAG pessoal).
--  2) Em nome de uma conta institucional (só admin do sistema) — igual
--     ao padrão já usado em tweets/notícias/decretos.
ALTER TABLE requerimentos ADD COLUMN tag_grupo_override TEXT;
ALTER TABLE requerimentos ADD COLUMN operado_por_id INTEGER REFERENCES usuarios(id);
