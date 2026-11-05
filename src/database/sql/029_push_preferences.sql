-- Choix des notifications par sujet (05/11/2026, rapports/PLAN_PARAMETRES_COMPTES.md, décision P4). Rejouable.
-- Une ligne par compte, créée au premier changement ; sans ligne, tout est activé.
-- Le rappel contraception a son propre réglage (contraception_reminders) ; la notification d'activation part toujours.
CREATE TABLE IF NOT EXISTS push_preferences (
  user_id INT NOT NULL PRIMARY KEY,
  orders TINYINT(1) NOT NULL DEFAULT 1,
  appointments TINYINT(1) NOT NULL DEFAULT 1,
  campaigns TINYINT(1) NOT NULL DEFAULT 1,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
