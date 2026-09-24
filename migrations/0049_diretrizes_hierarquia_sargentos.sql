-- Corrige regras órfãs em `diretrizes_hierarquia` deixadas pela fusão
-- dos Sargentos (migração 0019). A linha "Subtenente -> teto 1º
-- Sargento" ainda apontava pro id do posto extinto, cujo `ordem` virou
-- 900+id (fora da faixa normal, pra sair do caminho da renumeração) —
-- isso fazia `alvo.ordem <= ordem_limite` (services/hierarquia.ts)
-- ser sempre verdadeiro, dando a Subtenente permissão de fato
-- ILIMITADA sobre qualquer patente do Corpo Militar.
--
-- Remapeia o teto pro posto único "Sargento" (que herdou o id do
-- antigo "3º Sargento") e remove a regra "1º Sargento -> 2º Sargento"
-- (inalcançável hoje — ninguém tem mais patente_atual_id apontando
-- pros ids extintos).
UPDATE diretrizes_hierarquia
SET patente_limite_id = (SELECT id FROM patentes WHERE corpo = 'militar' AND nome = 'Sargento')
WHERE patente_limite_id IN (
  SELECT id FROM patentes WHERE corpo = 'militar' AND nome IN ('1º Sargento', '2º Sargento') AND ativo = 0
);

DELETE FROM diretrizes_hierarquia
WHERE patente_origem_id IN (
  SELECT id FROM patentes WHERE corpo = 'militar' AND nome IN ('1º Sargento', '2º Sargento') AND ativo = 0
);
