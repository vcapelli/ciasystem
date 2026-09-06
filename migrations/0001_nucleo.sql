-- =====================================================================
-- FASE 1 — NÚCLEO (patentes, usuários, grupos)
-- =====================================================================
-- Primeira migration do CIASystem. Sem isso, nada mais funciona: é a
-- base de identidade (usuarios), hierarquia (patentes) e organização
-- em grupos (companhias/subcompanhias/órgãos).
--
-- Nota: `cursos` (catálogo simples) entrou aqui, mesmo sendo "Fase 4"
-- na divisão conceitual, porque `requisitos_promocao_cursos`
-- referencia essa tabela — precisa existir antes.
-- =====================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE patentes (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    corpo               TEXT NOT NULL CHECK (corpo IN ('militar','executivo')),
    sub_corpo           TEXT CHECK (sub_corpo IN ('pracas','pracas_especiais','oficiais',NULL)),
    nome                TEXT NOT NULL,
    ordem               INTEGER NOT NULL,          -- posição na escada (1..15 militar / 1..13 executivo)
    vagas               INTEGER,                   -- NULL = sem limite de efetivo (só Oficiais/Chanceler têm)
    valor_compra_raros  INTEGER,                   -- só executivo; custo acumulado em Raros Staff's
    ativo               INTEGER NOT NULL DEFAULT 1,
    UNIQUE (corpo, ordem)
);

-- Equivalência hierárquica Executivo <-> Militar (seção 2.2 do doc-mestre).
-- Usada só para precedência/comando entre corpos, nunca altera a
-- natureza do cargo do usuário.
CREATE TABLE equivalencias_patentes (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    patente_executivo_id    INTEGER NOT NULL REFERENCES patentes(id),
    patente_militar_id      INTEGER NOT NULL REFERENCES patentes(id),
    UNIQUE (patente_executivo_id, patente_militar_id)
);

-- "Até onde cada patente/cargo pode agir" (Constituição, Título II, Cap. II).
-- Uma linha por combinação origem/ação: suporta tetos diferentes para
-- promover vs. rebaixar vs. advertir vs. demitir/exonerar/licenciar, e
-- os casos de borda cross-corpo (multi-linha por origem).
CREATE TABLE diretrizes_hierarquia (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    patente_origem_id   INTEGER NOT NULL REFERENCES patentes(id),
    acao                TEXT NOT NULL CHECK (acao IN ('promover','rebaixar','advertir','demitir','exonerar','licenciar')),
    patente_limite_id   INTEGER NOT NULL REFERENCES patentes(id), -- teto (inclusive/exclusive definido em código)
    requer_pro_ou_cfo   INTEGER NOT NULL DEFAULT 0, -- exige Aula de Promotor (militar) ou CFO (executivo)
    observacao          TEXT
);

-- Catálogo simples de cursos (CFSd, SUP, CFC, SEG, CFS, CAC, CAS, CAO,
-- PRO, CCO, CAP, TQSb, CFO, COEsp, CSA, TASA...). Referenciado por
-- requisitos_promocao_cursos abaixo — histórico de conclusão
-- individual (historico_cursos/certificados) entra só na Fase 4.
CREATE TABLE cursos (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo              TEXT NOT NULL UNIQUE,
    nome                TEXT NOT NULL,
    grupo_responsavel_id INTEGER REFERENCES grupos(id) -- ex: INS aplica a maioria, APM aplica CFO
);

CREATE TABLE requisitos_promocao (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    patente_origem_id   INTEGER NOT NULL REFERENCES patentes(id),
    patente_destino_id  INTEGER NOT NULL REFERENCES patentes(id),
    dias_minimos        INTEGER NOT NULL DEFAULT 0,
    requer_companhia    INTEGER NOT NULL DEFAULT 0, -- true = precisa estar vinculado a um grupo (companhia)
    UNIQUE (patente_origem_id, patente_destino_id)
);

-- Cursos exigidos por transição (N:N, evita JSON solto em coluna).
CREATE TABLE requisitos_promocao_cursos (
    requisito_id    INTEGER NOT NULL REFERENCES requisitos_promocao(id) ON DELETE CASCADE,
    curso_id        INTEGER NOT NULL REFERENCES cursos(id),
    PRIMARY KEY (requisito_id, curso_id)
);

