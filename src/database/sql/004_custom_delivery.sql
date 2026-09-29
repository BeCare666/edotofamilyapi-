-- Livraison personnalisée (lieu décrit par le client, livrée par un zem que l'admin désigne).
-- Réglages : prix au kilomètre et position du centre de traitement, modifiables dans l'admin.
-- Table dédiée (une seule ligne, id = 1) : le formulaire des réglages généraux réécrit
-- settings.options en entier et ne doit pas pouvoir effacer ces valeurs.
CREATE TABLE IF NOT EXISTS delivery_settings (
  id TINYINT PRIMARY KEY,
  price_per_km DECIMAL(10,2) NULL,
  center_lat DECIMAL(10,8) NULL,
  center_lng DECIMAL(11,8) NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
INSERT IGNORE INTO delivery_settings (id) VALUES (1);

-- Une ligne par commande livrée à domicile. Le prix est figé à la commande
-- (distance, prix au km appliqué, frais). Le lien du zem et son PIN ne sont stockés
-- qu'en empreinte SHA-256 ; device_hash = premier téléphone qui a ouvert le lien.
CREATE TABLE IF NOT EXISTS custom_deliveries (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_id INT NOT NULL,
  description VARCHAR(150) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  lat DECIMAL(10,8) NOT NULL,
  lng DECIMAL(11,8) NOT NULL,
  distance_km DECIMAL(8,2) NOT NULL,
  price_per_km DECIMAL(10,2) NOT NULL,
  fee DECIMAL(10,2) NOT NULL,
  courier_name VARCHAR(100) NULL,
  courier_phone VARCHAR(30) NULL,
  link_token_hash CHAR(64) NULL,
  pin_hash CHAR(64) NULL,
  device_hash CHAR(64) NULL,
  failed_attempts INT NOT NULL DEFAULT 0,
  link_blocked TINYINT(1) NOT NULL DEFAULT 0,
  assigned_at DATETIME NULL,
  delivered_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_custom_deliveries_order (order_id),
  UNIQUE KEY uq_custom_deliveries_token (link_token_hash),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);
