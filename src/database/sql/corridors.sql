
CREATE TABLE IF NOT EXISTS corridors (
  id VARCHAR(50) PRIMARY KEY,
  from_countries_id INT NOT NULL,
  from_countries_code VARCHAR(5),
  from_latitude DECIMAL(9,6),
  from_longitude DECIMAL(9,6),
  to_countries_id INT NOT NULL,
  to_countries_code VARCHAR(5),
  to_latitude DECIMAL(9,6),
  to_longitude DECIMAL(9,6),
  douanes TEXT,
  taxes VARCHAR(20),
  logistique TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (from_countries_id) REFERENCES countries(id) ON DELETE CASCADE,
  FOREIGN KEY (to_countries_id) REFERENCES countries(id) ON DELETE CASCADE
);

