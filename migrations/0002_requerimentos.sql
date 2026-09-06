-- =====================================================================
-- FASE 2 — REQUERIMENTOS E HISTÓRICO
-- =====================================================================
-- Depende da Fase 1 (usuarios, grupos) já aplicada.
--
-- Nota: `requerimentos` NÃO tem a coluna `forum_topico_id` ainda —
-- ela entra na Fase 3, via ALTER TABLE, quando o módulo de fórum
-- (forum_topicos) existir. Assim cada fase fica autocontida, sem
-- referência a tabela que ainda não existe.
-- =====================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE requerimentos (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo                TEXT NOT NULL CHECK (tipo IN (
                            'instrucao_inicial','promocao','rebaixamento','advertencia',
                            'licenca','volta_licenca','reserva','transferencia_conta','transferencia_corpo',
                            'venda_cargo','contratacao','tag','turno_tarefa','reforma',
                            'desligamento_honroso','desligamento_desonroso','exoneracao',
                            'bonificacao','cancelamento'
                        )),
    autor_id            INTEGER NOT NULL REFERENCES usuarios(id),
    status              TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','reprovado','cancelado')),
    tag_requerimento    TEXT NOT NULL UNIQUE,  -- gerada automaticamente pelo backend (NÃO é a tag do policial)
    dados_especificos   TEXT,                  -- JSON: payload específico do tipo (ex: patente destino, quantidade de dias)
    crime_id            INTEGER REFERENCES crimes(id), -- só preenchido em rebaixamento/advertencia/desligamento_desonroso
    fundamentacao       TEXT,               -- texto livre; inciso do crime entra aqui dentro, junto do relato
    autorizado_por_id   INTEGER REFERENCES usuarios(id), -- "Permissão: fulano ou -x-" — só informativo, não é o módulo de Permissões Prévias
    tag_aplicada        TEXT,               -- override manual de TAG, só quando difere da TAG de quem processou
    criado_em           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    decidido_em         TEXT,
    decidido_por_id     INTEGER REFERENCES usuarios(id),
    motivo_recusa       TEXT
);

CREATE INDEX idx_requerimentos_status ON requerimentos(status);
CREATE INDEX idx_requerimentos_autor ON requerimentos(autor_id);

-- Um requerimento pode ter mais de um alvo (Instrução Inicial,
-- Contratação), cada um aprovado/reprovado individualmente. Pra
-- requerimentos de alvo único, vira só uma linha aqui.
CREATE TABLE requerimento_alvos (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    requerimento_id     INTEGER NOT NULL REFERENCES requerimentos(id) ON DELETE CASCADE,
    usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
    status              TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','reprovado','cancelado')),
    decidido_em         TEXT,
    decidido_por_id     INTEGER REFERENCES usuarios(id),
    motivo_recusa       TEXT,
    UNIQUE (requerimento_id, usuario_id)
);

CREATE INDEX idx_requerimento_alvos_requerimento ON requerimento_alvos(requerimento_id);
CREATE INDEX idx_requerimento_alvos_usuario ON requerimento_alvos(usuario_id);

-- Links de prova/imagem anexados ao requerimento.
CREATE TABLE requerimento_anexos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    requerimento_id INTEGER NOT NULL REFERENCES requerimentos(id) ON DELETE CASCADE,
    url             TEXT NOT NULL,
    ordem           INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_requerimento_anexos_requerimento ON requerimento_anexos(requerimento_id);

-- Catálogo simples de crimes, só pra popular o dropdown "Crime".
-- Sem rastreamento de reincidência/punição — fora de escopo.
CREATE TABLE crimes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nome        TEXT NOT NULL UNIQUE,
    categoria   TEXT,
    ativo       INTEGER NOT NULL DEFAULT 1
);

-- Quem gerencia requerimentos (aprovar/reprovar, cancelar), concedido
-- pelos administradores do sistema — por usuário OU por grupo inteiro,
-- opcionalmente restrito a um único tipo (`tipo` NULL = todos).
CREATE TABLE requerimentos_permissoes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id      INTEGER REFERENCES usuarios(id),
    grupo_id        INTEGER REFERENCES grupos(id),
    tipo            TEXT CHECK (tipo IS NULL OR tipo IN (
                        'instrucao_inicial','promocao','rebaixamento','advertencia',
                        'licenca','volta_licenca','reserva','transferencia_conta','transferencia_corpo',
                        'venda_cargo','contratacao','tag','turno_tarefa','reforma',
                        'desligamento_honroso','desligamento_desonroso','exoneracao',
                        'bonificacao','cancelamento'
                    )),
    pode_aprovar    INTEGER NOT NULL DEFAULT 0,
    pode_cancelar   INTEGER NOT NULL DEFAULT 0,
    definido_por_id INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    CHECK ((usuario_id IS NOT NULL AND grupo_id IS NULL) OR (usuario_id IS NULL AND grupo_id IS NOT NULL))
);

CREATE INDEX idx_requerimentos_permissoes_usuario ON requerimentos_permissoes(usuario_id);
CREATE INDEX idx_requerimentos_permissoes_grupo ON requerimentos_permissoes(grupo_id);
CREATE INDEX idx_requerimentos_permissoes_tipo ON requerimentos_permissoes(tipo);

-- Espelho permanente de ações já aprovadas. Nunca editado, só marcado
-- como cancelado.
CREATE TABLE historico (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
    tipo_acao           TEXT NOT NULL,
    requerimento_id     INTEGER REFERENCES requerimentos(id),
    requerimento_alvo_id INTEGER REFERENCES requerimento_alvos(id),
    executado_por_id    INTEGER NOT NULL REFERENCES usuarios(id),
    detalhes            TEXT,
    data                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    cancelado           INTEGER NOT NULL DEFAULT 0,
    cancelado_em        TEXT,
    cancelado_por_id    INTEGER REFERENCES usuarios(id)
);

CREATE INDEX idx_historico_usuario ON historico(usuario_id);
