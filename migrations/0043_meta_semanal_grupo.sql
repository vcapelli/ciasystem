-- Meta semanal de aulas por grupo — só faz sentido em grupos com
-- `permite_aulas = 1` (INS, APM, etc). Cada grupo tem UMA meta
-- (quantidade de aulas/semana), que pode estar ativa ou não, e se
-- aplica só aos cargos internos (grupo_niveis) marcados em
-- `grupo_meta_niveis` — quem está fora da seleção não é cobrado.
--
-- O dashboard de acompanhamento (rota /grupos/:slug/meta/dashboard)
-- conta "aulas dadas na semana" usando `grupo_aula_relatorios.criado_em`
-- (sempre ISO, gravado automaticamente) — e NÃO `data_efetiva`, que é
-- guardado como texto livre formatado ("20 Set 2026", só pra exibição)
-- e não dá pra usar em range query sem parsing extra.
ALTER TABLE grupos ADD COLUMN meta_semanal_ativa INTEGER NOT NULL DEFAULT 0;
ALTER TABLE grupos ADD COLUMN meta_semanal_quantidade INTEGER;

CREATE TABLE grupo_meta_niveis (
    grupo_id    INTEGER NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
    nivel_id    INTEGER NOT NULL REFERENCES grupo_niveis(id) ON DELETE CASCADE,
    PRIMARY KEY (grupo_id, nivel_id)
);
