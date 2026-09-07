-- =====================================================================
-- REFRESH TOKENS — sessões de longa duração
-- =====================================================================
-- O token de acesso (JWT) passa a durar só 1h. Pra não exigir login
-- de novo toda hora, o refresh token (opaco, alta entropia, guardado
-- só como hash — nunca em texto plano) permite pedir um token de
-- acesso novo sem repetir login/senha, e pode ser revogado
-- individualmente (logout) ou em massa (logout de todos os
-- dispositivos), diferente de um JWT puro que não dá pra revogar
-- antes de expirar.
-- =====================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE refresh_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
    token_hash  TEXT NOT NULL UNIQUE,
    criado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    expira_em   TEXT NOT NULL,
    revogado    INTEGER NOT NULL DEFAULT 0,
    user_agent  TEXT,
    ip          TEXT
);

CREATE INDEX idx_refresh_tokens_usuario ON refresh_tokens(usuario_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
