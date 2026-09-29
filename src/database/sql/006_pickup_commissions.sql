-- Commissions des points de retrait (décisions du 25/09/2026), réglées par l'admin :
-- commandes = pourcentage du montant des produits ; kits = montant fixe (FCFA) par kit retiré.
-- Valeur par défaut commune + valeur particulière possible par point de retrait.
CREATE TABLE IF NOT EXISTS pickup_commission_settings (
  id TINYINT PRIMARY KEY,
  order_rate_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  kit_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
INSERT IGNORE INTO pickup_commission_settings (id) VALUES (1);

-- NULL = le point suit la valeur par défaut
CREATE TABLE IF NOT EXISTS pickup_commission_overrides (
  pickup_point_id INT PRIMARY KEY,
  order_rate_percent DECIMAL(5,2) NULL,
  kit_amount DECIMAL(10,2) NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (pickup_point_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Commission figée au moment du retrait (un changement de valeur ne modifie pas le passé)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_rate DECIMAL(5,2) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_amount DECIMAL(10,2) NULL;
ALTER TABLE campaign_registrations ADD COLUMN IF NOT EXISTS commission_amount DECIMAL(10,2) NULL;
