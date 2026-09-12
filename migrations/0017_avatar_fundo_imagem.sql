-- Fundo do avatar também pode ser uma imagem livre (URL qualquer,
-- sem curadoria de admin — diferente do banner) além da cor livre já
-- existente. Se ambos estiverem preenchidos, a imagem tem prioridade.

ALTER TABLE usuarios ADD COLUMN avatar_fundo_imagem_url TEXT;
