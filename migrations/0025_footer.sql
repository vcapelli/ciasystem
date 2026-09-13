-- =====================================================================
-- FOOTER DO SISTEMA
-- =====================================================================
-- A maior parte do conteúdo do footer (estilo, nome do sistema, frase
-- em HTML, imagem/alinhamento do estilo 2, texto simples, versão) usa
-- a tabela `configuracoes_sistema` que já existe — chave/valor livre,
-- sem precisar de migration nova pra cada campo. Só as duas listas
-- ordenáveis (links úteis e redes sociais) precisam de tabela própria.
-- =====================================================================

CREATE TABLE footer_links (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo    TEXT NOT NULL,
    url       TEXT NOT NULL,
    ordem     INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE footer_redes_sociais (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nome      TEXT NOT NULL,
    url       TEXT NOT NULL,
    icone     TEXT, -- classe FontAwesome, ex: 'fa-brands fa-discord'
    ordem     INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Rastreamento leve de "quem está online agora" — atualizado por um
-- heartbeat do frontend, não em toda requisição (evita gravar demais).
ALTER TABLE usuarios ADD COLUMN ultimo_acesso_em TEXT;

-- Valores iniciais de configuração do footer.
INSERT INTO configuracoes_sistema (chave, valor) VALUES
  ('footer_estilo', 'estilo1'),
  ('nome_sistema', 'CIASystem'),
  ('versao_sistema', '1.9.1');
