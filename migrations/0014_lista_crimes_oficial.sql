-- =====================================================================
-- Lista oficial de crimes (Código Penal Militar) — substitui qualquer
-- seed anterior pela lista definitiva confirmada.
-- =====================================================================

DELETE FROM crimes;

INSERT INTO crimes (nome, ativo) VALUES
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
  ('Lista Negra', 1),
  ('Nepotismo', 1),
  ('Obstrução à Justiça', 1),
  ('Quebra de Sigilo', 1),
  ('Traição', 1),
  ('Sigilo', 1),
  ('Outros', 1);
