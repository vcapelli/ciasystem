-- Campos que faltavam nos registros internos do grupo (requerimentos
-- internos): data efetiva do ato (formato livre, ex: "13 Set 2026") e
-- referência de permissão (quem autorizou), usada em rebaixamento,
-- promoção, desligamento e advertência.
ALTER TABLE grupo_registros ADD COLUMN data_efetiva TEXT;
ALTER TABLE grupo_registros ADD COLUMN permissao TEXT;

-- Banner da página individual do grupo (separado do logo pequeno).
ALTER TABLE grupos ADD COLUMN banner_url TEXT;
