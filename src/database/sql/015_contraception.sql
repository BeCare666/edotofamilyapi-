-- Adoption des contraceptifs (21/10/2026). Rejouable : ne crée que ce qui manque, ne supprime rien.
-- Fiches modifiables par le super admin ; fiches par défaut (manuel OMS) chargées par l'API si la table est vide.

-- Fiche d'une méthode contraceptive (listes en JSON : avantages, inconvénients, critères)
CREATE TABLE IF NOT EXISTS contraceptive_methods (
  id INT PRIMARY KEY AUTO_INCREMENT,
  slug VARCHAR(60) NOT NULL,
  name VARCHAR(120) NOT NULL,
  family VARCHAR(80) NULL,
  requires_doctor TINYINT(1) NOT NULL DEFAULT 1,
  summary VARCHAR(400) NULL,
  description TEXT NULL,
  how_to TEXT NULL,
  advantages TEXT NULL,
  drawbacks TEXT NULL,
  criteria TEXT NULL,
  efficacy VARCHAR(120) NULL,
  duration VARCHAR(120) NULL,
  protects_sti TINYINT(1) NOT NULL DEFAULT 0,
  image_url VARCHAR(500) NULL,
  image_credit VARCHAR(300) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_contraceptive_methods_slug (slug)
);

-- Demande d'adoption d'un jeune, suivie en 7 étapes :
-- 1 demande, 2 acceptation (super admin), 3 rencontre avec un médecin (sauf méthode sans médecin),
-- 4 adoption conclue, 5 passage au centre recommandé, 6 adoption faite ou non, 7 suivi avec rapports
CREATE TABLE IF NOT EXISTS contraception_requests (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  method_id INT NOT NULL,
  requires_doctor TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  youth_note VARCHAR(600) NULL,
  admin_note VARCHAR(600) NULL,
  accepted_at DATETIME NULL,
  accepted_by INT NULL,
  refused_at DATETIME NULL,
  refuse_reason VARCHAR(600) NULL,
  appointment_id INT NULL,
  concluded_at DATETIME NULL,
  conclusion VARCHAR(12) NULL,
  conclusion_note VARCHAR(1500) NULL,
  referral_id INT NULL,
  outcome VARCHAR(12) NULL,
  outcome_at DATETIME NULL,
  outcome_note VARCHAR(600) NULL,
  cancelled_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_contraception_requests_user (user_id, status),
  KEY idx_contraception_requests_status (status, created_at),
  KEY idx_contraception_requests_appointment (appointment_id),
  KEY idx_contraception_requests_referral (referral_id)
);

-- Étape 7 : rapports de suivi (jeune ou équipe E.doto family)
CREATE TABLE IF NOT EXISTS contraception_followups (
  id INT PRIMARY KEY AUTO_INCREMENT,
  request_id INT NOT NULL,
  author_role VARCHAR(12) NOT NULL,
  author_id INT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_contraception_followups_request (request_id, created_at)
);

-- Orientation sans téléconsultation (méthode sans médecin) : pas de rendez-vous ni de compte rendu
ALTER TABLE tc_referrals MODIFY COLUMN report_id INT NULL;
ALTER TABLE tc_referrals MODIFY COLUMN appointment_id INT NULL;
ALTER TABLE tc_referrals ADD COLUMN IF NOT EXISTS contraception_request_id INT NULL;
-- Étape 6 : adoption faite (done) ou non (not_done), renseignée par le centre
ALTER TABLE tc_referrals ADD COLUMN IF NOT EXISTS outcome VARCHAR(12) NULL;
