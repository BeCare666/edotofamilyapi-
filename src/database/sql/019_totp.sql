-- Double authentification (29/10/2026, audit sécurité 3.1). Rejouable, ne modifie aucune donnée existante.
-- totp_secret : clé de l'application d'authentification, chiffrée (src/common/health-crypto.ts, HEALTH_DATA_KEY).
-- totp_enabled_at : date d'activation (NULL = pas de double authentification).
-- totp_last_step : dernière période de 30 s acceptée, pour qu'un même code ne serve pas deux fois.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at DATETIME NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step BIGINT NULL;

-- Codes de secours (8 par compte, un seul usage) : seule l'empreinte SHA-256 est gardée
CREATE TABLE IF NOT EXISTS totp_recovery_codes (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  code_hash CHAR(64) NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_totp_recovery (user_id, code_hash)
);
