-- Chat « IA Edotofamily » (25/09/2026) : journal anonymisé des échanges, relu par les pros de santé.
-- Ni IP ni identifiant en clair : seulement l'empreinte SHA-256 de la session du navigateur.
CREATE TABLE IF NOT EXISTS ai_chat_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  session_hash CHAR(64) NOT NULL,
  lang VARCHAR(5) NOT NULL,
  question VARCHAR(500) NOT NULL,
  status ENUM('answered', 'referred', 'emergency', 'refused', 'error') NOT NULL,
  sources JSON NULL,
  model VARCHAR(64) NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ai_chat_logs_created (created_at),
  KEY idx_ai_chat_logs_status (status)
);
