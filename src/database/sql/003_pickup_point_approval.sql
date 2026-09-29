-- Validation des points de retrait par l'admin.
-- DEFAULT 1 : tous les comptes existants restent validés ; seules les nouvelles
-- inscriptions de points de retrait sont créées à 0 (en attente).
ALTER TABLE users ADD COLUMN IF NOT EXISTS pickup_approved TINYINT(1) NOT NULL DEFAULT 1;
