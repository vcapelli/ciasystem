-- Patente suprema, acima de Comandante-Geral — só administradores do
-- sistema podem promover alguém a ela (regra aplicada no frontend do
-- formulário de Corpo de Oficiais).

INSERT INTO patentes (corpo, sub_corpo, nome, ordem, vagas, valor_compra_raros, ativo)
VALUES ('militar', 'oficiais', 'Alto Comando Militar', 16, NULL, NULL, 1);
