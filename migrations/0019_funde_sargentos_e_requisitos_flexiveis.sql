-- =====================================================================
-- FUNDE 1º/2º/3º SARGENTO EM UM ÚNICO POSTO "SARGENTO"
-- =====================================================================
-- Mantém o id do antigo "3º Sargento" (só renomeia) — quem estava nos
-- outros dois é remanejado pra esse posto único. Os dois extintos
-- ficam com ativo=0 (saem da hierarquia ativa, mas continuam
-- existindo pra registros antigos — historico e requerimentos antigos
-- guardam o id da patente na época, então apagar a linha de vez
-- deixaria esses registros com "patente desconhecida").
--
-- ORDEM DAS OPERAÇÕES IMPORTA: os extintos precisam sair da faixa de
-- ordem (4 e 5) ANTES de renumerar a escada acima, senão colide com o
-- UNIQUE(corpo, ordem) no meio do caminho.
-- =====================================================================

UPDATE patentes SET nome = 'Sargento' WHERE corpo = 'militar' AND nome = '3º Sargento';

UPDATE usuarios SET patente_atual_id = (SELECT id FROM patentes WHERE corpo = 'militar' AND nome = 'Sargento')
WHERE patente_atual_id IN (
  SELECT id FROM patentes WHERE corpo = 'militar' AND nome IN ('1º Sargento', '2º Sargento')
);

UPDATE patentes SET ativo = 0, ordem = 900 + id
WHERE corpo = 'militar' AND nome IN ('1º Sargento', '2º Sargento');

-- Fecha os dois degraus que sumiram (Subtenente e tudo acima desce 2).
UPDATE patentes SET ordem = ordem - 2 WHERE corpo = 'militar' AND ordem > 5;


-- =====================================================================
-- REQUISITOS DE PROMOÇÃO — FORMATO FLEXÍVEL
-- =====================================================================
-- Substitui o formato rígido de `requisitos_promocao` (uma linha por
-- transição, com colunas fixas) por uma lista de itens por PATENTE
-- DESTINO — cada item é um tipo de requisito, editável livremente
-- pelo painel de admin. Os dados antigos em requisitos_promocao NÃO
-- são migrados automaticamente pra cá (schemas incompatíveis demais
-- pra converter com segurança) — ficam preservados na tabela antiga
-- só como referência, e o admin recadastra o que for preciso na tela
-- nova.
-- =====================================================================

CREATE TABLE requisitos_patente (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    patente_id        INTEGER NOT NULL REFERENCES patentes(id) ON DELETE CASCADE,
    tipo              TEXT NOT NULL CHECK (tipo IN (
                          'tempo_na_patente', 'tempo_na_policia', 'curso', 'certificado', 'grupo', 'outro'
                      )),
    dias              INTEGER,   -- tempo_na_patente / tempo_na_policia
    curso_id          INTEGER REFERENCES cursos(id),
    certificado_tipo  TEXT CHECK (certificado_tipo IS NULL OR certificado_tipo IN ('CFO', 'CQ', 'CCJ')),
    grupo_id          INTEGER REFERENCES grupos(id),
    descricao         TEXT,      -- livre, usado pelo tipo 'outro' (ou detalhe extra em qualquer tipo)
    criado_em         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_requisitos_patente_patente ON requisitos_patente(patente_id);
