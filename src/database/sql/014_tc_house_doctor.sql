-- Téléconsultation (20/10/2026) : médecin E.doto family. Rejouable, ne supprime rien.
-- Il prend en charge toutes les heures où aucun autre médecin n'est libre (un seul à la fois).
ALTER TABLE tc_doctors ADD COLUMN IF NOT EXISTS is_house TINYINT(1) NOT NULL DEFAULT 0;
