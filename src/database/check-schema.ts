// Vérification de la STRUCTURE de la base (aucune donnée lue) : les tables et colonnes ajoutées
// par les migrations 008 à 015 existent-elles ? Lancement : npm run db:check
import * as dotenv from 'dotenv';
import * as mysql from 'mysql2/promise';
import { tidbSsl } from './tls';

dotenv.config();

const EXPECTED: { table: string; column?: string; migration: string }[] = [
  { table: 'campaign_registration_guards', migration: '008' },
  { table: 'orders', column: 'processed_at', migration: '009' },
  { table: 'orders', column: 'processed_by', migration: '009' },
  { table: 'campaign_registrations', column: 'processed_at', migration: '009' },
  { table: 'campaign_registrations', column: 'processed_by', migration: '009' },
  { table: 'site_appearance', migration: '010' },
  { table: 'sponsors', column: 'self_registered', migration: '011' },
  { table: 'sponsor_campaign_proposals', migration: '011' },
  { table: 'users', column: 'birth_date', migration: '012' },
  { table: 'users', column: 'sex', migration: '012' },
  { table: 'users', column: 'pickup_city', migration: '012' },
  { table: 'campaigns', column: 'target_sex', migration: '012' },
  { table: 'campaigns', column: 'target_age_min', migration: '012' },
  { table: 'campaign_registrations', column: 'request_city', migration: '012' },
  { table: 'tc_doctors', migration: '013' },
  { table: 'tc_availability', migration: '013' },
  { table: 'tc_time_off', migration: '013' },
  { table: 'tc_centers', migration: '013' },
  { table: 'tc_invitations', migration: '013' },
  { table: 'tc_appointments', migration: '013' },
  { table: 'tc_reports', migration: '013' },
  { table: 'tc_referrals', migration: '013' },
  { table: 'tc_doctors', column: 'is_house', migration: '014' },
  { table: 'contraceptive_methods', migration: '015' },
  { table: 'contraception_requests', migration: '015' },
  { table: 'contraception_followups', migration: '015' },
  { table: 'tc_referrals', column: 'contraception_request_id', migration: '015' },
  { table: 'tc_referrals', column: 'outcome', migration: '015' },
  { table: 'password_resets', column: 'attempts', migration: '016' },
  { table: 'users', column: 'token_version', migration: '017' },
  { table: 'health_access_log', migration: '018' },
  { table: 'users', column: 'totp_enabled_at', migration: '019' },
  { table: 'totp_recovery_codes', migration: '019' },
  { table: 'admin_audit_log', migration: '020' },
  { table: 'payment_intents', column: 'feexpay_reference', migration: '021' },
];

async function main() {
  // Audit sécurité 2.4 : TLS vérifié (src/database/tls.ts)
  const ssl = tidbSsl();
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || '4000', 10),
    ssl,
  });
  let missing = 0;
  for (const e of EXPECTED) {
    const [rows]: any = await conn.query(
      e.column
        ? `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`
        : `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      e.column ? [e.table, e.column] : [e.table],
    );
    const ok = rows.length > 0;
    if (!ok) missing++;
    console.log(`${ok ? '✅' : '❌'} migration ${e.migration} : ${e.table}${e.column ? '.' + e.column : ''}`);
  }
  await conn.end();
  console.log(missing ? `\n${missing} élément(s) manquant(s) : lancer « npm run db:setup ».` : '\nStructure à jour.');
}

main().catch((err) => {
  console.error('Vérification impossible :', err.message);
  process.exit(1);
});
