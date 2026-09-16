-- Contas oficiais não têm personagem de verdade no Habblet pra puxar
-- avatar/figure automaticamente — então esses dois campos deixam o
-- admin definir manualmente na hora de criar a conta.
ALTER TABLE usuarios ADD COLUMN logo_url TEXT;    -- logo 39x39 transparente (mesma ideia do logo de grupo)
ALTER TABLE usuarios ADD COLUMN figure_fixa TEXT; -- figure do Habblet usado como avatar ao postar