CREATE TABLE usuarios (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    nick                        TEXT NOT NULL UNIQUE,      -- nick do Habblet (jogador) ou nome de exibição (conta oficial, ex: "Administração")
    tag                         TEXT UNIQUE,                -- TAG pessoal do policial, 2-3 caracteres (NULL em conta oficial)
    tipo                        TEXT NOT NULL DEFAULT 'jogador' CHECK (tipo IN ('jogador','conta_oficial')),
    corpo                       TEXT CHECK (corpo IN ('militar','executivo',NULL)), -- NULL só é válido em conta_oficial
    patente_atual_id            INTEGER REFERENCES patentes(id),                    -- NULL só é válido em conta_oficial
    status                      TEXT NOT NULL DEFAULT 'ativo'
                                CHECK (status IN ('ativo','reformado','desligado_honroso','desligado_desonroso','exonerado','licenca')),
    data_ingresso               TEXT NOT NULL,
    data_ultimo_ato_funcional   TEXT,             -- base para "dias mínimos"; NULL em conta_oficial (não tem patente pra promover)
    administrador_sistema       INTEGER NOT NULL DEFAULT 0, -- bypass total (painel/admin)
    biografia                   TEXT,             -- texto livre exibido no perfil
    exoneracao_ate              TEXT,             -- data-limite se status = exonerado com prazo determinado
    -- Senha opcional: login continua funcionando só com o código da
    -- missão (fluxo original), mas quem quiser também pode entrar por
    -- senha depois de configurá-la. NUNCA guardar em texto plano —
    -- `senha_hash` guarda o hash (bcrypt/argon2, decisão do Worker).
    -- Tanto criar quanto trocar a senha exigem passar de novo pelo
    -- código de verificação (ver codigos_verificacao.finalidade
    -- abaixo) — nunca só com a senha atual.
    senha_hash                  TEXT,
    senha_atualizada_em         TEXT,
    criado_em                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    atualizado_em                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    -- Garante que só conta_oficial fica sem corpo/patente — jogador
    -- de verdade sempre precisa das duas.
    CHECK (
        (tipo = 'conta_oficial' AND corpo IS NULL AND patente_atual_id IS NULL)
        OR
        (tipo = 'jogador' AND corpo IS NOT NULL AND patente_atual_id IS NOT NULL)
    )
);

CREATE INDEX idx_usuarios_patente ON usuarios(patente_atual_id);
CREATE INDEX idx_usuarios_status ON usuarios(status);
CREATE INDEX idx_usuarios_tipo ON usuarios(tipo);

-- Código exigido na missão do Habblet. Serve tanto pra login (fluxo
-- original) quanto pra criar/trocar senha — `finalidade` distingue os
-- dois usos.
CREATE TABLE codigos_verificacao (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nick        TEXT NOT NULL,          -- verificação acontece antes de existir usuarios.id (primeiro login)
    codigo      TEXT NOT NULL,          -- código exigido na missão do Habblet
    finalidade  TEXT NOT NULL DEFAULT 'login' CHECK (finalidade IN ('login','senha')),
    criado_em    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    expira_em    TEXT NOT NULL,
    usado       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE grupos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo          TEXT NOT NULL UNIQUE,  -- INS, APM, CRH, DC, GSI, BOPE, COR, COG, ALTO_COMANDO, ADMIN_FORUM...
    nome            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,  -- caminho do hub: site.com/{slug}
    tipo            TEXT NOT NULL CHECK (tipo IN ('companhia','subcompanhia','orgao_topo','setor_inteligencia')),
    permite_aulas   INTEGER NOT NULL DEFAULT 0,
    ativo           INTEGER NOT NULL DEFAULT 1
);

-- Cargos internos do grupo (hierarquia própria, separada da patente).
CREATE TABLE grupo_niveis (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    grupo_id        INTEGER NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
    nome            TEXT NOT NULL,      -- ex: Instrutor, Ministro, Vice-Líder, Líder
    ordem           INTEGER NOT NULL,
    criado_por_id   INTEGER REFERENCES usuarios(id),
    criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    atualizado_em   TEXT,
    UNIQUE (grupo_id, nome)
);

CREATE TABLE usuario_grupos (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id              INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    grupo_id                INTEGER NOT NULL REFERENCES grupos(id),
    nivel_id                INTEGER NOT NULL REFERENCES grupo_niveis(id),
    administrador_grupo     INTEGER NOT NULL DEFAULT 0,
    data_ingresso           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    ativo                   INTEGER NOT NULL DEFAULT 1,
    UNIQUE (usuario_id, grupo_id)
);

CREATE INDEX idx_usuario_grupos_usuario ON usuario_grupos(usuario_id);
CREATE INDEX idx_usuario_grupos_grupo ON usuario_grupos(grupo_id);
