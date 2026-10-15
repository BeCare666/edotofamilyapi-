-- Espace sponsor, suite (15/10/2026) : inscription libre des sponsors et demandes de campagne.
-- Parcours : le sponsor s'inscrit → soumet une demande de campagne → l'admin valide ou refuse
-- → l'admin crée la campagne à partir de la demande validée (le sponsor y est rattaché).

-- Coordonnées de la personne de contact ; origine de la fiche (1 = inscrite par le sponsor lui-même)
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255) NULL;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS phone VARCHAR(40) NULL;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS self_registered TINYINT(1) NOT NULL DEFAULT 0;

-- Demandes de campagne soumises par les sponsors
-- pending = en attente · approved = validée (campagne à créer) · rejected = refusée (motif)
-- created = campagne créée par l'admin (campaign_id renseigné)
CREATE TABLE IF NOT EXISTS sponsor_campaign_proposals (
  id INT PRIMARY KEY AUTO_INCREMENT,
  sponsor_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  cities TEXT NOT NULL,
  date_start DATE NOT NULL,
  date_end DATE NOT NULL,
  objective_kits INT NOT NULL DEFAULT 0,
  budget DECIMAL(14,2) NOT NULL DEFAULT 0,
  status ENUM('pending', 'approved', 'rejected', 'created') NOT NULL DEFAULT 'pending',
  admin_note VARCHAR(500) NULL,
  campaign_id INT NULL,
  created_at DATETIME NOT NULL,
  decided_at DATETIME NULL,
  decided_by INT NULL,
  KEY idx_proposals_sponsor (sponsor_id),
  KEY idx_proposals_status (status),
  FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE CASCADE
);
