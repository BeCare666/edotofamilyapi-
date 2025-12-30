 
CREATE TABLE IF NOT EXISTS shops (
  id INT AUTO_INCREMENT PRIMARY KEY,                          -- ID auto-incrémenté
  owner_id INT NOT NULL,                                      -- ID du propriétaire (user)
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,                          -- slug unique pour les URLs
  description TEXT,

  is_active BOOLEAN NOT NULL DEFAULT FALSE,                    -- statut actif ou non
  rating FLOAT DEFAULT 0,                                      -- note du shop pour topShops

  -- Adresse simple (pas d'entité séparée)
  zip VARCHAR(20),
  city VARCHAR(100),
  state VARCHAR(100),
  country VARCHAR(100),
  street_address VARCHAR(255),

  -- Contact et site web
  contact VARCHAR(50),
  website VARCHAR(255),

  -- Localisation GPS + adresse formatée (stockée en JSON)
  location JSON DEFAULT NULL,

  -- Images par relation (optionnelles)
  cover_image_id INT DEFAULT NULL,
  logo_image_id INT DEFAULT NULL,

  -- Compteurs
  orders_count INT DEFAULT 0,
  products_count INT DEFAULT 0,
  wallet_balance DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Solde disponible pour le retrait',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,

  -- Contraintes et relations
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (cover_image_id) REFERENCES media(id) ON DELETE SET NULL,
  FOREIGN KEY (logo_image_id) REFERENCES media(id) ON DELETE SET NULL
);
INSERT INTO shops (
  id,
  owner_id,
  name,
  slug,
  description,
  is_active,
  rating,
  zip,
  city,
  state,
  country,
  street_address,
  contact,
  website,
  location,
  cover_image_id,
  logo_image_id,
  orders_count,
  products_count,
  wallet_balance,
  created_at,
  updated_at
)
VALUES (
  1,                      -- ✅ ID du shop
  23,                     -- ✅ owner_id
  'Edoto Family Shop',
  'edoto-family-shop',
  'Boutique officielle Edoto Family',
  TRUE,
  0,
  '00000',
  'Cotonou',
  'Littoral',
  'Bénin',
  'Rue principale',
  '+22900000000',
  'https://edotofamily.com',
  NULL,
  NULL,
  NULL,
  0,
  0,
  0.00,
  NOW(),
  NOW()
);
