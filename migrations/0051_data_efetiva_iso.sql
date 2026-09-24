-- Converte `data_efetiva` de texto livre formatado ("13 Set 2026")
-- pra ISO (YYYY-MM-DD) em grupo_registros e grupo_aula_relatorios —
-- o formato livre era gravado desde a criação da coluna (0028/0029),
-- nunca corrigido (o próprio comentário da migração 0043 já
-- reconhecia isso). O frontend agora sempre envia e exibe ISO,
-- formatando só na hora de renderizar.
--
-- Só converte linhas que ainda estão no formato antigo (11
-- caracteres, mês abreviado em português no meio) — linhas que já
-- estiverem em ISO (10 caracteres) ficam intactas.

UPDATE grupo_registros
SET data_efetiva = substr(data_efetiva, 8, 4) || '-' ||
  CASE substr(data_efetiva, 4, 3)
    WHEN 'Jan' THEN '01' WHEN 'Fev' THEN '02' WHEN 'Mar' THEN '03' WHEN 'Abr' THEN '04'
    WHEN 'Mai' THEN '05' WHEN 'Jun' THEN '06' WHEN 'Jul' THEN '07' WHEN 'Ago' THEN '08'
    WHEN 'Set' THEN '09' WHEN 'Out' THEN '10' WHEN 'Nov' THEN '11' WHEN 'Dez' THEN '12'
  END || '-' || substr(data_efetiva, 1, 2)
WHERE data_efetiva IS NOT NULL
  AND length(data_efetiva) = 11
  AND substr(data_efetiva, 4, 3) IN ('Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez');

UPDATE grupo_aula_relatorios
SET data_efetiva = substr(data_efetiva, 8, 4) || '-' ||
  CASE substr(data_efetiva, 4, 3)
    WHEN 'Jan' THEN '01' WHEN 'Fev' THEN '02' WHEN 'Mar' THEN '03' WHEN 'Abr' THEN '04'
    WHEN 'Mai' THEN '05' WHEN 'Jun' THEN '06' WHEN 'Jul' THEN '07' WHEN 'Ago' THEN '08'
    WHEN 'Set' THEN '09' WHEN 'Out' THEN '10' WHEN 'Nov' THEN '11' WHEN 'Dez' THEN '12'
  END || '-' || substr(data_efetiva, 1, 2)
WHERE length(data_efetiva) = 11
  AND substr(data_efetiva, 4, 3) IN ('Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez');
