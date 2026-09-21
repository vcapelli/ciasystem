-- =====================================================================
-- NOVO TIPO DE REQUERIMENTO: 'integracao'
-- =====================================================================
-- Requerimento exclusivo de administrador do sistema (checado em
-- src/routes/requerimentos.ts, não aqui) pra migrar pro CIASystem
-- alguém que já está na organização há tempo, vindo do fluxo manual
-- antigo (planilha/OpenSheets) — é uma porta de entrada igual
-- 'contratacao', mas além de nick + patente/cargo destino também
-- aceita definir a TAG da pessoa e uma DATA histórica (data de
-- ingresso / último ato funcional), pra não resetar o tempo de
-- serviço já cumprido no sistema antigo (ver seção 6 do doc-mestre —
-- promoções dependem de dias corridos desde o último ato funcional).
--
-- IMPORTANTE (D1 + SQLite, mesmo caso do padrão em
-- 0004_ajuste_requerimento_alvos.sql): não dá pra fazer
-- "ALTER TABLE ... DROP/ADD CONSTRAINT" — pra adicionar um valor novo
-- no CHECK (tipo IN (...)) de `requerimentos` é preciso recriar a
-- tabela. E como `requerimento_alvos`, `requerimento_anexos` e
-- `historico` têm FK pra `requerimentos(id)`, e D1 sempre enforça a
-- checagem de schema no DROP TABLE (mesmo com `defer_foreign_keys`,
-- que só adia a checagem de LINHAS, não a de schema), a ordem tem que
-- ser: primeiro tirar essas 3 tabelas do caminho (recriando-as sem a
-- FK), depois recriar `requerimentos`, depois recriar
-- `requerimento_alvos`/`requerimento_anexos` de novo já apontando pra
-- `requerimentos` (nova) com a FK (e o ON DELETE CASCADE) de volta.
-- `historico` já era uma referência solta desde 0004 (log de
-- auditoria) — aproveita e também tira a FK de `requerimento_id` de
-- vez, pra não precisar recriá-la de novo depois.
-- =====================================================================

PRAGMA defer_foreign_keys = true;

-- Passo 1: historico perde de vez a FK em requerimento_id (mesma
-- lógica já aplicada a requerimento_alvo_id em 0004 — log de
-- auditoria, referência informativa basta).
CREATE TABLE historico_novo (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
    tipo_acao           TEXT NOT NULL,
    requerimento_id     INTEGER,  -- sem FK: só referência informativa, não enforçada
    requerimento_alvo_id INTEGER,  -- idem (já era assim desde 0004)
    executado_por_id    INTEGER NOT NULL REFERENCES usuarios(id),
    detalhes            TEXT,
    data                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    cancelado           INTEGER NOT NULL DEFAULT 0,
    cancelado_em        TEXT,
    cancelado_por_id    INTEGER REFERENCES usuarios(id)
);

INSERT INTO historico_novo
SELECT id, usuario_id, tipo_acao, requerimento_id, requerimento_alvo_id, executado_por_id, detalhes, data, cancelado, cancelado_em, cancelado_por_id
FROM historico;

DROP TABLE historico;
ALTER TABLE historico_novo RENAME TO historico;
CREATE INDEX idx_historico_usuario ON historico(usuario_id);

-- Passo 2: requerimento_anexos perde a FK temporariamente (é
-- recriada de novo no passo 5, já com a FK pra requerimentos nova).
CREATE TABLE requerimento_anexos_temp (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    requerimento_id INTEGER NOT NULL,
    url             TEXT NOT NULL,
    ordem           INTEGER NOT NULL DEFAULT 0
);

INSERT INTO requerimento_anexos_temp SELECT id, requerimento_id, url, ordem FROM requerimento_anexos;

DROP TABLE requerimento_anexos;
ALTER TABLE requerimento_anexos_temp RENAME TO requerimento_anexos;

-- Passo 3: requerimento_alvos perde a FK temporariamente, mesma ideia
-- (mantém toda a estrutura de 0004 — usuario_id opcional + nick_alvo).
CREATE TABLE requerimento_alvos_temp (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    requerimento_id     INTEGER NOT NULL,
    usuario_id          INTEGER REFERENCES usuarios(id),
    nick_alvo           TEXT,
    status              TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','reprovado','cancelado')),
    decidido_em         TEXT,
    decidido_por_id     INTEGER REFERENCES usuarios(id),
    motivo_recusa       TEXT,
    UNIQUE (requerimento_id, usuario_id),
    UNIQUE (requerimento_id, nick_alvo),
    CHECK (usuario_id IS NOT NULL OR nick_alvo IS NOT NULL)
);

INSERT INTO requerimento_alvos_temp (id, requerimento_id, usuario_id, nick_alvo, status, decidido_em, decidido_por_id, motivo_recusa)
SELECT id, requerimento_id, usuario_id, nick_alvo, status, decidido_em, decidido_por_id, motivo_recusa
FROM requerimento_alvos;

DROP TABLE requerimento_alvos;
ALTER TABLE requerimento_alvos_temp RENAME TO requerimento_alvos;

