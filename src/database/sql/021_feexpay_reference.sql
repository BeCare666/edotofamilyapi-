-- Paiements FeexPay vérifiés côté serveur (29/10/2026, audit sécurité 1.1, C3). Rejouable.
-- Référence FeexPay de la transaction : une transaction ne paie qu'une seule commande (index unique).
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS feexpay_reference VARCHAR(64) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_intents_feexpay_ref ON payment_intents (feexpay_reference);
