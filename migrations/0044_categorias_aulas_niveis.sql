-- Restrição de visibilidade por categoria de aula: cada categoria pode
-- ser liberada só pra alguns cargos internos (grupo_niveis) do grupo —
-- quem não está na lista não vê nem a categoria nem as aulas dela.
-- Sem nenhuma linha aqui pra uma categoria, ela continua visível a
-- qualquer membro (comportamento de hoje, mantido por padrão).
--
-- Isso é ADICIONAL ao `grupo_aulas.nivel_minimo_id` que já existe (um
-- corte por ordem/patente na aula individual) — os dois filtros se
-- combinam: a aula só aparece se passar nos dois ao mesmo tempo.
CREATE TABLE grupo_aulas_categoria_niveis (
    categoria_id    INTEGER NOT NULL REFERENCES grupo_aulas_categorias(id) ON DELETE CASCADE,
    nivel_id        INTEGER NOT NULL REFERENCES grupo_niveis(id) ON DELETE CASCADE,
    PRIMARY KEY (categoria_id, nivel_id)
);
