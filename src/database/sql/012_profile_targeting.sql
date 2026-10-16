-- Profil et ciblage des campagnes (16/10/2026). Rejouable : n'ajoute que ce qui manque, ne supprime rien.

-- Utilisateurs : date de naissance et sexe (female = femme ou fille, male = homme ou garçon)
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sex VARCHAR(10) NULL;

-- Points de retrait : ville déduite de leur position GPS (calculée par l'API, jamais saisie),
-- avec la position qui a servi au calcul (recalcul si le point change de position)
ALTER TABLE users ADD COLUMN IF NOT EXISTS pickup_city VARCHAR(100) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pickup_city_src VARCHAR(60) NULL;

-- Campagnes : sexe ciblé (all = les deux) et tranche d'âge (NULL = sans limite)
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS target_sex VARCHAR(10) NOT NULL DEFAULT 'all';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS target_age_min TINYINT UNSIGNED NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS target_age_max TINYINT UNSIGNED NULL;

-- Demandes de kit : position et ville réellement constatées au moment de la demande
ALTER TABLE campaign_registrations ADD COLUMN IF NOT EXISTS request_lat DECIMAL(10,8) NULL;
ALTER TABLE campaign_registrations ADD COLUMN IF NOT EXISTS request_lng DECIMAL(11,8) NULL;
ALTER TABLE campaign_registrations ADD COLUMN IF NOT EXISTS request_city VARCHAR(100) NULL;
