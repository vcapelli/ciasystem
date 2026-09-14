-- Relatório de aula: um instrutor registra que deu um curso pra um ou
-- mais alunos, com resultado (aprovado/reprovado). Base pra "Cursos"
-- no perfil do usuário e pro requisito "Curso Concluído" no admin.
CREATE TABLE grupo_aula_relatorios (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    grupo_id        INTEGER NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
    aula_id         INTEGER NOT NULL REFERENCES grupo_aulas(id),
    instrutor_id    INTEGER NOT NULL REFERENCES usuarios(id),
    data_efetiva    TEXT NOT NULL,
    aprovado        INTEGER NOT NULL,
    comentario      TEXT,
    criado_por_id   INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_relatorios_grupo ON grupo_aula_relatorios(grupo_id);
CREATE INDEX idx_relatorios_aula ON grupo_aula_relatorios(aula_id);

CREATE TABLE grupo_aula_relatorio_alunos (
    relatorio_id  INTEGER NOT NULL REFERENCES grupo_aula_relatorios(id) ON DELETE CASCADE,
    usuario_id    INTEGER NOT NULL REFERENCES usuarios(id),
    PRIMARY KEY (relatorio_id, usuario_id)
);
CREATE INDEX idx_relatorio_alunos_usuario ON grupo_aula_relatorio_alunos(usuario_id);
