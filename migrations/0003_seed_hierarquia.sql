-- =====================================================================
-- FASE 1b — SEED: HIERARQUIA E REQUISITOS DE PROMOÇÃO
-- =====================================================================
-- Popula patentes, equivalências, catálogo de cursos, requisitos de
-- promoção e diretrizes de hierarquia com os dados REAIS extraídos da
-- Constituição Militar (Título II, Capítulos e Seções indicados nos
-- comentários de cada bloco). Depende só da Fase 1 (0001_nucleo.sql).
--
-- Ajuste de schema incluído aqui: `requisitos_promocao` ganha a coluna
-- `requisito_especial` (texto livre), pra cobrir exigências que não
-- são "curso concluído" (ex: certificado CQ ativo, projeto aprovado
-- pela Corregedoria) — casos que não cabem no join com `cursos`.
-- =====================================================================

PRAGMA foreign_keys = ON;

ALTER TABLE requisitos_promocao ADD COLUMN requisito_especial TEXT;

-- ---------------------------------------------------------------------
-- PATENTES (Corpo Militar, Art. 2º; Corpo Executivo, Art. 3º-4º)
-- ---------------------------------------------------------------------

INSERT INTO patentes (corpo, sub_corpo, nome, ordem, vagas, valor_compra_raros) VALUES
    ('militar','pracas','Soldado',1,NULL,NULL),
    ('militar','pracas','Cabo',2,NULL,NULL),
    ('militar','pracas','3º Sargento',3,NULL,NULL),
    ('militar','pracas','2º Sargento',4,NULL,NULL),
    ('militar','pracas','1º Sargento',5,NULL,NULL),
    ('militar','pracas','Subtenente',6,NULL,NULL),
    ('militar','pracas_especiais','Aluno',7,NULL,NULL),
    ('militar','pracas_especiais','Aspirante a Oficial',8,NULL,NULL),
    ('militar','oficiais','Tenente',9,10,NULL),
    ('militar','oficiais','Capitão',10,8,NULL),
    ('militar','oficiais','Coronel',11,7,NULL),
    ('militar','oficiais','General',12,5,NULL),
    ('militar','oficiais','Marechal',13,4,NULL),
    ('militar','oficiais','Comandante',14,2,NULL),
    ('militar','oficiais','Comandante-Geral',15,2,NULL),
    ('executivo',NULL,'Supervisor',1,NULL,5),
    ('executivo',NULL,'Supervisor-Geral',2,NULL,7),
    ('executivo',NULL,'Inspetor',3,NULL,9),
    ('executivo',NULL,'Inspetor-Geral',4,NULL,11),
    ('executivo',NULL,'Coordenador',5,NULL,13),
    ('executivo',NULL,'Coordenador-Geral',6,NULL,15),
    ('executivo',NULL,'Superintendente',7,NULL,17),
    ('executivo',NULL,'Superintendente-Geral',8,NULL,19),
    ('executivo',NULL,'VIP',9,NULL,23),
    ('executivo',NULL,'Vice-Presidente',10,NULL,25),
    ('executivo',NULL,'Presidente',11,NULL,35),
    ('executivo',NULL,'Acionista Majoritário',12,NULL,45),
    ('executivo',NULL,'Chanceler',13,4,65);

-- ---------------------------------------------------------------------
-- EQUIVALÊNCIAS Executivo <-> Militar (Art. 3º §2º)
-- ---------------------------------------------------------------------

INSERT INTO equivalencias_patentes (patente_executivo_id, patente_militar_id)
SELECT pe.id, pm.id FROM patentes pe, patentes pm
WHERE pe.corpo='executivo' AND pm.corpo='militar' AND (pe.nome, pm.nome) IN (
    ('Supervisor','Tenente'), ('Supervisor-Geral','Tenente'),
    ('Inspetor','Capitão'), ('Inspetor-Geral','Capitão'),
    ('Coordenador','Coronel'), ('Coordenador-Geral','Coronel'),
    ('Superintendente','General'), ('Superintendente-Geral','General'),
    ('VIP','Marechal'), ('Vice-Presidente','Marechal'),
    ('Presidente','Comandante'), ('Acionista Majoritário','Comandante'),
    ('Chanceler','Comandante-Geral')
);

