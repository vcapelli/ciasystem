-- =====================================================================
-- MEDALHA COMO SUBTIPO DO REQUERIMENTO DE GRATIFICAÇÃO
-- =====================================================================
-- Pedido do Vitor (25/09/2026): o mesmo formulário de Gratificação
-- (tipo 'bonificacao') ganha uma "Categoria" — Gratificação (como já
-- era) ou Medalha (nova) — sem exigir um valor novo no CHECK de
-- requerimentos.tipo (fica em dados_especificos.categoria = 'medalha',
-- resolvido em src/services/efeitos.ts). Medalha pode ser concedida:
--   - sem limitação de patente/cargo (bonificacao já não tem checagem
--     de hierarquia — ver acaoHierarquiaDoTipo);
--   - a si mesmo (ver TIPOS_PERMITEM_AUTO_ALVO em routes/requerimentos.ts);
--   - a alguém ainda não cadastrado no CIASystem (por nick).
-- Por padrão entra 'pendente' como qualquer requerimento de
-- bonificacao — 'bonificacao' nunca esteve em TIPOS_AUTO_APROVADOS,
-- então isso já era verdade antes; só o texto da tela (removido agora)
-- dizia o contrário.
--
-- Duas mudanças de schema, nenhuma exige rebuild de tabela (SQLite
-- aceita ADD COLUMN simples sem mexer em CHECK/FK existente — mesma
-- lógica de 0053 pro eh_convidado):
--
-- 1) usuarios.eh_externo — conta "externa": um 4º jeito de existir na
--    tabela usuarios (ao lado de jogador, conta_oficial de verdade e
--    convidado), criada só quando uma Medalha é concedida a um nick
--    que ainda não tem NENHUMA conta no sistema. Não é membro (sem
--    "dias no posto"/"dias na polícia"), não é convidado (não entra
--    na listagem de Convidados) e não é conta institucional de
--    verdade — tipo continua 'conta_oficial' por baixo dos panos (é o
--    único valor que o CHECK de usuarios aceita com corpo/patente
--    NULL), então eh_externo=1 precisa ser excluído explicitamente em
--    todo lugar que já trata tipo='conta_oficial' como "conta
--    institucional de verdade" (dropdown de "postar em nome de" —
--    mesmo cuidado que já existe pra eh_convidado desde 0053).
--
-- 2) medalhas.requerimento_id / requerimento_alvo_id — liga a medalha
--    ao requerimento que a concedeu (quando veio por esse caminho; a
--    concessão direta via POST /medalhas continua existindo e deixa
--    os dois NULL). Sem isso, cancelar/excluir esse requerimento não
--    teria como saber qual linha de `medalhas` desfazer.
-- =====================================================================

ALTER TABLE usuarios ADD COLUMN eh_externo INTEGER NOT NULL DEFAULT 0;

ALTER TABLE medalhas ADD COLUMN requerimento_id INTEGER REFERENCES requerimentos(id);
ALTER TABLE medalhas ADD COLUMN requerimento_alvo_id INTEGER REFERENCES requerimento_alvos(id);

CREATE INDEX idx_medalhas_requerimento_alvo ON medalhas(requerimento_alvo_id);
