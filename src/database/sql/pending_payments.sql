CREATE TABLE IF NOT EXISTS pending_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tracking_number VARCHAR(255) NOT NULL,
  transaction_id VARCHAR(255) NOT NULL,
  feexpay_response JSON NULL,
  status ENUM('processing','completed','failed') NOT NULL DEFAULT 'processing',
  error_message TEXT NULL,
  payment_intent_id INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  INDEX idx_tracking_number (tracking_number),
  INDEX idx_status (status)
);
