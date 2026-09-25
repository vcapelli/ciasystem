-- =====================================================================
-- NOVO TIPO DE REQUERIMENTO: 'convidado' + flag usuarios.eh_convidado
-- =====================================================================
-- Convidado é um 3º "jeito de existir" no sistema, ao lado de
-- jogador (Corpo Militar/Executivo) e conta_oficial (institucional):
-- gente que não faz parte da hierarquia — sem patente, sem corpo, sem
-- "dias no posto"/"dias na polícia" — só uma conta com nick e status.
--
-- Um único tipo de requerimento ('convidado') cobre as duas pontas
-- (dados_especificos.acao = 'inclusao' | 'exclusao'), decidido em
-- src/services/efeitos.ts:
--   - inclusao: cria a conta (usuarios.tipo continua 'jogador', mas
--     corpo/patente_atual_id ficam NULL — só a checagem de
--     corpo/patente obrigatórios em PATCH /usuarios/:id é *daquela
--     rota*, não um CHECK do banco, então essa combinação é válida)
--     com eh_convidado = 1.
--   - exclusao: reaproveita o status 'desligado_honroso' que já existe
--     no CHECK de usuarios.status — não precisa de um valor novo só
--     pra isso. A listagem de convidados (nova página) filtra
--     `eh_convidado = 1 AND status != 'desligado_honroso'`.
--
-- Por que não um status/tipo 'convidado' de verdade na tabela
-- usuarios: o CHECK de tipo/status fica na própria tabela `usuarios`,
-- e ela tem mais de 100 referências de FK espalhadas por dezenas de
-- tabelas (bem mais que o caso de `requerimentos`, que já precisou de
-- um rebuild cuidadoso em 0040 com só 3 tabelas referenciando).
-- Recriar `usuarios` exigiria remover e recolocar a FK de todas elas —
-- risco alto pra esse ganho específico. Um flag booleano novo
-- (ALTER TABLE ADD COLUMN, sem CHECK cruzando colunas) resolve sem
-- tocar em nenhuma FK existente. "Convidado" já era tratado como um
-- rótulo de camada de acesso em src/index.ts (STATUS_CONVIDADO), não
-- um valor de enum — este flag segue a mesma ideia.
--
-- O rebuild de `requerimentos`/`requerimento_alvos`/
-- `requerimento_anexos`/`historico` segue EXATAMENTE o mesmo motivo e
-- receita de 0040_requerimento_integracao.sql (D1 enforça a checagem
-- de FK no DROP TABLE mesmo com defer_foreign_keys — precisa tirar as
-- 3 tabelas que referenciam `requerimentos` do caminho antes). Inclui
-- as 3 colunas adicionadas em `requerimentos` desde então
-- (motivo_gratificacao_id/valor_gratificacao em 0042,
-- alertas_requisitos em 0048), que 0040 não conhecia.
-- =====================================================================

PRAGMA defer_foreign_keys = true;

-- usuarios: só um ADD COLUMN simples, sem rebuild — não mexe em CHECK
-- nem em FK nenhuma.
ALTER TABLE usuarios ADD COLUMN eh_convidado INTEGER NOT NULL DEFAULT 0;

-- Passo 1: historico perde de vez a FK em requerimento_id (mesma
-- lógica de 0004/0040 — log de auditoria, referência informativa basta).
CREATE TABLE historico_novo (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
    tipo_acao           TEXT NOT NULL,
    requerimento_id     INTEGER,
    requerimento_alvo_id INTEGER,
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

-- Passo 2: requerimento_anexos perde a FK temporariamente.
CREATE TABLE requerimento_anexos_temp (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    requerimento_id INTEGER NOT NULL,
    url             TEXT NOT NULL,
    ordem           INTEGER NOT NULL DEFAULT 0
);

INSERT INTO requerimento_anexos_temp SELECT id, requerimento_id, url, ordem FROM requerimento_anexos;

DROP TABLE requerimento_anexos;
ALTER TABLE requerimento_anexos_temp RENAME TO requerimento_anexos;

-- Passo 3: requerimento_alvos perde a FK temporariamente.
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

-- Passo 4: recria requerimentos com 'convidado' no CHECK do tipo, já
-- incluindo as 3 colunas adicionadas depois de 0040 (0042/0048).
CREATE TABLE requerimentos_novo (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo                TEXT NOT NULL CHECK (tipo IN (
                            'instrucao_inicial','promocao','rebaixamento','advertencia',
                            'licenca','volta_licenca','reserva','transferencia_conta','transferencia_corpo',
                            'venda_cargo','contratacao','integracao','tag','turno_tarefa','reforma',
                            'desligamento_honroso','desligamento_desonroso','exoneracao',
                            'bonificacao','cancelamento','convidado'
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
    operado_por_id      INTEGER REFERENCES usuarios(id),
    motivo_gratificacao_id INTEGER REFERENCES motivos_gratificacao(id),
    valor_gratificacao  INTEGER,
    alertas_requisitos  TEXT
);

INSERT INTO requerimentos_novo
SELECT id, tipo, autor_id, status, tag_requerimento, dados_especificos, crime_id, fundamentacao,
       autorizado_por_id, tag_aplicada, criado_em, decidido_em, decidido_por_id, motivo_recusa,
       forum_topico_id, tag_grupo_override, operado_por_id, motivo_gratificacao_id, valor_gratificacao,
       alertas_requisitos
FROM requerimentos;

DROP TABLE requerimentos;
ALTER TABLE requerimentos_novo RENAME TO requerimentos;
CREATE INDEX idx_requerimentos_status ON requerimentos(status);
CREATE INDEX idx_requerimentos_autor ON requerimentos(autor_id);

-- Passo 5: recria requerimento_anexos e requerimento_alvos de novo,
-- com a FK (e ON DELETE CASCADE) de volta, apontando pra
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
-- folha, rebuild simples).
CREATE TABLE requerimentos_permissoes_novo (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id      INTEGER REFERENCES usuarios(id),
    grupo_id        INTEGER REFERENCES grupos(id),
    tipo            TEXT CHECK (tipo IS NULL OR tipo IN (
                        'instrucao_inicial','promocao','rebaixamento','advertencia',
                        'licenca','volta_licenca','reserva','transferencia_conta','transferencia_corpo',
                        'venda_cargo','contratacao','integracao','tag','turno_tarefa','reforma',
                        'desligamento_honroso','desligamento_desonroso','exoneracao',
                        'bonificacao','cancelamento','convidado'
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
