-- Retraits des points de retrait et remboursements (B7, 30/10/2026). Rejouable, ne modifie aucune donnée existante.

-- Le point demande le retrait de ses commissions ; l'admin paie (versement noté dans pickup_payouts, payout_id)
-- ou refuse avec un motif ; le point peut annuler tant que la demande est en attente.
-- status : pending | paid | rejected | cancelled
CREATE TABLE IF NOT EXISTS pickup_withdrawal_requests (
  id INT PRIMARY KEY AUTO_INCREMENT,
  pickup_point_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  method VARCHAR(20) NOT NULL,
  account VARCHAR(100) NOT NULL,
  note VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  admin_note VARCHAR(255) NULL,
  payout_id INT NULL,
  decided_by INT NULL,
  decided_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  KEY idx_withdrawal_point (pickup_point_id, status),
  KEY idx_withdrawal_status (status, created_at)
);

-- Remboursement d'une commande payée et pas encore retirée (une seule fois par commande).
CREATE TABLE IF NOT EXISTS order_refunds (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  method VARCHAR(20) NOT NULL,
  reference VARCHAR(100) NULL,
  reason VARCHAR(255) NOT NULL,
  refunded_at DATETIME NOT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_order_refunds_order (order_id)
);
