-- Traitement par l'admin (06/10/2026) : « traitée » = l'admin a préparé le colis (commande payée)
-- ou le kit (demande de kit). Le statut existant ne change pas ; la commande / la demande devient
-- « terminée » quand elle est retirée, comme avant.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS processed_at DATETIME NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS processed_by INT NULL;
ALTER TABLE campaign_registrations ADD COLUMN IF NOT EXISTS processed_at DATETIME NULL;
ALTER TABLE campaign_registrations ADD COLUMN IF NOT EXISTS processed_by INT NULL;
