CREATE TABLE IF NOT EXISTS reviews (
  id INT NOT NULL AUTO_INCREMENT,
  order_id INT NOT NULL,
  user_id INT NOT NULL,
  shop_id INT DEFAULT NULL,
  product_id INT NOT NULL,
  variation_option_id INT DEFAULT NULL,
  comment TEXT NOT NULL,
  rating TINYINT NOT NULL DEFAULT 0,
  photos JSON DEFAULT NULL,
  positive_feedbacks_count INT DEFAULT 0,
  negative_feedbacks_count INT DEFAULT 0,
  abusive_reports_count INT DEFAULT 0,
  my_feedback JSON DEFAULT NULL,
  deleted_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id),
  
  CONSTRAINT fk_review_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_review_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE SET NULL,
  CONSTRAINT fk_review_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
