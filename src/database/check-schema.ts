// Vérification de la STRUCTURE de la base (aucune donnée lue) : les tables et colonnes ajoutées
// par les migrations 008, 009 et 010 existent-elles ? Lancement : npm run db:check
import * as dotenv from 'dotenv';
import * as mysql from 'mysql2/promise';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

dotenv.config();

const EXPECTED: { table: string; column?: string; migration: string }[] = [
  { table: 'campaign_registration_guards', migration: '008' },
  { table: 'orders', column: 'processed_at', migration: '009' },
  { table: 'orders', column: 'processed_by', migration: '009' },
  { table: 'campaign_registrations', column: 'processed_at', migration: '009' },
  { table: 'campaign_registrations', column: 'processed_by', migration: '009' },
  { table: 'site_appearance', migration: '010' },
];

async function main() {
  const certPath = join(__dirname, 'certs', 'tidb-ca.pem');
  const ssl = existsSync(certPath) ? { ca: readFileSync(certPath, 'utf8'), rejectUnauthorized: false } : { rejectUnauthorized: false };
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
