-- Une seule demande de kit par personne et par campagne (06/10/2026), même avec un autre compte.
-- Marques d'une demande : compte, e-mail, appareil, empreinte du navigateur, adresse IP
-- (empreintes SHA-256 uniquement). La clé primaire bloque aussi deux demandes simultanées.
CREATE TABLE IF NOT EXISTS campaign_registration_guards (
  campaign_id INT NOT NULL,
  kind VARCHAR(16) NOT NULL,
  value_hash CHAR(64) NOT NULL,
  registration_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (campaign_id, kind, value_hash),
  KEY idx_guards_registration (registration_id)
);

-- Demandes existantes : leur e-mail devient une marque (même calcul que l'API : SHA-256 de « email:<e-mail en minuscules> »)
INSERT IGNORE INTO campaign_registration_guards (campaign_id, kind, value_hash, registration_id)
SELECT campaign_id, 'email', SHA2(CONCAT('email:', LOWER(TRIM(email))), 256), id
FROM campaign_registrations;
