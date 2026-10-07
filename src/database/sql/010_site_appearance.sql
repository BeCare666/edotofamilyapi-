-- Police du site et de l'admin choisie par le super admin (07/10/2026).
-- Une seule ligne (id = 1). Valeur par défaut : Poppins (police actuelle).
CREATE TABLE IF NOT EXISTS site_appearance (
  id TINYINT NOT NULL PRIMARY KEY,
  font_key VARCHAR(40) NOT NULL DEFAULT 'poppins',
  updated_at DATETIME NULL,
  updated_by INT NULL
);

INSERT IGNORE INTO site_appearance (id, font_key) VALUES (1, 'poppins');
