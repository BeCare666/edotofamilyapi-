-- Chat « Assistant SSR » (25/09/2026, garde-fous ajoutés le 01/10/2026) : journal anonymisé des échanges,
-- relu par les pros de santé. Ni IP ni identifiant en clair : seulement l'empreinte SHA-256 de la session.
-- status « blocked » : réponse rejetée par les contrôles (texte gardé dans answer, raison dans guard_reason).
-- status « quota » : limite gratuite du fournisseur d'IA atteinte.
CREATE TABLE IF NOT EXISTS ai_chat_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  session_hash CHAR(64) NOT NULL,
  lang VARCHAR(5) NOT NULL,
  question VARCHAR(500) NOT NULL,
  answer TEXT NULL,
  status ENUM('answered', 'referred', 'emergency', 'refused', 'error', 'blocked', 'quota') NOT NULL,
  guard_reason VARCHAR(1000) NULL,
  sources JSON NULL,
  model VARCHAR(64) NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ai_chat_logs_created (created_at),
  KEY idx_ai_chat_logs_status (status)
);

-- Mise à niveau d'une table créée avant le 01/10/2026
ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS answer TEXT NULL;
ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS guard_reason VARCHAR(1000) NULL;
ALTER TABLE ai_chat_logs MODIFY COLUMN status ENUM('answered', 'referred', 'emergency', 'refused', 'error', 'blocked', 'quota') NOT NULL;
