-- Informations du site réglées par le super admin (B5, 30/10/2026) : contact, carte, réseaux sociaux.
-- Une seule ligne (id = 1), lue par le site (pied de page, menu, page Contact). Rejouable.
-- Valeurs de départ = celles affichées jusqu'ici par le site ; réseaux sociaux vides (le site affichait des liens d'exemple).
CREATE TABLE IF NOT EXISTS site_info (
  id TINYINT NOT NULL PRIMARY KEY,
  phone VARCHAR(30) NULL,
  email VARCHAR(190) NULL,
  address VARCHAR(190) NULL,
  map_url VARCHAR(600) NULL,
  instagram VARCHAR(300) NULL,
  facebook VARCHAR(300) NULL,
  tiktok VARCHAR(300) NULL,
  linkedin VARCHAR(300) NULL,
  x_url VARCHAR(300) NULL,
  youtube VARCHAR(300) NULL,
  updated_at DATETIME NULL,
  updated_by INT NULL
);

INSERT IGNORE INTO site_info (id, phone, email, address) VALUES (1, '+229 01 67 69 81 91', 'contact@edotofamily.com', 'St Rita, Cotonou, Bénin');
