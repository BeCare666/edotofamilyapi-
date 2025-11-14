-- 1. Supprimer la contrainte FK actuelle (qui pointe vers avatars)

CREATE TABLE IF NOT EXISTS profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bio TEXT DEFAULT NULL,
  socials TEXT DEFAULT NULL,
  contact VARCHAR(255) DEFAULT NULL,
  notifications TEXT DEFAULT NULL,
  customer_id INT NOT NULL,
  avatar_id INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(id),
  FOREIGN KEY (avatar_id) REFERENCES avatars(id)
);
