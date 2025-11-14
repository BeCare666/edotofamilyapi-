CREATE TABLE IF NOT EXISTS categories (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  language VARCHAR(10),
  icon VARCHAR(255) DEFAULT NULL,
  image_id INT DEFAULT NULL, -- clé étrangère vers media pour l'image principale
  details TEXT,
  parent_id INT DEFAULT NULL, -- id de la catégorie parente
  type_id INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  translated_languages JSON DEFAULT NULL,
  type JSON DEFAULT NULL,
  children JSON DEFAULT NULL,
  FOREIGN KEY (image_id) REFERENCES media(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
);
