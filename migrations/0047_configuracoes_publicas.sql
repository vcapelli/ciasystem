-- =====================================================================
-- configuracoes_sistema: allowlist de chaves públicas
-- =====================================================================
-- Hoje `GET /configuracoes` (rota pública, sem autenticação — usada
-- pela tela de login antes de existir qualquer token) devolve TODAS
-- as chaves de `configuracoes_sistema` sem filtro nenhum. Só que
-- `PATCH /configuracoes` (admin-only) aceita gravar qualquer
-- chave/valor nessa mesma tabela genérica, inclusive chaves internas
-- que não deveriam vazar publicamente (ex:
-- 'projetos_grupo_responsavel_id' e 'projetos_niveis_votantes_ids',
-- usadas em src/services/projetos.ts).
--
-- Adiciona a coluna `publica` (0/1, default 0 = privada) e já marca
-- como públicas as chaves que hoje são de fato lidas pela tela de
-- login (frontend/login.html) e pelo rodapé global
-- (frontend/assets/footer.js) / navbar (frontend/assets/layout.js),
-- ambos carregados via `buscarConfiguracoes()` (frontend/assets/api.js)
-- sem autenticação em toda a aplicação:
--   - logo_url                            (login.html, layout.js, footer.js)
--   - login_fundo_url / login_fundo_modo  (login.html — fundo da tela de login)
--   - nome_sistema                        (footer.js)
--   - versao_sistema                      (footer.js)
--   - footer_frase_html                   (footer.js)
--   - footer_estilo                       (footer.js — estilo do rodapé)
--   - footer_estilo2_imagem_url
--   - footer_estilo2_imagem_alinhamento
--   - footer_estilo2_texto_simples
-- Todas são dados de identidade visual/branding, sem risco de vazar
-- informação sensível. Qualquer chave nova (ex: as de projetos)
-- nasce privada por padrão e só é exposta publicamente se um admin
-- marcar explicitamente via PATCH /configuracoes (chaves_publicas).
-- =====================================================================

ALTER TABLE configuracoes_sistema ADD COLUMN publica INTEGER NOT NULL DEFAULT 0;

UPDATE configuracoes_sistema SET publica = 1 WHERE chave IN (
    'logo_url',
    'login_fundo_url',
    'login_fundo_modo',
    'nome_sistema',
    'versao_sistema',
    'footer_frase_html',
    'footer_estilo',
    'footer_estilo2_imagem_url',
    'footer_estilo2_imagem_alinhamento',
    'footer_estilo2_texto_simples'
);
