-- Téléconsultation (19/10/2026). Rejouable : ne crée que ce qui manque, ne supprime rien.
-- Comptes : users.role = 'doctor' (médecin) et 'health_center' (centre ABPF, ABMS, clinique),
-- créés par le super admin sur invitation (lien de 7 jours, comme les sponsors).

-- Fiche du médecin (affichée au jeune après la réservation)
CREATE TABLE IF NOT EXISTS tc_doctors (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(30) NULL,
  title VARCHAR(120) NULL,
  bio VARCHAR(600) NULL,
  slot_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  invited_at DATETIME NULL,
  activated_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tc_doctors_email (email),
  KEY idx_tc_doctors_user (user_id)
);

-- Disponibilités hebdomadaires du médecin (heure du Bénin) : jour 1 = lundi … 7 = dimanche
CREATE TABLE IF NOT EXISTS tc_availability (
  id INT PRIMARY KEY AUTO_INCREMENT,
  doctor_id INT NOT NULL,
  weekday TINYINT UNSIGNED NOT NULL,
  start_time CHAR(5) NOT NULL,
  end_time CHAR(5) NOT NULL,
  modes VARCHAR(20) NOT NULL DEFAULT 'both',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_tc_availability_doctor (doctor_id, weekday)
);

-- Jours d'absence du médecin (congés, indisponibilités ponctuelles), dates du Bénin
CREATE TABLE IF NOT EXISTS tc_time_off (
  id INT PRIMARY KEY AUTO_INCREMENT,
  doctor_id INT NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  reason VARCHAR(200) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_tc_time_off_doctor (doctor_id, date_from)
);

-- Centres de prise en charge (ABPF, ABMS, cliniques) recommandés par le médecin
CREATE TABLE IF NOT EXISTS tc_centers (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NULL,
  name VARCHAR(160) NOT NULL,
  organization VARCHAR(20) NOT NULL DEFAULT 'other',
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(30) NULL,
  city VARCHAR(100) NULL,
  address VARCHAR(255) NULL,
  services VARCHAR(600) NULL,
  opening_hours VARCHAR(200) NULL,
  lat DECIMAL(10,8) NULL,
  lng DECIMAL(11,8) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  invited_at DATETIME NULL,
  activated_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tc_centers_email (email),
  KEY idx_tc_centers_user (user_id)
);

-- Liens d'invitation (empreinte SHA-256 du secret envoyé par e-mail) : kind = doctor | center
CREATE TABLE IF NOT EXISTS tc_invitations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  kind VARCHAR(10) NOT NULL,
  target_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tc_invitations_target (kind, target_id),
  UNIQUE KEY uq_tc_invitations_token (token_hash)
);

-- Rendez-vous. starts_at / ends_at en UTC. slot_lock = 1 tant que le rendez-vous occupe le créneau
-- (NULL une fois annulé) : l'index unique empêche deux réservations du même créneau chez le même médecin.
CREATE TABLE IF NOT EXISTS tc_appointments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  reference VARCHAR(16) NOT NULL,
  doctor_id INT NOT NULL,
  patient_user_id INT NOT NULL,
  mode VARCHAR(10) NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'booked',
  slot_lock TINYINT NULL DEFAULT 1,
  patient_name VARCHAR(120) NOT NULL,
  patient_email VARCHAR(190) NULL,
  patient_phone VARCHAR(30) NULL,
  reason VARCHAR(300) NULL,
  room VARCHAR(80) NULL,
  confirmation_sent_at DATETIME NULL,
  reminder_email_at DATETIME NULL,
  reminder_sms_at DATETIME NULL,
  reminder_error VARCHAR(300) NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  cancelled_by VARCHAR(10) NULL,
  cancel_reason VARCHAR(300) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tc_appointments_reference (reference),
  UNIQUE KEY uq_tc_appointments_slot (doctor_id, starts_at, slot_lock),
  KEY idx_tc_appointments_patient (patient_user_id, starts_at),
  KEY idx_tc_appointments_start (status, starts_at)
);

-- Compte rendu du médecin à la fin de la téléconsultation (un par rendez-vous)
CREATE TABLE IF NOT EXISTS tc_reports (
  id INT PRIMARY KEY AUTO_INCREMENT,
  appointment_id INT NOT NULL,
  doctor_id INT NOT NULL,
  patient_user_id INT NOT NULL,
  request_type VARCHAR(30) NOT NULL,
  request_detail VARCHAR(300) NULL,
  chief_complaint TEXT NULL,
  history TEXT NULL,
  gyneco_history TEXT NULL,
  allergies VARCHAR(300) NULL,
  current_treatments VARCHAR(300) NULL,
  findings TEXT NULL,
  assessment TEXT NULL,
  plan TEXT NULL,
  urgency VARCHAR(12) NOT NULL DEFAULT 'routine',
  center_id INT NULL,
  center_instructions TEXT NULL,
  patient_summary TEXT NULL,
  finalized_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tc_reports_appointment (appointment_id),
  KEY idx_tc_reports_patient (patient_user_id)
);

-- Orientation vers un centre : code QR (jeton secret) et code court (rendez-vous par appel)
CREATE TABLE IF NOT EXISTS tc_referrals (
  id INT PRIMARY KEY AUTO_INCREMENT,
  report_id INT NOT NULL,
  appointment_id INT NOT NULL,
  patient_user_id INT NOT NULL,
  center_id INT NOT NULL,
  token VARCHAR(64) NOT NULL,
  short_code VARCHAR(12) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'issued',
  expires_at DATETIME NOT NULL,
  sent_email_at DATETIME NULL,
  sent_sms_at DATETIME NULL,
  viewed_at DATETIME NULL,
  viewed_by INT NULL,
  completed_at DATETIME NULL,
  completed_by INT NULL,
  completed_note VARCHAR(600) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tc_referrals_report (report_id),
  UNIQUE KEY uq_tc_referrals_token (token),
  UNIQUE KEY uq_tc_referrals_code (short_code),
  KEY idx_tc_referrals_center (center_id, status)
);
