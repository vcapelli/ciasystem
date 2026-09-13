-- =====================================================================
-- REVISÃO DE DOCUMENTO: MÚLTIPLOS ASSINANTES POR ETAPA
-- =====================================================================
-- Antes: 1 pessoa por papel (autor/revisor/administrador_forum),
-- decidida na abertura da revisão. Agora: N pessoas por papel/etapa,
-- decididas em duas etapas (abrir rascunho com coautores → depois,
-- ao enviar pra aprovação, escolhe aprovadores e administradores do
-- fórum). Uma etapa só libera a próxima quando TODOS os membros dela
-- assinaram 'aprovado'. Se qualquer um reprovar, tudo reseta pra
-- rascunho e as assinaturas são todas apagadas (reinício da votação).
-- =====================================================================

-- Em qual etapa a revisão está agora: 1=autores, 2=aprovadores, 3=administrador do fórum.
ALTER TABLE documento_revisoes ADD COLUMN etapa_atual INTEGER NOT NULL DEFAULT 1;

-- Por documento: qual grupo (além de quem já participa da revisão e
-- dos administradores do sistema) pode visualizar as solicitações em
-- aberto. NULL = ninguém além dos participantes/admin.
ALTER TABLE documentos ADD COLUMN grupo_visualizacao_solicitacoes_id INTEGER REFERENCES grupos(id);

-- Recria documento_revisao_aprovadores sem o UNIQUE(revisao_id, papel)
-- (que só permitia 1 pessoa por papel) — agora é UNIQUE(revisao_id,
-- papel, usuario_id), permitindo N pessoas no mesmo papel/etapa.
-- 'revisor' vira 'aprovador' (nome mais claro, já que agora são vários).
CREATE TABLE documento_revisao_aprovadores_novo (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    revisao_id      INTEGER NOT NULL REFERENCES documento_revisoes(id) ON DELETE CASCADE,
    papel           TEXT NOT NULL CHECK (papel IN ('autor', 'aprovador', 'administrador_forum')),
    usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
    status          TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'reprovado')),
    comentario      TEXT,
    decidido_em     TEXT,
    UNIQUE (revisao_id, papel, usuario_id)
);

INSERT INTO documento_revisao_aprovadores_novo (id, revisao_id, papel, usuario_id, status, comentario, decidido_em)
SELECT id, revisao_id,
       CASE papel WHEN 'revisor' THEN 'aprovador' ELSE papel END,
       usuario_id, status, comentario, decidido_em
FROM documento_revisao_aprovadores;

DROP TABLE documento_revisao_aprovadores;
ALTER TABLE documento_revisao_aprovadores_novo RENAME TO documento_revisao_aprovadores;
CREATE INDEX idx_documento_revisao_aprovadores_revisao ON documento_revisao_aprovadores(revisao_id);
CREATE INDEX idx_documento_revisao_aprovadores_usuario ON documento_revisao_aprovadores(usuario_id);
