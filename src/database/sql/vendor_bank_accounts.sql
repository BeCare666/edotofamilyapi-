CREATE TABLE IF NOT EXISTS vendor_bank_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner_id INT NOT NULL,  
  account_holder VARCHAR(255) NOT NULL,
  account_number VARCHAR(255) NOT NULL,
  iban VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
