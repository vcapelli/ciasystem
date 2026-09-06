-- =====================================================================
-- FASE 4 — RECONHECIMENTO (cursos, certificados, medalhas, emblemas,
-- honrarias, conquistas)
-- =====================================================================
-- Depende das Fases 1-3. `cursos` já existe desde a Fase 1 (era
-- necessária lá pra requisitos_promocao_cursos).
-- =====================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE historico_cursos (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id          INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    curso_id            INTEGER NOT NULL REFERENCES cursos(id),
    data_conclusao      TEXT NOT NULL,
    certificado_por_id  INTEGER REFERENCES usuarios(id)
);

CREATE INDEX idx_historico_cursos_usuario ON historico_cursos(usuario_id);

-- Certificados especiais com validade/expiração (CFO, CQ/AQOI, CCJ) —
-- separados de historico_cursos porque têm regra própria de perda por
-- inatividade (seção 11 do doc-mestre).
CREATE TABLE certificados (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id          INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo                TEXT NOT NULL CHECK (tipo IN ('CFO','CQ','CCJ')),
    concedido_por_id    INTEGER REFERENCES usuarios(id),
    data_concessao      TEXT NOT NULL,
    valido_ate          TEXT,
    ativo               INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_certificados_usuario ON certificados(usuario_id);

CREATE TABLE medalhas (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
    tipo                TEXT NOT NULL CHECK (tipo IN ('temporaria','efetiva','honraria_particular','honra')),
    motivo              TEXT NOT NULL,
    quantidade          INTEGER NOT NULL DEFAULT 1,
    concedida_por_id    INTEGER NOT NULL REFERENCES usuarios(id),
    data_concessao      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    expira_em           TEXT
);

CREATE INDEX idx_medalhas_usuario ON medalhas(usuario_id);

CREATE TABLE soldo_pagamentos (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
    referencia_mes      TEXT NOT NULL,
    dias_ativos         INTEGER NOT NULL,
    valor_raros         REAL NOT NULL,
    pago_em             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (usuario_id, referencia_mes)
);

-- --- Emblemas ---

CREATE TABLE emblemas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo          TEXT NOT NULL,
    descricao       TEXT,
    imagem_url      TEXT NOT NULL,
    criado_por_id   INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    ativo           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE usuario_emblemas (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    emblema_id          INTEGER NOT NULL REFERENCES emblemas(id),
    usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
    concedido_por_id    INTEGER NOT NULL REFERENCES usuarios(id),
    concedido_em        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    motivo              TEXT,
    origem_grupo_id     INTEGER REFERENCES grupos(id),
    UNIQUE (emblema_id, usuario_id)
);

CREATE INDEX idx_usuario_emblemas_usuario ON usuario_emblemas(usuario_id);

-- --- Honrarias (mesma estrutura de emblemas) ---

CREATE TABLE honrarias (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo          TEXT NOT NULL,
    descricao       TEXT,
    imagem_url      TEXT NOT NULL,
    criado_por_id   INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    ativo           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE usuario_honrarias (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    honraria_id         INTEGER NOT NULL REFERENCES honrarias(id),
    usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
    concedido_por_id    INTEGER NOT NULL REFERENCES usuarios(id),
    concedido_em        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    motivo              TEXT,
    origem_grupo_id     INTEGER REFERENCES grupos(id),
    UNIQUE (honraria_id, usuario_id)
);

CREATE INDEX idx_usuario_honrarias_usuario ON usuario_honrarias(usuario_id);

-- --- Conquistas ---

CREATE TABLE conquistas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo          TEXT NOT NULL,
    descricao       TEXT,
    imagem_url      TEXT NOT NULL,
    tipo_criterio   TEXT NOT NULL CHECK (tipo_criterio IN (
                        'tempo_cadastro_meses','tempo_policia_meses','tempo_patente_meses',
                        'contagem_postagens','contagem_promocoes','contagem_cursos',
                        'contagem_medalhas','manual'
                    )),
    valor_criterio  INTEGER NOT NULL,
    criado_por_id   INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    ativo           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE usuario_conquistas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conquista_id    INTEGER NOT NULL REFERENCES conquistas(id),
    usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
    alcancado_em    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    valor_atingido  INTEGER NOT NULL,
    UNIQUE (conquista_id, usuario_id)
);

CREATE INDEX idx_usuario_conquistas_usuario ON usuario_conquistas(usuario_id);
