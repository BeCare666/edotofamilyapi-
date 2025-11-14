 
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_id INT NOT NULL,
  order_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  type ENUM('credit','debit') NOT NULL,
  status ENUM('pending','success','failed') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shop_id) REFERENCES shops(id)
);
