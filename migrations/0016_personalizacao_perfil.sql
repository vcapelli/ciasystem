-- =====================================================================
-- PERSONALIZAÇÃO DE PERFIL
-- =====================================================================
-- Banners de capa: curados por administrador_sistema (lista fechada de
-- imagens permitidas, não upload livre). Cor de fundo do avatar: livre,
-- qualquer hex, sem curadoria — guardada direto no usuário.
-- Ambos opcionais: NULL = usa o padrão atual do sistema (banner.png
-- animado e bg-basebg).
-- =====================================================================

CREATE TABLE banners_perfil (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    imagem_url  TEXT NOT NULL,
    nome        TEXT,
    ativo       INTEGER NOT NULL DEFAULT 1,
    criado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

ALTER TABLE usuarios ADD COLUMN banner_perfil_id INTEGER REFERENCES banners_perfil(id);
ALTER TABLE usuarios ADD COLUMN cor_avatar_fundo TEXT; -- hex livre (ex: '#046b2f'); NULL = padrão
