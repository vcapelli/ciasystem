-- =====================================================================
-- PROJETOS, PROPOSTAS, CORREÇÕES E SUGESTÕES
-- =====================================================================
-- Processo aberto por qualquer usuário, gerido por um único grupo do
-- sistema (configurado em configuracoes_sistema, chave
-- 'projetos_grupo_responsavel_id' — sem coluna nova pra isso).
--
-- Fluxo: aberto -> em_analise (responsável definido) -> em_votacao
-- (responsável posta análise/parecer/veredito) -> arquivado (reprovado
-- na votação) ou aguardando_implementacao (aprovado) -> concluido
-- (responsável implementa e encerra). Arquivamento também pode ser
-- manual a qualquer momento não-terminal, e um processo arquivado pode
-- ser desarquivado de volta pra aguardando_implementacao ou em_votacao.
--
-- Ver documento de especificação no projeto (modulo-projetos-propostas.md)
-- pra detalhes de regras de permissão e a máquina de estados completa.
-- =====================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE projetos (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo                        TEXT NOT NULL CHECK (tipo IN ('projeto', 'proposta', 'correcao', 'sugestao')),
    titulo                      TEXT NOT NULL,
    descricao                   TEXT NOT NULL,
    autor_id                    INTEGER NOT NULL REFERENCES usuarios(id),
    status                      TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN (
                                    'aberto', 'em_analise', 'em_votacao',
                                    'arquivado', 'aguardando_implementacao', 'concluido'
                                )),

    responsavel_id              INTEGER REFERENCES usuarios(id),
    responsavel_definido_por_id INTEGER REFERENCES usuarios(id),
    responsavel_definido_em     TEXT,

    analise                     TEXT,
    parecer                     TEXT,
    veredito                    TEXT CHECK (veredito IN ('aprova', 'reprova')),
    parecer_postado_em          TEXT,

    votacao_aberta_em           TEXT,
    votacao_encerrada_em        TEXT,
    votacao_encerrada_por_id    INTEGER REFERENCES usuarios(id),
    votacao_resultado           TEXT CHECK (votacao_resultado IN ('aprovado', 'reprovado')),

    implementacao_descricao     TEXT,
    concluido_em                TEXT,

    -- Reflete o evento de arquivamento/desarquivamento MAIS RECENTE, não
    -- necessariamente o status atual — um processo já desarquivado
    -- continua com esses campos preenchidos, só pra registro de
    -- quando/por quem/por que foi arquivado da última vez.
    arquivado_em                TEXT,
    arquivado_por_id            INTEGER REFERENCES usuarios(id),
    motivo_arquivamento         TEXT,
    desarquivado_em             TEXT,
    desarquivado_por_id         INTEGER REFERENCES usuarios(id),

    criado_em                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    atualizado_em               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_projetos_status ON projetos(status);
CREATE INDEX idx_projetos_responsavel ON projetos(responsavel_id);
CREATE INDEX idx_projetos_autor ON projetos(autor_id);

-- Um voto vigente por pessoa (troca de voto = UPDATE enquanto a votação
-- está aberta); apagados em bloco quando uma votação é reiniciada via
-- desarquivamento pra 'em_votacao'.
CREATE TABLE projeto_votos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    projeto_id    INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    usuario_id    INTEGER NOT NULL REFERENCES usuarios(id),
    voto          TEXT NOT NULL CHECK (voto IN ('aprova', 'reprova')),
    comentario    TEXT,
    criado_em     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (projeto_id, usuario_id)
);

CREATE INDEX idx_projeto_votos_projeto ON projeto_votos(projeto_id);

-- Timeline pública do processo (mesmo padrão de documento_revisao_historico).
CREATE TABLE projeto_historico (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    projeto_id    INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    descricao     TEXT NOT NULL,
    criado_por_id INTEGER REFERENCES usuarios(id),
    criado_em     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_projeto_historico_projeto ON projeto_historico(projeto_id);
