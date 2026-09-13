-- Pose do avatar no círculo do perfil — direção do corpo, da cabeça e
-- expressão facial, escolhidas pelo próprio usuário. NULL em qualquer
-- um = usa o padrão atual (direção 2, sem gesto).
ALTER TABLE usuarios ADD COLUMN avatar_direction TEXT;
ALTER TABLE usuarios ADD COLUMN avatar_head_direction TEXT;
ALTER TABLE usuarios ADD COLUMN avatar_gesture TEXT;
