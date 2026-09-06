-- =====================================================================
-- FASE 3 — FÓRUM PRÓPRIO, MENU DE NAVEGAÇÃO, PÁGINAS CUSTOMIZADAS
-- =====================================================================
-- Depende das Fases 1 e 2 já aplicadas (usuarios, grupos, patentes,
-- requerimentos). Ordem de criação respeita as dependências:
--   1) conta_oficial_operadores (usuarios.tipo='conta_oficial' já
--      existe desde a Fase 1 — só faltava a tabela de autorização)
--   2) módulo de fórum (categorias → tópicos → posts → anexos → permissões)
--   3) ALTER em requerimentos, ligando ao tópico interno gerado
--   4) páginas customizadas (independente)
--   5) menu de navegação (depende de páginas customizadas, pra poder
--      apontar um item de menu direto pra uma página interna)
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- 1. CONTAS OFICIAIS: quem pode operar
-- ---------------------------------------------------------------------

-- Quem pode "vestir" uma conta oficial (Administração, Setor Técnico
-- etc.) pra publicar em nome dela — concedido individualmente pelos
-- administradores do sistema, N:N.
CREATE TABLE conta_oficial_operadores (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    conta_id            INTEGER NOT NULL REFERENCES usuarios(id), -- a conta oficial (usuarios.tipo = 'conta_oficial')
    usuario_id          INTEGER NOT NULL REFERENCES usuarios(id), -- o jogador real autorizado a operá-la
    concedido_por_id    INTEGER NOT NULL REFERENCES usuarios(id), -- admin do sistema que autorizou
    criado_em           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (conta_id, usuario_id)
);

CREATE INDEX idx_conta_oficial_operadores_conta ON conta_oficial_operadores(conta_id);
CREATE INDEX idx_conta_oficial_operadores_usuario ON conta_oficial_operadores(usuario_id);

-- ---------------------------------------------------------------------
-- 2. MÓDULO DE FÓRUM PRÓPRIO
-- ---------------------------------------------------------------------

CREATE TABLE forum_categorias (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    nome                TEXT NOT NULL,
    descricao           TEXT,
    categoria_pai_id    INTEGER REFERENCES forum_categorias(id), -- permite subcategorias
    ordem               INTEGER NOT NULL DEFAULT 0,
    ativo               INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE forum_topicos (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    categoria_id        INTEGER NOT NULL REFERENCES forum_categorias(id),
    titulo              TEXT NOT NULL,
    autor_id            INTEGER NOT NULL REFERENCES usuarios(id),
    requerimento_id     INTEGER REFERENCES requerimentos(id), -- preenchido quando o tópico nasce automaticamente de um requerimento
    fixado              INTEGER NOT NULL DEFAULT 0,
    trancado            INTEGER NOT NULL DEFAULT 0,
    visualizacoes       INTEGER NOT NULL DEFAULT 0,
    criado_em           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    atualizado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_forum_topicos_categoria ON forum_topicos(categoria_id);
CREATE INDEX idx_forum_topicos_requerimento ON forum_topicos(requerimento_id);

CREATE TABLE forum_posts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    topico_id           INTEGER NOT NULL REFERENCES forum_topicos(id) ON DELETE CASCADE,
    autor_id            INTEGER NOT NULL REFERENCES usuarios(id), -- pode ser uma conta_oficial
    operado_por_id      INTEGER REFERENCES usuarios(id), -- preenchido quando autor_id é conta_oficial: quem operou de fato
    conteudo            TEXT NOT NULL,          -- BBCode ou HTML sanitizado, decisão de frontend
    criado_em           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    editado_em          TEXT,
    editado_por_id      INTEGER REFERENCES usuarios(id)
);

CREATE INDEX idx_forum_posts_topico ON forum_posts(topico_id);

CREATE TABLE forum_anexos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id     INTEGER NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    tipo        TEXT
);

-- Controle de acesso por categoria: quem pode ler/postar/moderar.
CREATE TABLE forum_permissoes (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    categoria_id        INTEGER NOT NULL REFERENCES forum_categorias(id) ON DELETE CASCADE,
    grupo_id            INTEGER REFERENCES grupos(id),        -- NULL = não restringe por grupo
    patente_minima_id   INTEGER REFERENCES patentes(id),      -- NULL = não restringe por patente
    pode_ler            INTEGER NOT NULL DEFAULT 1,
    pode_postar         INTEGER NOT NULL DEFAULT 1,
    pode_moderar        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_forum_permissoes_categoria ON forum_permissoes(categoria_id);

-- Liga o requerimento ao tópico interno gerado automaticamente pra
-- ele (substitui o antigo vínculo com Forumeiros externo).
ALTER TABLE requerimentos ADD COLUMN forum_topico_id INTEGER REFERENCES forum_topicos(id);

-- ---------------------------------------------------------------------
-- 3. PÁGINAS HTML CUSTOMIZADAS
-- ---------------------------------------------------------------------

-- Administradores criam páginas HTML sob medida, com nome e caminho
-- próprios (a URL final é algo como /p/{caminho}). Dois modos:
--   - 'independente': HTML puro, sem o CSS/layout do sistema.
--   - 'dependente': renderiza dentro do layout do sistema.
CREATE TABLE paginas_customizadas (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo              TEXT NOT NULL,
    caminho             TEXT NOT NULL UNIQUE,  -- vira a URL: /p/{caminho}
    tipo                TEXT NOT NULL CHECK (tipo IN ('independente','dependente')),
    conteudo_html       TEXT NOT NULL,
    publica             INTEGER NOT NULL DEFAULT 0,
    grupo_restrito_id   INTEGER REFERENCES grupos(id),
    patente_minima_id   INTEGER REFERENCES patentes(id),
    ativo               INTEGER NOT NULL DEFAULT 1,
    criado_por_id       INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    atualizado_em       TEXT,
    atualizado_por_id   INTEGER REFERENCES usuarios(id)
);

CREATE INDEX idx_paginas_customizadas_caminho ON paginas_customizadas(caminho);

-- ---------------------------------------------------------------------
-- 4. MENU DE NAVEGAÇÃO
-- ---------------------------------------------------------------------

-- Estrutura em árvore (item_pai_id aponta pra si mesma) pra suportar
-- submenus. Administradores do sistema criam/editam/removem
-- livremente, com restrição opcional por grupo e/ou patente mínima.
CREATE TABLE menu_itens (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo                  TEXT NOT NULL,
    url                     TEXT,           -- link externo/manual; NULL se apontar pra pagina_customizada_id ou só agrupar submenus
    pagina_customizada_id   INTEGER REFERENCES paginas_customizadas(id), -- alternativa a `url`
    icone                   TEXT,
    item_pai_id             INTEGER REFERENCES menu_itens(id),
    ordem                   INTEGER NOT NULL DEFAULT 0,
    grupo_restrito_id       INTEGER REFERENCES grupos(id),
    patente_minima_id       INTEGER REFERENCES patentes(id),
    ativo                   INTEGER NOT NULL DEFAULT 1,
    criado_por_id           INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    atualizado_em           TEXT
);

CREATE INDEX idx_menu_itens_pai ON menu_itens(item_pai_id);
