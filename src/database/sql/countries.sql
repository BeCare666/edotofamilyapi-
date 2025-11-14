 
CREATE TABLE IF NOT EXISTS countries (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  code VARCHAR(10) NOT NULL UNIQUE,           -- ex: BJ
  iso3 CHAR(3),
  phone_code VARCHAR(10),
  currency VARCHAR(10),
  continent VARCHAR(50),
  flag_url VARCHAR(255),                      -- ex: https://flagcdn.com/bj.svg
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