-- ---------------------------------------------------------------------
-- CATÁLOGO DE CURSOS (Seção IV, Art. 1º)
-- ---------------------------------------------------------------------

INSERT INTO cursos (codigo, nome) VALUES
    ('CFSd','Curso de Formação de Soldados'),
    ('SUP','Supervisão de Soldados'),
    ('CFC','Curso de Formação de Cabos'),
    ('SEG','Aula de Segurança'),
    ('CFS','Curso de Formação de Sargentos'),
    ('CAC','Curso de Aperfeiçoamento de Comunicação'),
    ('CAS','Curso de Aperfeiçoamento de Sargentos'),
    ('CAO','Curso de Aprimoramento Ortográfico'),
    ('PRO','Aula para Promotor'),
    ('CCO','Curso de Complementar Ortográfico'),
    ('CAP','Curso de Aperfeiçoamento de Praças'),
    ('TQSb','Treinamento de Qualificação para Subtenentes'),
    ('CFO','Curso de Formação de Oficiais');

-- ---------------------------------------------------------------------
-- REQUISITOS DE PROMOÇÃO — Corpo Militar (Seção IV, Art. 1º / Art. 3º §2º)
-- e Corpo Executivo (Art. 3º §3º)
-- ---------------------------------------------------------------------

WITH transicoes(corpo, origem, destino, dias, requer_cia, especial) AS (VALUES
    ('militar','Soldado','Cabo',0,0,NULL),
    ('militar','Cabo','3º Sargento',1,0,NULL),
    ('militar','3º Sargento','2º Sargento',2,1,NULL),
    ('militar','2º Sargento','1º Sargento',2,1,NULL),
    ('militar','1º Sargento','Subtenente',3,1,NULL),
    ('militar','Subtenente','Aluno',4,1,NULL),
    ('militar','Aluno','Aspirante a Oficial',5,1,NULL),
    ('militar','Aspirante a Oficial','Tenente',7,1,NULL),
    ('militar','Tenente','Capitão',8,0,NULL),
    ('militar','Capitão','Coronel',10,0,NULL),
    ('militar','Coronel','General',14,1,'Requer certificado de Qualificação do Oficialato Intermediário (CQ/AQOI) ativo — ver tabela certificados'),
    ('militar','General','Marechal',20,0,NULL),
    ('militar','Marechal','Comandante',30,1,'Requer 1 projeto aprovado pela Corregedoria/Supremacia OU ser membro da Corregedoria'),
    ('militar','Comandante','Comandante-Geral',35,0,NULL),
    ('executivo','Supervisor','Supervisor-Geral',5,1,NULL),
    ('executivo','Supervisor-Geral','Inspetor',5,1,NULL),
    ('executivo','Inspetor','Inspetor-Geral',7,1,NULL),
    ('executivo','Inspetor-Geral','Coordenador',8,1,NULL),
    ('executivo','Coordenador','Coordenador-Geral',9,1,NULL),
    ('executivo','Coordenador-Geral','Superintendente',11,1,NULL),
    ('executivo','Superintendente','Superintendente-Geral',15,1,NULL),
    ('executivo','Superintendente-Geral','VIP',15,1,NULL),
    ('executivo','VIP','Vice-Presidente',15,1,NULL),
    ('executivo','Vice-Presidente','Presidente',15,1,NULL),
    ('executivo','Presidente','Acionista Majoritário',15,1,NULL),
    ('executivo','Acionista Majoritário','Chanceler',15,1,NULL)
)
INSERT INTO requisitos_promocao (patente_origem_id, patente_destino_id, dias_minimos, requer_companhia, requisito_especial)
SELECT po.id, pd.id, t.dias, t.requer_cia, t.especial
FROM transicoes t
JOIN patentes po ON po.corpo = t.corpo AND po.nome = t.origem
JOIN patentes pd ON pd.corpo = t.corpo AND pd.nome = t.destino;

