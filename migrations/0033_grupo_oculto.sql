-- Grupo oculto: só aparece na listagem geral e é acessível pra
-- administradores do sistema e quem já é membro dele. Pra qualquer
-- outra pessoa, ele simplesmente não existe (404, não 403 — não dá
-- pra confirmar nem que o grupo existe).
ALTER TABLE grupos ADD COLUMN oculto INTEGER NOT NULL DEFAULT 0;
