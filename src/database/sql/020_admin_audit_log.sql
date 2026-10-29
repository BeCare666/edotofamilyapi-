-- Journal d'audit de l'admin (29/10/2026, audit sécurité 3.3). Rejouable, ne modifie aucune donnée existante.
-- Une ligne par action d'un compte de l'admin (super admin, boutique, équipe) : création, modification,
-- suppression, export. Jamais le contenu de la requête : seulement l'adresse masquée, le statut et l'IP.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  actor_user_id INT NOT NULL,
  actor_role VARCHAR(20) NOT NULL,
  method VARCHAR(8) NOT NULL,
  route VARCHAR(300) NOT NULL,
  resource VARCHAR(60) NULL,
  resource_id VARCHAR(64) NULL,
  status SMALLINT NOT NULL,
  ip VARCHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_admin_audit_actor (actor_user_id, created_at),
  KEY idx_admin_audit_resource (resource, resource_id),
  KEY idx_admin_audit_created (created_at)
);
