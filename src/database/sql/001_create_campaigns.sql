CREATE TABLE IF NOT EXISTS campaigns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  image_url VARCHAR(500),
  location VARCHAR(255) NOT NULL,
  date_start DATE NOT NULL,
  date_end DATE DEFAULT NULL,
  status ENUM('a_venir','planifie','en_cours') NOT NULL DEFAULT 'a_venir',
  objective_kits INT DEFAULT 0,
  distributed_kits INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

