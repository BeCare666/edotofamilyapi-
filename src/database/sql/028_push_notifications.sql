-- Notifications push (04/11/2026, rapports/PLAN_NOTIFICATIONS_PUSH.md). Rejouable.
-- 1) Abonnements : un par navigateur ou application où la personne a activé les notifications.
--    Seulement l'adresse d'envoi fournie par le navigateur et ses deux clés ; aucun contenu de notification n'est gardé.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  endpoint VARCHAR(600) NOT NULL,
  endpoint_hash CHAR(64) NOT NULL,
  p256dh VARCHAR(200) NOT NULL,
  auth VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_success_at DATETIME NULL,
  UNIQUE KEY uq_push_subscriptions_endpoint (endpoint_hash),
  KEY idx_push_subscriptions_user (user_id)
);

-- 2) Rappel contraception à rythme libre (décision D4) : réglé par la personne, aucun calcul médical.
--    rhythm : daily, weekly, every4weeks, every3months, once. time_hm : heure locale du Bénin (HH:MM).
CREATE TABLE IF NOT EXISTS contraception_reminders (
  user_id INT NOT NULL PRIMARY KEY,
  rhythm VARCHAR(16) NOT NULL,
  time_hm CHAR(5) NOT NULL,
  start_date DATE NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  last_sent_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_contraception_reminders_active (active)
);

-- 3) Nouvelle campagne : date d'envoi de la notification, pour ne l'envoyer qu'une fois
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS push_sent_at DATETIME NULL;
-- Les campagnes déjà commencées ne sont pas annoncées après coup
UPDATE campaigns SET push_sent_at = NOW() WHERE push_sent_at IS NULL AND date_start <= NOW();
