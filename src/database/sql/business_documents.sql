CREATE TABLE IF NOT EXISTS business_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner_id INT NOT NULL,                     -- user/owner
  type VARCHAR(100) NOT NULL,                -- ex: business_license, id_card, commerce_register
  url VARCHAR(255) NOT NULL,                 -- URL du document
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
