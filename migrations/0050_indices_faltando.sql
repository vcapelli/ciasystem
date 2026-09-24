-- Índices faltando em FKs usadas em WHERE/JOIN de alto tráfego
-- (achado da auditoria de Set/2026). Fórum fica de fora por ora (não
-- é prioridade agora).

CREATE INDEX idx_diretrizes_hierarquia_origem ON diretrizes_hierarquia(patente_origem_id, acao);
CREATE INDEX idx_usuario_grupos_nivel ON usuario_grupos(nivel_id);
CREATE INDEX idx_documentos_permissoes_usuario ON documentos_permissoes(usuario_id);
CREATE INDEX idx_documentos_permissoes_grupo ON documentos_permissoes(grupo_id);
CREATE INDEX idx_noticias_permissoes_usuario ON noticias_permissoes(usuario_id);
CREATE INDEX idx_noticias_permissoes_grupo ON noticias_permissoes(grupo_id);
CREATE INDEX idx_grupo_aulas_categorias_grupo ON grupo_aulas_categorias(grupo_id);
