-- Données de santé (29/10/2026, audit sécurité 2.5, H6). Rejouable, ne modifie aucune donnée existante.
-- Les valeurs chiffrées (AES-256-GCM, src/common/health-crypto.ts) sont plus longues que le texte :
-- les colonnes concernées limitées en VARCHAR passent en TEXT (longueur des saisies toujours contrôlée par l'API).
ALTER TABLE tc_reports MODIFY COLUMN request_detail TEXT NULL;
ALTER TABLE tc_reports MODIFY COLUMN allergies TEXT NULL;
ALTER TABLE tc_reports MODIFY COLUMN current_treatments TEXT NULL;
ALTER TABLE tc_referrals MODIFY COLUMN completed_note TEXT NULL;
ALTER TABLE contraception_requests MODIFY COLUMN youth_note TEXT NULL;
ALTER TABLE contraception_requests MODIFY COLUMN admin_note TEXT NULL;
ALTER TABLE contraception_requests MODIFY COLUMN refuse_reason TEXT NULL;
ALTER TABLE contraception_requests MODIFY COLUMN conclusion_note TEXT NULL;
ALTER TABLE contraception_requests MODIFY COLUMN outcome_note TEXT NULL;
ALTER TABLE ai_chat_logs MODIFY COLUMN question TEXT NOT NULL;
ALTER TABLE ai_chat_logs MODIFY COLUMN guard_reason TEXT NULL;

-- Journal des accès aux dossiers de santé : qui (compte et rôle), quel dossier, quand, depuis quelle IP.
-- Écrit à chaque ouverture d'un dossier par un médecin, un centre ou le super admin.
CREATE TABLE IF NOT EXISTS health_access_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  actor_user_id INT NOT NULL,
  actor_role VARCHAR(20) NOT NULL,
  patient_user_id INT NULL,
  resource VARCHAR(30) NOT NULL,
  resource_id INT NOT NULL,
  ip VARCHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_health_access_patient (patient_user_id, created_at),
  KEY idx_health_access_actor (actor_user_id, created_at)
);
