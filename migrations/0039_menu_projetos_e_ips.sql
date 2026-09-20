-- =====================================================================
-- MENU: ITEM "PROJETOS" E "IPS DOS USUÁRIOS", COM VISIBILIDADE PRÓPRIA
-- =====================================================================
-- menu_itens só sabia restringir por grupo (grupo_restrito_id) ou
-- patente mínima (patente_minima_id) — nenhum dos dois cobre "só quem
-- tem a flag de acesso à listagem de IPs" nem "só quem pode ver
-- processos" (que dependem de configuração/grupo dinâmico, não de um
-- grupo fixo). `chave_permissao` cobre isso: quando setada, o Worker
-- (GET /menu, ver CHECAGENS_PERMISSAO_MENU em src/routes/menu.ts) roda
-- a MESMA checagem de permissão da página de verdade, então o item
-- some do menu sozinho pra quem não teria acesso ao clicar.
-- =====================================================================

ALTER TABLE menu_itens ADD COLUMN chave_permissao TEXT CHECK (chave_permissao IN ('projetos', 'ip_listagem'));

INSERT INTO menu_itens (titulo, url, icone, ordem, chave_permissao, criado_por_id)
VALUES (
  'Projetos',
  '/projetos.html',
  'fa-solid fa-diagram-project',
  (SELECT COALESCE(MAX(ordem), 0) + 1 FROM menu_itens WHERE item_pai_id IS NULL),
  'projetos',
  (SELECT id FROM usuarios WHERE administrador_sistema = 1 ORDER BY id LIMIT 1)
);

INSERT INTO menu_itens (titulo, url, icone, ordem, chave_permissao, criado_por_id)
VALUES (
  'IPs dos Usuários',
  '/ips-usuarios.html',
  'fa-solid fa-network-wired',
  (SELECT COALESCE(MAX(ordem), 0) + 1 FROM menu_itens WHERE item_pai_id IS NULL),
  'ip_listagem',
  (SELECT id FROM usuarios WHERE administrador_sistema = 1 ORDER BY id LIMIT 1)
);
