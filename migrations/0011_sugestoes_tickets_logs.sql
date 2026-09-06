-- =====================================================================
-- FASE 9 — SUGESTÕES, TICKETS DE SUPORTE, LOGS DE EVENTOS
-- =====================================================================
-- Depende das Fases 1-8.
-- =====================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE sugestoes (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    autor_id            INTEGER NOT NULL REFERENCES usuarios(id),
    titulo              TEXT NOT NULL,
    descricao           TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovada','rejeitada')),
    decidido_por_id     INTEGER REFERENCES usuarios(id),
    decidido_em         TEXT,
    motivo_decisao      TEXT,
    criado_em           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_sugestoes_status ON sugestoes(status);
CREATE INDEX idx_sugestoes_autor ON sugestoes(autor_id);

CREATE TABLE tickets_suporte (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    autor_id            INTEGER NOT NULL REFERENCES usuarios(id),
    titulo              TEXT NOT NULL,
    descricao           TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','em_andamento','encerrado')),
    encerrado_por_id    INTEGER REFERENCES usuarios(id),
    encerrado_em        TEXT,
    criado_em           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_tickets_suporte_autor ON tickets_suporte(autor_id);
CREATE INDEX idx_tickets_suporte_status ON tickets_suporte(status);

CREATE TABLE ticket_mensagens (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id           INTEGER NOT NULL REFERENCES tickets_suporte(id) ON DELETE CASCADE,
    autor_id            INTEGER NOT NULL REFERENCES usuarios(id),
    conteudo            TEXT NOT NULL,
    criado_em           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_ticket_mensagens_ticket ON ticket_mensagens(ticket_id);

CREATE TABLE logs_eventos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id      INTEGER REFERENCES usuarios(id),
    tipo_evento     TEXT NOT NULL,
    referencia_tipo TEXT,
    referencia_id   INTEGER,
    ip              TEXT,
    user_agent      TEXT,
    detalhes        TEXT,
    criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_logs_eventos_usuario ON logs_eventos(usuario_id);
CREATE INDEX idx_logs_eventos_ip ON logs_eventos(ip);
CREATE INDEX idx_logs_eventos_tipo ON logs_eventos(tipo_evento);
CREATE INDEX idx_logs_eventos_referencia ON logs_eventos(referencia_tipo, referencia_id);
