-- Sessions (24/10/2026, audit sécurité 1.5, H3). Rejouable, ne modifie aucune donnée existante.
-- token_version est recopiée dans chaque jeton (tv) ; l'incrémenter ferme toutes les sessions du compte.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
