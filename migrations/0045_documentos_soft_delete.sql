-- =====================================================================
-- Soft delete para documentos institucionais.
-- =====================================================================
-- Hoje DELETE /documentos/:id apaga a linha de verdade, o que dispara
-- ON DELETE CASCADE em documento_revisoes -> documento_revisao_historico
-- e documento_revisao_aprovadores, apagando todo o histórico de revisões
-- e aprovações junto. Isso contraria o objetivo de histórico permanente
-- do projeto. A partir de agora, "deletar" um documento só marca
-- ativo = 0 (lixeira), preservando tudo; um admin do sistema pode
-- restaurar depois.
-- =====================================================================

ALTER TABLE documentos ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1;
