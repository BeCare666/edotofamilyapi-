-- Consentement et droits des personnes (30/10/2026, autorisation APDP n° 2026-327/AT/APDP/DST/SC, points b et f).
-- Rejouable, ne modifie aucune donnée existante. Une ligne par acceptation : compte, document, version du texte,
-- adresse IP et date (UTC). L'adresse IP est effacée quand le compte est rendu anonyme (src/users/inactivity.ts).
CREATE TABLE IF NOT EXISTS user_consents (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  document VARCHAR(40) NOT NULL,
  version VARCHAR(20) NOT NULL,
  ip VARCHAR(64) NULL,
  accepted_at DATETIME NOT NULL,
  KEY idx_user_consents_user (user_id, document)
);

-- Journal des demandes d'exercice des droits (30/10/2026, point f) : téléchargement des données, suppression du compte.
-- Une ligne par demande : compte, type, adresse IP, date (UTC). L'adresse IP est effacée avec le compte.
CREATE TABLE IF NOT EXISTS data_rights_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  kind VARCHAR(20) NOT NULL,
  ip VARCHAR(64) NULL,
  created_at DATETIME NOT NULL,
  KEY idx_data_rights_user (user_id, created_at)
);
