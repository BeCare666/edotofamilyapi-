CREATE TABLE IF NOT EXISTS product_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  categories_id INT NOT NULL, 
  sous_categories_id INT DEFAULT NULL,
  sub_categories_id INT DEFAULT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE, 
  FOREIGN KEY (sous_categories_id) REFERENCES sous_categories(id) ON DELETE CASCADE,
  FOREIGN KEY (sub_categories_id) REFERENCES sub_categories(id) ON DELETE CASCADE
);
/**FOREIGN KEY (categories_id) REFERENCES categories(id) ON DELETE CASCADE,**/