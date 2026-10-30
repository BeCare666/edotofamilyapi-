-- Conservation : six mois après la fin d'activité (30/10/2026, autorisation APDP n° 2026-327/AT/APDP/DST/SC, point a).
-- Rejouable. last_activity_at : dernière connexion ou dernier renouvellement de session (au plus une écriture par jour).
-- inactivity_notice_at : e-mail de prévenance envoyé ; anonymized_at : identité effacée.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity_at DATETIME NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inactivity_notice_at DATETIME NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS anonymized_at DATETIME NULL;
CREATE INDEX IF NOT EXISTS idx_users_last_activity ON users (role, last_activity_at);
-- Comptes créés avant la mise en place : leur activité passée n'est pas connue, le délai part du 30/10/2026
-- (aucun compte n'est donc supprimé le jour de la mise en ligne).
UPDATE users SET last_activity_at = '2026-10-30 00:00:00' WHERE last_activity_at IS NULL AND created_at < '2026-10-30 00:00:00';
