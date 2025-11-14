 
CREATE TABLE IF NOT EXISTS order_children (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  shop_id INT NOT NULL,
  image JSON NULL,
  order_quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  order_status ENUM(
    'order-pending',
    'order-processing',
    'order-completed',
    'order-cancelled',
    'order-refunded',
    'order-failed',
    'order-at-local-facility',
    'order-out-for-delivery'
  ) DEFAULT 'order-pending',
  payment_status ENUM(
    'payment-pending',
    'payment-processing',
    'payment-success',
    'payment-failed',
    'payment-cash-on-delivery',
    'payment-cash',
    'payment-wallet',
    'payment-awaiting-for-approval'
  ) DEFAULT 'payment-pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
