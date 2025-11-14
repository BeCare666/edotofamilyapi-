 
CREATE TABLE IF NOT EXISTS invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  shop_id INT NULL,
  pdf_url VARCHAR(500) NOT NULL,
  type ENUM('client', 'shop') NOT NULL,
  status ENUM('pending','generated','sent','failed') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);
