-- Mot de passe oublié (22/10/2026, audit sécurité C4). Rejouable, ne supprime aucun compte.
-- otp reçoit désormais l'empreinte SHA-256 du code (64 caractères) ; attempts compte les essais (5 au plus).
ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
ALTER TABLE password_resets MODIFY COLUMN otp VARCHAR(64) NOT NULL;
-- Les anciens codes étaient stockés en clair : ils sont invalidés
DELETE FROM password_resets WHERE CHAR_LENGTH(otp) < 64;
