CREATE TABLE IF NOT EXISTS reports (
  id INT PRIMARY KEY,
  user_id INT NOT NULL,
  model_type VARCHAR(255) NOT NULL,
  model_id INT NOT NULL,
  message TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  
  FOREIGN KEY (user_id) REFERENCES users(id)
);
