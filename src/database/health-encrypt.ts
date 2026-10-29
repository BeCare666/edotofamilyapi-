import * as dotenv from 'dotenv';
import * as mysql from 'mysql2/promise';
import { tidbSsl } from './tls';
import { HEALTH_FIELDS, healthEncryptionEnabled, isSealed, openFields, sealHealth } from '../common/health-crypto';

/**
 * Données de santé (audit sécurité 2.5, 29/10/2026).
 *   npm run health:encrypt                  → compte les valeurs encore en clair (aucune écriture)
 *   npm run health:encrypt -- --apply       → les chiffre avec HEALTH_DATA_KEY (rejouable)
 *   npm run health:encrypt -- --ai-logs 7   → affiche le journal du chat IA des 7 derniers jours, déchiffré (relecture)
 * À lancer avec la MÊME clé que Render (HEALTH_DATA_KEY dans .env, jamais commitée).
 */
dotenv.config();

const WITH_UPDATED_AT = new Set(['tc_reports', 'contraception_requests']);

async function connect() {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || '4000', 10),
    ssl: tidbSsl(),
  });
}

async function encrypt(conn: mysql.Connection, apply: boolean) {
  if (apply && !healthEncryptionEnabled()) throw new Error('HEALTH_DATA_KEY absente : rien ne peut être chiffré.');
  let plain = 0;
  let done = 0;
  for (const [table, list] of Object.entries(HEALTH_FIELDS)) {
    const fields: readonly string[] = list;
    const [rows]: any = await conn.query(`SELECT id, ${fields.join(', ')} FROM ${table}`);
    let tablePlain = 0;
    for (const row of rows) {
      const todo = fields.filter((f) => typeof row[f] === 'string' && row[f] !== '' && !isSealed(row[f]));
      if (!todo.length) continue;
      tablePlain += todo.length;
      if (!apply) continue;
      // Écriture seulement si la valeur n'a pas changé entre la lecture et la mise à jour
      const keep = WITH_UPDATED_AT.has(table) ? ', updated_at = updated_at' : '';
      const [res]: any = await conn.query(
        `UPDATE ${table} SET ${todo.map((f) => `${f} = ?`).join(', ')}${keep} WHERE id = ? AND ${todo.map((f) => `${f} = ?`).join(' AND ')}`,
        [...todo.map((f) => sealHealth(row[f])), row.id, ...todo.map((f) => row[f])],
      );
      if (res.affectedRows) done += todo.length;
    }
    plain += tablePlain;
    console.log(`${table} : ${rows.length} ligne(s), ${tablePlain} valeur(s) en clair`);
  }
  console.log(apply ? `✅ ${done} valeur(s) chiffrée(s) sur ${plain}.` : `ℹ️ ${plain} valeur(s) à chiffrer (relancer avec --apply).`);
}

async function aiLogs(conn: mysql.Connection, days: number) {
  const [rows]: any = await conn.query(
    `SELECT id, created_at, lang, status, question, answer, guard_reason FROM ai_chat_logs
     WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY) ORDER BY created_at DESC LIMIT 500`,
    [days],
  );
  for (const r of rows.map((x: any) => openFields(x, HEALTH_FIELDS.ai_chat_logs))) {
    console.log(`\n#${r.id} ${new Date(r.created_at).toISOString()} [${r.lang}] ${r.status}`);
    console.log(`Q : ${r.question}`);
    if (r.answer) console.log(`R : ${r.answer}`);
    if (r.guard_reason) console.log(`Motif : ${r.guard_reason}`);
  }
  console.log(`\n${rows.length} échange(s) sur ${days} jour(s).`);
}

async function main() {
  const args = process.argv.slice(2);
  const conn = await connect();
  try {
    const i = args.indexOf('--ai-logs');
    if (i >= 0) await aiLogs(conn, Math.min(90, Math.max(1, Number(args[i + 1]) || 7)));
    else await encrypt(conn, args.includes('--apply'));
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
