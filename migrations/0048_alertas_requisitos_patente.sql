-- Guarda, no momento da criação do requerimento, quais requisitos de
-- `requisitos_patente` cada alvo ainda não cumpre para a patente de
-- destino (curso, tempo mínimo, certificado, grupo). É só um apêndice
-- informativo (JSON: { [alvoId]: string[] }) — não bloqueia o envio
-- nem a aprovação, serve pra o CRH ver o alerta na hora de decidir.
ALTER TABLE requerimentos ADD COLUMN alertas_requisitos TEXT;
