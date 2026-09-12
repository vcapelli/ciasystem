-- Ajustes de texto na lista de crimes (pra bater exatamente com a
-- redação oficial) + garantia de que a lista completa existe, caso a
-- migration 0014 ainda não tenha sido aplicada no banco remoto.

UPDATE crimes SET nome = 'Lista negra' WHERE nome = 'Lista Negra';
UPDATE crimes SET nome = 'Obstrução a Justiça' WHERE nome = 'Obstrução à Justiça';

INSERT OR IGNORE INTO crimes (nome, ativo) VALUES
  ('Abandono do Dever/Negligência', 1),
  ('Abuso de Poder', 1),
  ('Acusação sem Provas', 1),
  ('Ataque', 1),
  ('Autopromoção', 1),
  ('Baderna', 1),
  ('Camuflagem de IP', 1),
  ('Conta Comprometida', 1),
  ('Corrupção', 1),
  ('Crime contra a Paz Pública', 1),
  ('Desrespeito', 1),
  ('Insubordinação', 1),
  ('Fake', 1),
  ('Falsificação de Informações', 1),
  ('Insuficiência para a Patente', 1),
  ('Invasão', 1),
  ('Lista negra', 1),
  ('Nepotismo', 1),
  ('Obstrução a Justiça', 1),
  ('Quebra de Sigilo', 1),
  ('Traição', 1),
  ('Sigilo', 1),
  ('Outros', 1);
