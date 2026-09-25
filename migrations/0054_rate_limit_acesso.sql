-- Bloqueio progressivo de tentativas em /auth/login-senha e
-- /auth/solicitar-codigo. Guardado no D1 (não em memória do Worker)
-- porque cada instância do Worker é isolada e efêmera — um contador em
-- variável de módulo não sobreviveria entre requests nem seria
-- compartilhado entre instâncias.
--
-- `chave` é algo como "login-senha:<nick em minúsculo>" ou
-- "solicitar-codigo:<nick em minúsculo>" — ver src/services/rate-limit.ts.
CREATE TABLE tentativas_acesso (
  chave         TEXT PRIMARY KEY,
  tentativas    INTEGER NOT NULL DEFAULT 0,
  bloqueado_ate TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
