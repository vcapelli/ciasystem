-- =====================================================================
-- FASE 2b — AJUSTE: requerimento_alvos suporta alvo "ainda não existe"
-- =====================================================================
-- Descoberta: existem 3 portas de entrada no RPG (seção 3 do doc-mestre)
-- — Instrução Inicial, Contratação, Compra de Cargo — e nas duas
-- primeiras o "alvo" do requerimento é só um nick do Habblet, SEM
-- conta ainda em `usuarios`. O desenho original de requerimento_alvos
-- (usuario_id NOT NULL) não suporta isso.
--
-- IMPORTANTE (D1 + SQLite): D1 nunca permite `PRAGMA foreign_keys =
-- OFF` (sempre enforça). `PRAGMA defer_foreign_keys = true` adia a
-- checagem de LINHAS até o fim da transação, mas NÃO adia a checagem
-- de schema que impede `DROP TABLE` numa tabela ainda referenciada
-- por FK de outra — essa checagem acontece na hora, sempre. Como
-- `historico.requerimento_alvo_id` referencia `requerimento_alvos`,
-- não dá pra recriar `requerimento_alvos` direto.
--
-- Solução: recriar `historico` primeiro, removendo o FK de
-- `requerimento_alvo_id` (vira uma referência "solta", sem
-- constraint — aceitável aqui, já que `historico` é um log de
-- auditoria, não uma entidade transacional crítica). Com isso,
-- nenhuma tabela mais referencia `requerimento_alvos`, e ela pode
-- ser recriada livremente com `usuario_id` opcional + `nick_alvo`.
-- =====================================================================

PRAGMA defer_foreign_keys = true;

-- Passo 1: historico perde o FK em requerimento_alvo_id (mantém a coluna,
-- só sem a constraint de referência).
CREATE TABLE historico_new (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
    tipo_acao           TEXT NOT NULL,
    requerimento_id     INTEGER REFERENCES requerimentos(id),
    requerimento_alvo_id INTEGER,  -- sem FK: só referência informativa, não enforçada
    executado_por_id    INTEGER NOT NULL REFERENCES usuarios(id),
    detalhes            TEXT,
    data                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    cancelado           INTEGER NOT NULL DEFAULT 0,
    cancelado_em        TEXT,
    cancelado_por_id    INTEGER REFERENCES usuarios(id)
);

INSERT INTO historico_new
SELECT id, usuario_id, tipo_acao, requerimento_id, requerimento_alvo_id, executado_por_id, detalhes, data, cancelado, cancelado_em, cancelado_por_id
FROM historico;

DROP TABLE historico;
ALTER TABLE historico_new RENAME TO historico;

CREATE INDEX idx_historico_usuario ON historico(usuario_id);

-- Passo 2: agora nada mais referencia requerimento_alvos — recria livremente.
CREATE TABLE requerimento_alvos_new (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    requerimento_id     INTEGER NOT NULL REFERENCES requerimentos(id) ON DELETE CASCADE,
    usuario_id          INTEGER REFERENCES usuarios(id),  -- NULL quando o alvo ainda não tem conta
    nick_alvo           TEXT,                              -- preenchido no lugar de usuario_id nesse caso
    status              TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','reprovado','cancelado')),
    decidido_em         TEXT,
    decidido_por_id     INTEGER REFERENCES usuarios(id),
    motivo_recusa       TEXT,
    UNIQUE (requerimento_id, usuario_id),
    UNIQUE (requerimento_id, nick_alvo),
    CHECK (usuario_id IS NOT NULL OR nick_alvo IS NOT NULL)
);

INSERT INTO requerimento_alvos_new (id, requerimento_id, usuario_id, status, decidido_em, decidido_por_id, motivo_recusa)
SELECT id, requerimento_id, usuario_id, status, decidido_em, decidido_por_id, motivo_recusa
FROM requerimento_alvos;

DROP TABLE requerimento_alvos;
ALTER TABLE requerimento_alvos_new RENAME TO requerimento_alvos;

CREATE INDEX idx_requerimento_alvos_requerimento ON requerimento_alvos(requerimento_id);
CREATE INDEX idx_requerimento_alvos_usuario ON requerimento_alvos(usuario_id);
