 CREATE TABLE IF NOT EXISTS terms_and_conditions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'global', -- global / shop
  issued_by VARCHAR(100) DEFAULT 'Super Admin',
  is_approved TINYINT(1) DEFAULT 0, -- 0 = false, 1 = true
  language VARCHAR(10) DEFAULT 'en',
  logo_id INT NULL,
  translated_languages JSON DEFAULT (JSON_ARRAY()), -- tableau de langues
  shop_id INT DEFAULT NULL, -- FK vers shops
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  CONSTRAINT fk_terms_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE SET NULL
);
