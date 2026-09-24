-- =====================================================================
-- CORREÇÃO: CHECK de notificacoes.tipo estava incompleto
-- =====================================================================
-- `notificacoes` foi criada em 0009_comunicacao.sql com um CHECK fixo
-- em `tipo`. Desde então, `src/services/notificacoes.ts` (tipo
-- TypeScript `TipoNotificacao`) passou a aceitar 4 valores a mais —
-- 'documento_revisao_pendente' (src/routes/documentos.ts) e
-- 'projeto_responsavel' / 'projeto_status' / 'projeto_votacao_aberta'
-- (src/routes/projetos.ts) — que nunca foram adicionados ao CHECK do
-- banco. Resultado: todo INSERT de notificação com um desses 4 tipos
-- estoura exception no D1 e derruba com 500 a ação inteira (não só a
-- notificação em si).
--
-- Nenhuma outra tabela tem FK pra `notificacoes(id)` (checado com
-- `grep -r "REFERENCES notificacoes"`), e nenhuma migração posterior a
-- 0009 alterou essa tabela — rebuild simples, mesmo padrão de
-- 0040_requerimento_integracao.sql: recria com o CHECK completo,
-- copia os dados, dropa a antiga, renomeia, recria os índices.
--
-- CHECK novo = os 13 valores originais de 0009 + os 4 que faltavam,
-- exatamente igual ao union `TipoNotificacao` em
-- src/services/notificacoes.ts hoje (17 valores).
-- =====================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE notificacoes_novo (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
    tipo            TEXT NOT NULL CHECK (tipo IN (
                        'mensagem','noticia','noticia_grupo','tweet_resposta',
                        'tweet_curtida','tweet_retweet','tweet_mencao',
                        'seguidor_novo','requerimento_status','documento_revisao',
                        'documento_revisao_pendente',
                        'emblema_recebido','conquista_alcancada','sistema',
                        'projeto_responsavel','projeto_status','projeto_votacao_aberta'
                    )),
    titulo          TEXT NOT NULL,
    corpo           TEXT,
    referencia_tipo TEXT,
    referencia_id   INTEGER,
    lido_em         TEXT,
    criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

INSERT INTO notificacoes_novo
SELECT id, usuario_id, tipo, titulo, corpo, referencia_tipo, referencia_id, lido_em, criado_em
FROM notificacoes;

DROP TABLE notificacoes;
ALTER TABLE notificacoes_novo RENAME TO notificacoes;

CREATE INDEX idx_notificacoes_usuario ON notificacoes(usuario_id);
CREATE INDEX idx_notificacoes_usuario_lido ON notificacoes(usuario_id, lido_em);
