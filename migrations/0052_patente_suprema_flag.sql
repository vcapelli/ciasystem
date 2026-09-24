-- Substitui a identificação de "Alto Comando Militar" (a patente
-- suprema, acima de tudo) por uma flag dedicada em vez de comparar
-- `nome = 'Alto Comando Militar'` espalhado pelo código (backend e
-- frontend) — renomear essa patente pelo próprio painel de admin
-- quebrava essa checagem em silêncio em 5 lugares diferentes.
ALTER TABLE patentes ADD COLUMN eh_suprema INTEGER NOT NULL DEFAULT 0;

UPDATE patentes SET eh_suprema = 1 WHERE nome = 'Alto Comando Militar';
