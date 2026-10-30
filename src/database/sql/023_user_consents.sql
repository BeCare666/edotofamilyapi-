-- Consentement à la collecte et au transfert des données (30/10/2026, autorisation APDP n° 2026-327/AT/APDP/DST/SC, point b).
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
