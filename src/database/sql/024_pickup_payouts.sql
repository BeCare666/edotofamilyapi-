-- Versements aux points de retrait (B7, 30/10/2026). Rejouable, ne modifie aucune donnée existante.
-- Le point gagne une commission à chaque remise (commande ou kit, migration 006) ; l'admin note ici chaque
-- paiement qu'il lui fait. Reste à verser = commissions gagnées - versements. Pas de frais.
CREATE TABLE IF NOT EXISTS pickup_payouts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  pickup_point_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  method VARCHAR(20) NOT NULL,
  reference VARCHAR(100) NULL,
  note VARCHAR(255) NULL,
  paid_at DATETIME NOT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  KEY idx_pickup_payouts_point (pickup_point_id, paid_at)
);
