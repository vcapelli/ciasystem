-- Requisito "Curso Concluído" agora também pode apontar pra um curso
-- (aula) de um grupo, não só pra tabela antiga `cursos`.
ALTER TABLE requisitos_patente ADD COLUMN aula_id INTEGER REFERENCES grupo_aulas(id);
