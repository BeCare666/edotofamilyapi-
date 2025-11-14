CREATE TABLE IF NOT EXISTS top_rate_products (
  id INT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  regular_price DECIMAL(10,2) NOT NULL,
  sale_price DECIMAL(10,2) DEFAULT NULL,
  min_price DECIMAL(10,2) NOT NULL,
  max_price DECIMAL(10,2) NOT NULL,
  product_type VARCHAR(50) NOT NULL,
  description TEXT,
  type_id INT NOT NULL,
  type_slug VARCHAR(50),
  total_rating INT DEFAULT 0,
  rating_count INT DEFAULT 0,
  actual_rating DECIMAL(3,2) DEFAULT 0,
  image_id INT,
  image_original VARCHAR(500),
  image_thumbnail VARCHAR(500)
);
