-- Campagnes gérées dans l'admin (décisions du 24/09/2026).
-- Statut calculé à partir des dates (à venir / en cours / terminée) : la colonne campaigns.status
-- n'est plus lue. Budget = somme des montants des sponsors.

-- Sponsors réutilisables d'une campagne à l'autre
CREATE TABLE IF NOT EXISTS sponsors (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sponsors_email (email)
);

-- Lien campagne ↔ sponsor (montant et code d'accès par campagne, comme avant)
ALTER TABLE campaign_sponsors ADD COLUMN IF NOT EXISTS sponsor_id INT NULL;

-- Une campagne se déroule dans une ou plusieurs villes
CREATE TABLE IF NOT EXISTS campaign_locations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  campaign_id INT NOT NULL,
  city VARCHAR(100) NOT NULL,
  UNIQUE KEY uq_campaign_city (campaign_id, city),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- Reprise des lieux existants, tels quels (une ville par campagne)
INSERT INTO campaign_locations (campaign_id, city)
SELECT c.id, TRIM(c.location) FROM campaigns c
WHERE c.location IS NOT NULL AND TRIM(c.location) <> ''
  AND NOT EXISTS (SELECT 1 FROM campaign_locations l WHERE l.campaign_id = c.id);

-- Ville du participant, enregistrée à l'inscription
ALTER TABLE campaign_registrations ADD COLUMN IF NOT EXISTS city VARCHAR(100) NULL;
