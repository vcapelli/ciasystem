-- Cor própria por patente/cargo, usada como cor de destaque do card
-- dessa patente nas páginas de listagem. NULL = usa o padrão do
-- sistema (dourado pro topo da hierarquia, escuro pros demais).
ALTER TABLE patentes ADD COLUMN cor TEXT;