-- Cursos exigidos por transição. No Corpo Executivo, toda progressão
-- "acima de Supervisor" exige CFO (Seção IV, Art. 1º, "CORPO
-- EXECUTIVO: Promoção para Supervisor-Geral(+)").
WITH req_cursos(corpo, origem, destino, curso_codigo) AS (VALUES
    ('militar','Soldado','Cabo','CFSd'),
    ('militar','Soldado','Cabo','SUP'),
    ('militar','Cabo','3º Sargento','CFC'),
    ('militar','Cabo','3º Sargento','SEG'),
    ('militar','3º Sargento','2º Sargento','CFS'),
    ('militar','3º Sargento','2º Sargento','CAC'),
    ('militar','2º Sargento','1º Sargento','CAS'),
    ('militar','2º Sargento','1º Sargento','CAO'),
    ('militar','1º Sargento','Subtenente','PRO'),
    ('militar','1º Sargento','Subtenente','CCO'),
    ('militar','Subtenente','Aluno','CAP'),
    ('militar','Subtenente','Aluno','TQSb'),
    ('militar','Aluno','Aspirante a Oficial','CFO'),
    ('militar','Aspirante a Oficial','Tenente','CFO'),
    ('executivo','Supervisor','Supervisor-Geral','CFO'),
    ('executivo','Supervisor-Geral','Inspetor','CFO'),
    ('executivo','Inspetor','Inspetor-Geral','CFO'),
    ('executivo','Inspetor-Geral','Coordenador','CFO'),
    ('executivo','Coordenador','Coordenador-Geral','CFO'),
    ('executivo','Coordenador-Geral','Superintendente','CFO'),
    ('executivo','Superintendente','Superintendente-Geral','CFO'),
    ('executivo','Superintendente-Geral','VIP','CFO'),
    ('executivo','VIP','Vice-Presidente','CFO'),
    ('executivo','Vice-Presidente','Presidente','CFO'),
    ('executivo','Presidente','Acionista Majoritário','CFO'),
    ('executivo','Acionista Majoritário','Chanceler','CFO')
)
INSERT INTO requisitos_promocao_cursos (requisito_id, curso_id)
SELECT rp.id, c.id
FROM req_cursos rc
JOIN patentes po ON po.corpo = rc.corpo AND po.nome = rc.origem
JOIN patentes pd ON pd.corpo = rc.corpo AND pd.nome = rc.destino
JOIN requisitos_promocao rp ON rp.patente_origem_id = po.id AND rp.patente_destino_id = pd.id
JOIN cursos c ON c.codigo = rc.curso_codigo;

-- ---------------------------------------------------------------------
-- DIRETRIZES DE HIERARQUIA — até onde cada patente/cargo pode agir
-- (Título II, Capítulo II, Seções I e II)
-- ---------------------------------------------------------------------
-- A Constituição descreve só "promove/rebaixa/demite até X" — as 3
-- ações compartilham o mesmo teto, por isso o cross join com `acoes`.
-- `requer_pro_ou_cfo = 1` em todas as linhas porque o Art. 2º §1º da
-- Seção III exige PRO (Militar) ou CFO (Executivo) pra exercer
-- QUALQUER competência de promotor, sem exceção.
--
-- NOTA: a Constituição NÃO lista teto pra Soldado, Cabo, 2º/3º
-- Sargento (Militar->Militar) nem pra Tenente e patentes abaixo
-- (Militar->Executivo) — ou seja, essas patentes não têm nenhuma
-- competência de agir sobre ninguém. Ausência de linha aqui = negar
-- por padrão, não precisa inserir nada pra elas.
--
-- NOTA 2: o Art. 1º da Seção I traz uma condição especial só pra
-- 1º Sargento -> 2º Sargento ("necessária a permissão de um Oficial
-- do Corpo Militar ou Executivo com CFO concluído") — isso é
-- exatamente o caso de uso do módulo de Permissões Prévias (tabela
-- `permissoes`), que está desativado no v1. Fica registrado em
-- `observacao` só como lembrete; não modelar agora.

WITH acoes(acao) AS (
    VALUES ('promover'), ('rebaixar'), ('demitir')
),
pares(corpo_origem, nome_origem, corpo_limite, nome_limite, obs) AS (VALUES
    -- Militar -> Militar (Seção I, Art. 1º)
    ('militar','Comandante-Geral','militar','Comandante',NULL),
    ('militar','Comandante','militar','Marechal',NULL),
    ('militar','Marechal','militar','General',NULL),
    ('militar','General','militar','Coronel',NULL),
    ('militar','Coronel','militar','Capitão',NULL),
    ('militar','Capitão','militar','Tenente',NULL),
    ('militar','Tenente','militar','Aspirante a Oficial',NULL),
    ('militar','Aspirante a Oficial','militar','Subtenente',NULL),
    ('militar','Subtenente','militar','1º Sargento',NULL),
    ('militar','1º Sargento','militar','2º Sargento','Exige permissão prévia de Oficial (Militar ou Executivo) com CFO concluído — módulo de Permissões Prévias, desativado no v1'),
    -- Militar -> Executivo (Seção I, Art. 2º)
    ('militar','Comandante-Geral','executivo','Acionista Majoritário',NULL),
    ('militar','Comandante','executivo','Vice-Presidente',NULL),
    ('militar','Marechal','executivo','Superintendente-Geral',NULL),
    ('militar','General','executivo','Coordenador-Geral',NULL),
    ('militar','Coronel','executivo','Inspetor-Geral',NULL),
    ('militar','Capitão','executivo','Supervisor-Geral',NULL),
    -- Executivo -> Militar (Seção II, Art. 1º)
    ('executivo','Chanceler','militar','Comandante',NULL),
    ('executivo','Acionista Majoritário','militar','Marechal',NULL),
    ('executivo','Presidente','militar','Marechal',NULL),
    ('executivo','Vice-Presidente','militar','General',NULL),
    ('executivo','VIP','militar','General',NULL),
    ('executivo','Superintendente-Geral','militar','Coronel',NULL),
    ('executivo','Superintendente','militar','Coronel',NULL),
    ('executivo','Coordenador-Geral','militar','Capitão',NULL),
    ('executivo','Coordenador','militar','Capitão',NULL),
    ('executivo','Inspetor-Geral','militar','Tenente',NULL),
    ('executivo','Inspetor','militar','Tenente',NULL),
    ('executivo','Supervisor-Geral','militar','Aspirante a Oficial',NULL),
    ('executivo','Supervisor','militar','Aspirante a Oficial',NULL),
    -- Executivo -> Executivo (Seção II, Art. 2º)
    ('executivo','Chanceler','executivo','Acionista Majoritário',NULL),
    ('executivo','Acionista Majoritário','executivo','Presidente',NULL),
    ('executivo','Presidente','executivo','Vice-Presidente',NULL),
    ('executivo','Vice-Presidente','executivo','VIP',NULL),
    ('executivo','VIP','executivo','Superintendente-Geral',NULL),
    ('executivo','Superintendente-Geral','executivo','Superintendente',NULL),
    ('executivo','Superintendente','executivo','Coordenador-Geral',NULL),
    ('executivo','Coordenador-Geral','executivo','Coordenador',NULL),
    ('executivo','Coordenador','executivo','Inspetor-Geral',NULL),
    ('executivo','Inspetor-Geral','executivo','Inspetor',NULL),
    ('executivo','Inspetor','executivo','Supervisor-Geral',NULL),
    ('executivo','Supervisor-Geral','executivo','Supervisor',NULL)
)
INSERT INTO diretrizes_hierarquia (patente_origem_id, acao, patente_limite_id, requer_pro_ou_cfo, observacao)
SELECT po.id, a.acao, pl.id, 1, p.obs
FROM pares p
JOIN acoes a
JOIN patentes po ON po.corpo = p.corpo_origem AND po.nome = p.nome_origem
JOIN patentes pl ON pl.corpo = p.corpo_limite AND pl.nome = p.nome_limite;
