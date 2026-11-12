-- Tournées de retrait 09 h / 17 h (12/11/2026, rapports/PLAN_TOURNEES_RETRAIT.md, étape 1.1). Rejouable.
-- 1) Heure de disponibilité au point de retrait (tournée) et date d'envoi de la notification « disponible ».
--    NULL : livraison à domicile, commande non payée ou commande antérieure à ce chantier.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS available_at DATETIME NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS available_notified_at DATETIME NULL;
ALTER TABLE campaign_registrations ADD COLUMN IF NOT EXISTS available_at DATETIME NULL;
ALTER TABLE campaign_registrations ADD COLUMN IF NOT EXISTS available_notified_at DATETIME NULL;
CREATE INDEX IF NOT EXISTS idx_orders_available ON orders (available_notified_at, available_at);
CREATE INDEX IF NOT EXISTS idx_campaign_registrations_available ON campaign_registrations (available_notified_at, available_at);

-- 2) Jours d'ouverture d'un point de retrait (décision D8), réglés par le point lui-même.
--    Une ligne par point, créée au premier enregistrement ; sans ligne : ouvert tous les jours.
CREATE TABLE IF NOT EXISTS pickup_open_days (
  pickup_point_id INT NOT NULL PRIMARY KEY,
  mon TINYINT(1) NOT NULL DEFAULT 1,
  tue TINYINT(1) NOT NULL DEFAULT 1,
  wed TINYINT(1) NOT NULL DEFAULT 1,
  thu TINYINT(1) NOT NULL DEFAULT 1,
  fri TINYINT(1) NOT NULL DEFAULT 1,
  sat TINYINT(1) NOT NULL DEFAULT 1,
  sun TINYINT(1) NOT NULL DEFAULT 1,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 3) Dates de fermeture exceptionnelles (congés) d'un point : du … au … inclus (dates du Bénin).
CREATE TABLE IF NOT EXISTS pickup_closures (
  id INT PRIMARY KEY AUTO_INCREMENT,
  pickup_point_id INT NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pickup_closures_point (pickup_point_id, date_to)
);
