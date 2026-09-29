-- Espace sponsor (décisions du 25/09/2026) : compte sur invitation de l'admin, campagnes soutenues
-- uniquement, export Excel d'une campagne terminée après validation de l'admin.

-- Compte sponsor (users.role = 'sponsor') rattaché à la fiche sponsor
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS user_id INT NULL;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS invited_at DATETIME NULL;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS activated_at DATETIME NULL;

-- Lien d'invitation (empreinte SHA-256 du secret envoyé par e-mail), un seul actif par sponsor
CREATE TABLE IF NOT EXISTS sponsor_invitations (
  sponsor_id INT PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sponsor_invitations_token (token_hash),
  FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE CASCADE
);

-- Demandes d'export : une par campagne et par sponsor (redemandée après un refus)
CREATE TABLE IF NOT EXISTS sponsor_export_requests (
  id INT PRIMARY KEY AUTO_INCREMENT,
  campaign_id INT NOT NULL,
  sponsor_id INT NOT NULL,
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  reason VARCHAR(500) NULL,
  requested_at DATETIME NOT NULL,
  decided_at DATETIME NULL,
  decided_by INT NULL,
  UNIQUE KEY uq_export_campaign_sponsor (campaign_id, sponsor_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE CASCADE
);
