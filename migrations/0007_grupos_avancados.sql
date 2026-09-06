-- =====================================================================
-- FASE 5 — GRUPOS AVANÇADOS (hub do grupo)
-- =====================================================================
-- Depende das Fases 1-4. Reaproveita usuario_grupos.administrador_grupo
-- (Fase 1) — sem tabela de permissão nova: quem já é admin interno do
-- grupo também gerencia registros, aulas e páginas do hub.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- Registros internos de carreira dentro do grupo — distinto do
-- histórico institucional (tabela `historico`, que é de patente/corpo).
CREATE TABLE grupo_registros (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    grupo_id            INTEGER NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
    usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
    tipo                TEXT NOT NULL CHECK (tipo IN (
                            'admissao','saida','licenca','volta_licenca',
                            'promocao','rebaixamento','advertencia'
                        )),
    nivel_anterior_id   INTEGER REFERENCES grupo_niveis(id),
    nivel_novo_id       INTEGER REFERENCES grupo_niveis(id),
    motivo              TEXT,
    registrado_por_id   INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_grupo_registros_usuario ON grupo_registros(usuario_id);
CREATE INDEX idx_grupo_registros_grupo ON grupo_registros(grupo_id);

-- Aulas/scripts de grupos de treinamento, só quando grupos.permite_aulas = 1.
CREATE TABLE grupo_aulas (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    grupo_id            INTEGER NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
    titulo              TEXT NOT NULL,
    descricao           TEXT,
    conteudo            TEXT NOT NULL,
    nivel_minimo_id     INTEGER REFERENCES grupo_niveis(id),
    ordem               INTEGER NOT NULL DEFAULT 0,
    ativo               INTEGER NOT NULL DEFAULT 1,
    criado_por_id       INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    atualizado_em       TEXT
);

CREATE INDEX idx_grupo_aulas_grupo ON grupo_aulas(grupo_id);

-- Páginas customizadas dentro do hub do grupo (site.com/{grupos.slug}/{caminho}).
CREATE TABLE grupo_paginas (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    grupo_id            INTEGER NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
    titulo              TEXT NOT NULL,
    caminho             TEXT NOT NULL,
    conteudo_html       TEXT NOT NULL,
    eh_pagina_inicial   INTEGER NOT NULL DEFAULT 0,
    ordem               INTEGER NOT NULL DEFAULT 0,
    ativo               INTEGER NOT NULL DEFAULT 1,
    criado_por_id       INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    atualizado_em       TEXT,
    atualizado_por_id   INTEGER REFERENCES usuarios(id),
    UNIQUE (grupo_id, caminho)
);

CREATE INDEX idx_grupo_paginas_grupo ON grupo_paginas(grupo_id);
CREATE UNIQUE INDEX idx_grupo_paginas_inicial_unica ON grupo_paginas(grupo_id) WHERE eh_pagina_inicial = 1;
