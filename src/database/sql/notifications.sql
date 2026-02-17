-- 1. Supprimer les colonnes title et message

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(50) DEFAULT 'system',
  title_key VARCHAR(255) NOT NULL,
  message_key VARCHAR(255),
  message_params JSON DEFAULT NULL,
  icon VARCHAR(100) NULL,
  priority VARCHAR(50) DEFAULT 'normal',
  data TEXT NULL,
  link VARCHAR(255) NULL,
  is_read TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
