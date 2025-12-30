-- Table: users
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  is_verified BOOLEAN DEFAULT FALSE,
  role VARCHAR(20) NOT NULL DEFAULT 'customer',
  email_verified_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_active TINYINT(1) DEFAULT 1,
  shop_id INT DEFAULT NULL,
  email_verified TINYINT(1) DEFAULT 0
);
INSERT INTO users (
  name,
  email,
  password,
  role,
  is_verified,
  email_verified,
  email_verified_at,
  is_active,
  shop_id,
  created_at,
  updated_at
)
VALUES (
  'edotofamily',
  'hinlintransfert4@gmail.com',
  '$2b$10$mtPsMycP/lHTte/MKkdaNu2X3CHo4jPWVjUWYmbgoH/c8/LVFvBSq',
  'super_admin',
  1,
  1,
  NOW(),
  1,
  1, -- ✅ shop_id NON NULL
  NOW(),
  NOW()
);



-- Table: addresses
CREATE TABLE IF NOT EXISTS addresses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(50) DEFAULT NULL,
  type VARCHAR(50) DEFAULT NULL,
  default_flag TINYINT(1) DEFAULT 0,
  zip VARCHAR(20) DEFAULT NULL,
  city VARCHAR(100) DEFAULT NULL,
  state VARCHAR(100) DEFAULT NULL,
  country VARCHAR(100) DEFAULT NULL,
  street_address TEXT DEFAULT NULL,
  location TEXT DEFAULT NULL,
  customer_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(id)
);

-- Table: permissions
CREATE TABLE IF NOT EXISTS permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  guard_name VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Table: model_has_permissions
CREATE TABLE IF NOT EXISTS model_has_permissions (
  model_id INT NOT NULL,
  permission_id INT NOT NULL,
  model_type VARCHAR(100) DEFAULT NULL,
  FOREIGN KEY (model_id) REFERENCES users(id),
  FOREIGN KEY (permission_id) REFERENCES permissions(id)
);

-- Table: wallets
CREATE TABLE IF NOT EXISTS wallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  total_points INT DEFAULT 0,
  points_used INT DEFAULT 0,
  available_points INT DEFAULT 0,
  customer_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(id)
);
