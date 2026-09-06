-- =====================================================================
-- FASE 8 — MINI TWITTER
-- =====================================================================
-- Depende das Fases 1-7 (usa `usuarios` e `notificar()` de Comunicação).
-- =====================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE seguidores (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    seguidor_id     INTEGER NOT NULL REFERENCES usuarios(id),
    seguido_id      INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (seguidor_id, seguido_id),
    CHECK (seguidor_id <> seguido_id)
);

CREATE INDEX idx_seguidores_seguidor ON seguidores(seguidor_id);
CREATE INDEX idx_seguidores_seguido ON seguidores(seguido_id);

CREATE TABLE tweets (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    autor_id            INTEGER NOT NULL REFERENCES usuarios(id),
    operado_por_id      INTEGER REFERENCES usuarios(id),
    conteudo            TEXT,
    resposta_a_id       INTEGER REFERENCES tweets(id),
    tweet_original_id   INTEGER REFERENCES tweets(id),
    criado_em           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    apagado             INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_tweets_autor ON tweets(autor_id);
CREATE INDEX idx_tweets_resposta_a ON tweets(resposta_a_id);
CREATE INDEX idx_tweets_original ON tweets(tweet_original_id);

CREATE TABLE tweet_midias (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tweet_id    INTEGER NOT NULL REFERENCES tweets(id) ON DELETE CASCADE,
    tipo        TEXT NOT NULL CHECK (tipo IN ('imagem','gif')),
    url         TEXT NOT NULL,
    ordem       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_tweet_midias_tweet ON tweet_midias(tweet_id);

CREATE TABLE tweet_curtidas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tweet_id    INTEGER NOT NULL REFERENCES tweets(id) ON DELETE CASCADE,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (tweet_id, usuario_id)
);

CREATE INDEX idx_tweet_curtidas_tweet ON tweet_curtidas(tweet_id);
CREATE INDEX idx_tweet_curtidas_usuario ON tweet_curtidas(usuario_id);

CREATE TABLE tweet_enquetes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tweet_id    INTEGER NOT NULL UNIQUE REFERENCES tweets(id) ON DELETE CASCADE,
    expira_em   TEXT NOT NULL
);

CREATE TABLE tweet_enquete_opcoes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    enquete_id  INTEGER NOT NULL REFERENCES tweet_enquetes(id) ON DELETE CASCADE,
    texto       TEXT NOT NULL,
    ordem       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_tweet_enquete_opcoes_enquete ON tweet_enquete_opcoes(enquete_id);

CREATE TABLE tweet_enquete_votos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    enquete_id  INTEGER NOT NULL REFERENCES tweet_enquetes(id) ON DELETE CASCADE,
    opcao_id    INTEGER NOT NULL REFERENCES tweet_enquete_opcoes(id) ON DELETE CASCADE,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (enquete_id, usuario_id)
);

CREATE INDEX idx_tweet_enquete_votos_opcao ON tweet_enquete_votos(opcao_id);
