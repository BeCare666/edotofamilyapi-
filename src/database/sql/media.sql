CREATE TABLE IF NOT EXISTS media (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,                           -- qui a uploadé le fichier
  url VARCHAR(500) NOT NULL,                      -- URL publique (S3 ou autre)
  `key` VARCHAR(255) NOT NULL,                     -- clé S3 pour retrouver ou supprimer
  mime_type VARCHAR(100),
  size INT,
  original_name VARCHAR(255),
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
