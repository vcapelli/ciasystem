-- =====================================================================
-- FASE 6 — DOCUMENTOS INSTITUCIONAIS COM FLUXO DE REVISÃO
-- =====================================================================
-- Depende das Fases 1-5. Fluxo: documentos guarda só o vigente;
-- documento_revisoes é uma cópia editável (rascunho → aprovação em 3
-- níveis → agendamento → implementação, que sobrescreve o vigente).
-- =====================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE documentos_permissoes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id      INTEGER REFERENCES usuarios(id),
    grupo_id        INTEGER REFERENCES grupos(id),
    pode_criar      INTEGER NOT NULL DEFAULT 0,
    pode_editar     INTEGER NOT NULL DEFAULT 0,
    pode_deletar    INTEGER NOT NULL DEFAULT 0,
    definido_por_id INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    CHECK ((usuario_id IS NOT NULL AND grupo_id IS NULL) OR (usuario_id IS NULL AND grupo_id IS NOT NULL))
);

CREATE TABLE documentos (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo                  TEXT NOT NULL,
    tipo                    TEXT NOT NULL CHECK (tipo IN ('constituicao_militar','codigo_penal_militar','guia_defesa_batalhao','outro')),
    conteudo_atual          TEXT NOT NULL,
    numero_revisao_atual    INTEGER NOT NULL DEFAULT 0,
    status                  TEXT NOT NULL DEFAULT 'vigente' CHECK (status IN ('vigente','em_revisao','arquivado')),
    criado_em               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    atualizado_em           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE documento_revisoes (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    documento_id        INTEGER NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
    numero_revisao      INTEGER NOT NULL,
    conteudo_proposto   TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN (
                            'rascunho','em_aprovacao','aprovado','reprovado',
                            'agendado','implementado','cancelado'
                        )),
    autor_id            INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    agendado_para       TEXT,
    agendado_por_id     INTEGER REFERENCES usuarios(id),
    implementado_em     TEXT
);

CREATE INDEX idx_documento_revisoes_documento ON documento_revisoes(documento_id);
CREATE INDEX idx_documento_revisoes_status ON documento_revisoes(status);

CREATE TABLE documento_revisao_historico (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    revisao_id      INTEGER NOT NULL REFERENCES documento_revisoes(id) ON DELETE CASCADE,
    descricao       TEXT NOT NULL,
    criado_por_id   INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_documento_revisao_historico_revisao ON documento_revisao_historico(revisao_id);

CREATE TABLE documento_revisao_aprovadores (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    revisao_id      INTEGER NOT NULL REFERENCES documento_revisoes(id) ON DELETE CASCADE,
    papel           TEXT NOT NULL CHECK (papel IN ('autor','revisor','administrador_forum')),
    usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
    status          TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','reprovado')),
    comentario      TEXT,
    decidido_em     TEXT,
    UNIQUE (revisao_id, papel)
);

CREATE INDEX idx_documento_revisao_aprovadores_revisao ON documento_revisao_aprovadores(revisao_id);
