-- Quem pode ver a listagem de usuários com IP (além do admin do
-- sistema, que sempre pode). Allowlist simples.
CREATE TABLE ip_listagem_permissoes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id      INTEGER NOT NULL UNIQUE REFERENCES usuarios(id),
    definido_por_id INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
