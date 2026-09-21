-- =====================================================================
-- PROJETOS: RESUMO (todos os tipos) + ALVO DA CORREÇÃO
-- =====================================================================
-- `resumo` é uma síntese curta do processo (some parte antes de abrir
-- pra ler os "Detalhes" inteiros — na listagem, no card de votação
-- etc). Obrigatório nos 4 tipos, mas fica nullable no schema (mesmo
-- padrão de outras colunas opcionais desse projeto) — quem exige é a
-- validação na rota, pra não travar migração de linhas antigas.
--
-- `documento_id`/`secao_alvo`/`artigo_alvo` só fazem sentido pro tipo
-- 'correcao' — apontam pra qual documento institucional (tabela
-- `documentos`, já existente) e onde dentro dele (seção/artigo, texto
-- livre — a estrutura interna dos documentos não é modelada em linhas
-- próprias) o erro está. Sem ALTER de CHECK/rebuild de tabela: só
-- colunas novas, todas opcionais.
-- =====================================================================

ALTER TABLE projetos ADD COLUMN resumo TEXT;
ALTER TABLE projetos ADD COLUMN documento_id INTEGER REFERENCES documentos(id);
ALTER TABLE projetos ADD COLUMN secao_alvo TEXT;
ALTER TABLE projetos ADD COLUMN artigo_alvo TEXT;
