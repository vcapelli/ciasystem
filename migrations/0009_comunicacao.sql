-- =====================================================================
-- FASE 7 — COMUNICAÇÃO (e-mails, notícias, notificações)
-- =====================================================================
-- Depende das Fases 1-6.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- --- E-mails entre usuários ---

CREATE TABLE mensagens (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    remetente_id    INTEGER NOT NULL REFERENCES usuarios(id), -- pode ser uma conta_oficial
    operado_por_id  INTEGER REFERENCES usuarios(id), -- quem operou de fato, se remetente_id é conta_oficial
    assunto         TEXT NOT NULL,
    corpo           TEXT NOT NULL,
    enviado_em      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    apagado_pelo_remetente INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE mensagem_destinatarios (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    mensagem_id     INTEGER NOT NULL REFERENCES mensagens(id) ON DELETE CASCADE,
    destinatario_id INTEGER NOT NULL REFERENCES usuarios(id),
    lido_em         TEXT,
    arquivado       INTEGER NOT NULL DEFAULT 0,
    apagado         INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_mensagens_remetente ON mensagens(remetente_id);
CREATE INDEX idx_mensagem_destinatarios_destinatario ON mensagem_destinatarios(destinatario_id);
CREATE INDEX idx_mensagem_destinatarios_mensagem ON mensagem_destinatarios(mensagem_id);

-- --- Notícias globais ---

CREATE TABLE noticias_permissoes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id      INTEGER REFERENCES usuarios(id),
    grupo_id        INTEGER REFERENCES grupos(id),
    pode_escrever   INTEGER NOT NULL DEFAULT 0,
    pode_publicar   INTEGER NOT NULL DEFAULT 0,
    definido_por_id INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    CHECK ((usuario_id IS NOT NULL AND grupo_id IS NULL) OR (usuario_id IS NULL AND grupo_id IS NOT NULL))
);

CREATE TABLE noticias (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo              TEXT NOT NULL,
    resumo              TEXT,
    conteudo            TEXT NOT NULL,
    imagem_capa_url     TEXT,
    autor_id            INTEGER NOT NULL REFERENCES usuarios(id),
    operado_por_id      INTEGER REFERENCES usuarios(id),
    status              TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','publicada','arquivada')),
    publicado_por_id    INTEGER REFERENCES usuarios(id),
    publicado_em        TEXT,
    criado_em           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    atualizado_em       TEXT
);

CREATE INDEX idx_noticias_status ON noticias(status);

-- --- Notícias de grupo (mesmo padrão de grupo_registros/grupo_aulas:
-- gerido por usuario_grupos.administrador_grupo, sem tabela de
-- permissão própria) ---

CREATE TABLE grupo_noticias (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    grupo_id        INTEGER NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
    titulo          TEXT NOT NULL,
    conteudo        TEXT NOT NULL,
    autor_id        INTEGER NOT NULL REFERENCES usuarios(id),
    operado_por_id  INTEGER REFERENCES usuarios(id),
    status          TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','publicada','arquivada')),
    publicado_em    TEXT,
    criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    atualizado_em   TEXT
);

CREATE INDEX idx_grupo_noticias_grupo ON grupo_noticias(grupo_id);

-- --- Notificações (genérica/polimórfica) ---

CREATE TABLE notificacoes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
    tipo            TEXT NOT NULL CHECK (tipo IN (
                        'mensagem','noticia','noticia_grupo','tweet_resposta',
                        'tweet_curtida','tweet_retweet','tweet_mencao',
                        'seguidor_novo','requerimento_status','documento_revisao',
                        'emblema_recebido','conquista_alcancada','sistema'
                    )),
    titulo          TEXT NOT NULL,
    corpo           TEXT,
    referencia_tipo TEXT,
    referencia_id   INTEGER,
    lido_em         TEXT,
    criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_notificacoes_usuario ON notificacoes(usuario_id);
CREATE INDEX idx_notificacoes_usuario_lido ON notificacoes(usuario_id, lido_em);