-- Passo 4: nada mais referencia `requerimentos` — recria com
-- 'integracao' no CHECK do tipo. Colunas = 0002 + forum_topico_id
-- (0005) + tag_grupo_override/operado_por_id (0036).
CREATE TABLE requerimentos_novo (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo                TEXT NOT NULL CHECK (tipo IN (
                            'instrucao_inicial','promocao','rebaixamento','advertencia',
                            'licenca','volta_licenca','reserva','transferencia_conta','transferencia_corpo',
                            'venda_cargo','contratacao','integracao','tag','turno_tarefa','reforma',
                            'desligamento_honroso','desligamento_desonroso','exoneracao',
                            'bonificacao','cancelamento'
                        )),
    autor_id            INTEGER NOT NULL REFERENCES usuarios(id),
    status              TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','reprovado','cancelado')),
    tag_requerimento    TEXT NOT NULL UNIQUE,
    dados_especificos   TEXT,
    crime_id            INTEGER REFERENCES crimes(id),
    fundamentacao       TEXT,
    autorizado_por_id   INTEGER REFERENCES usuarios(id),
    tag_aplicada        TEXT,
    criado_em           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    decidido_em         TEXT,
    decidido_por_id     INTEGER REFERENCES usuarios(id),
    motivo_recusa       TEXT,
    forum_topico_id     INTEGER REFERENCES forum_topicos(id),
    tag_grupo_override  TEXT,
    operado_por_id      INTEGER REFERENCES usuarios(id)
);

INSERT INTO requerimentos_novo
SELECT id, tipo, autor_id, status, tag_requerimento, dados_especificos, crime_id, fundamentacao,
       autorizado_por_id, tag_aplicada, criado_em, decidido_em, decidido_por_id, motivo_recusa,
       forum_topico_id, tag_grupo_override, operado_por_id
FROM requerimentos;

DROP TABLE requerimentos;
ALTER TABLE requerimentos_novo RENAME TO requerimentos;
CREATE INDEX idx_requerimentos_status ON requerimentos(status);
CREATE INDEX idx_requerimentos_autor ON requerimentos(autor_id);

-- Passo 5: recria requerimento_anexos e requerimento_alvos de novo,
-- agora com a FK (e o ON DELETE CASCADE) de volta, apontando pra
-- `requerimentos` já recriada.
CREATE TABLE requerimento_anexos_novo (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    requerimento_id INTEGER NOT NULL REFERENCES requerimentos(id) ON DELETE CASCADE,
    url             TEXT NOT NULL,
    ordem           INTEGER NOT NULL DEFAULT 0
);

INSERT INTO requerimento_anexos_novo SELECT id, requerimento_id, url, ordem FROM requerimento_anexos;

DROP TABLE requerimento_anexos;
ALTER TABLE requerimento_anexos_novo RENAME TO requerimento_anexos;
CREATE INDEX idx_requerimento_anexos_requerimento ON requerimento_anexos(requerimento_id);

CREATE TABLE requerimento_alvos_novo (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    requerimento_id     INTEGER NOT NULL REFERENCES requerimentos(id) ON DELETE CASCADE,
    usuario_id          INTEGER REFERENCES usuarios(id),
    nick_alvo           TEXT,
    status              TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','reprovado','cancelado')),
    decidido_em         TEXT,
    decidido_por_id     INTEGER REFERENCES usuarios(id),
    motivo_recusa       TEXT,
    UNIQUE (requerimento_id, usuario_id),
    UNIQUE (requerimento_id, nick_alvo),
    CHECK (usuario_id IS NOT NULL OR nick_alvo IS NOT NULL)
);

INSERT INTO requerimento_alvos_novo (id, requerimento_id, usuario_id, nick_alvo, status, decidido_em, decidido_por_id, motivo_recusa)
SELECT id, requerimento_id, usuario_id, nick_alvo, status, decidido_em, decidido_por_id, motivo_recusa
FROM requerimento_alvos;

DROP TABLE requerimento_alvos;
ALTER TABLE requerimento_alvos_novo RENAME TO requerimento_alvos;
CREATE INDEX idx_requerimento_alvos_requerimento ON requerimento_alvos(requerimento_id);
CREATE INDEX idx_requerimento_alvos_usuario ON requerimento_alvos(usuario_id);

-- Passo 6: mesmo CHECK novo em requerimentos_permissoes.tipo (tabela
-- folha, nada referencia ela — rebuild simples). Permite, no futuro,
-- delegar cancelamento de 'integracao' pra alguém além do admin do
-- sistema (a criação continua exclusiva de admin, isso é checado só
-- no Worker).
CREATE TABLE requerimentos_permissoes_novo (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id      INTEGER REFERENCES usuarios(id),
    grupo_id        INTEGER REFERENCES grupos(id),
    tipo            TEXT CHECK (tipo IS NULL OR tipo IN (
                        'instrucao_inicial','promocao','rebaixamento','advertencia',
                        'licenca','volta_licenca','reserva','transferencia_conta','transferencia_corpo',
                        'venda_cargo','contratacao','integracao','tag','turno_tarefa','reforma',
                        'desligamento_honroso','desligamento_desonroso','exoneracao',
                        'bonificacao','cancelamento'
                    )),
    pode_aprovar    INTEGER NOT NULL DEFAULT 0,
    pode_cancelar   INTEGER NOT NULL DEFAULT 0,
    definido_por_id INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    CHECK ((usuario_id IS NOT NULL AND grupo_id IS NULL) OR (usuario_id IS NULL AND grupo_id IS NOT NULL))
);

INSERT INTO requerimentos_permissoes_novo
SELECT id, usuario_id, grupo_id, tipo, pode_aprovar, pode_cancelar, definido_por_id, criado_em
FROM requerimentos_permissoes;

DROP TABLE requerimentos_permissoes;
ALTER TABLE requerimentos_permissoes_novo RENAME TO requerimentos_permissoes;
CREATE INDEX idx_requerimentos_permissoes_usuario ON requerimentos_permissoes(usuario_id);
CREATE INDEX idx_requerimentos_permissoes_grupo ON requerimentos_permissoes(grupo_id);
CREATE INDEX idx_requerimentos_permissoes_tipo ON requerimentos_permissoes(tipo);
