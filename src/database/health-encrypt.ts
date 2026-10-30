import * as dotenv from 'dotenv';
import * as mysql from 'mysql2/promise';
import { tidbSsl } from './tls';
import { HEALTH_FIELDS, healthEncryptionEnabled, isSealed, openFields, rekeyHealth, sealHealth, sealedKeyId } from '../common/health-crypto';

/**
 * Données de santé (audit sécurité 2.5, 29/10/2026).
 *   npm run health:encrypt                  → compte les valeurs encore en clair (aucune écriture)
 *   npm run health:encrypt -- --apply       → les chiffre avec HEALTH_DATA_KEY (rejouable)
 *   npm run health:encrypt -- --rekey       → compte les valeurs chiffrées avec une ancienne clé, par clé (aucune écriture)
 *   npm run health:encrypt -- --rekey --apply → les rechiffre avec la clé actuelle (rotation, rejouable)
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

// Rotation (30/10/2026) : nouvelle clé dans HEALTH_DATA_KEY + HEALTH_DATA_KEY_ID, ancienne dans HEALTH_DATA_OLD_KEYS.
// Une fois le compte à zéro, l'ancienne clé peut être retirée de HEALTH_DATA_OLD_KEYS.
async function rekey(conn: mysql.Connection, apply: boolean) {
  if (!healthEncryptionEnabled()) throw new Error('HEALTH_DATA_KEY absente : rien ne peut être rechiffré.');
  const current = (process.env.HEALTH_DATA_KEY_ID || 'k1').trim();
  const byKey = new Map<string, number>();
  let done = 0;
  for (const [table, list] of Object.entries(HEALTH_FIELDS)) {
    const fields: readonly string[] = list;
    const [rows]: any = await conn.query(`SELECT id, ${fields.join(', ')} FROM ${table}`);
    let tableOld = 0;
    for (const row of rows) {
      const todo = fields.filter((f) => {
        const id = sealedKeyId(row[f]);
        return id !== null && id !== current;
      });
      if (!todo.length) continue;
      tableOld += todo.length;
      for (const f of todo) byKey.set(sealedKeyId(row[f]) as string, (byKey.get(sealedKeyId(row[f]) as string) || 0) + 1);
      if (!apply) continue;
      // Écriture seulement si la valeur n'a pas changé entre la lecture et la mise à jour
      const keep = WITH_UPDATED_AT.has(table) ? ', updated_at = updated_at' : '';
      const [res]: any = await conn.query(
        `UPDATE ${table} SET ${todo.map((f) => `${f} = ?`).join(', ')}${keep} WHERE id = ? AND ${todo.map((f) => `${f} = ?`).join(' AND ')}`,
        [...todo.map((f) => rekeyHealth(row[f])), row.id, ...todo.map((f) => row[f])],
      );
      if (res.affectedRows) done += todo.length;
    }
    console.log(`${table} : ${rows.length} ligne(s), ${tableOld} valeur(s) avec une ancienne clé`);
  }
  const total = [...byKey.values()].reduce((s, n) => s + n, 0);
  const detail = [...byKey.entries()].map(([id, n]) => `${id} : ${n}`).join(', ') || 'aucune';
  console.log(apply
    ? `✅ ${done} valeur(s) rechiffrée(s) avec la clé « ${current} » sur ${total} (${detail}).`
    : `ℹ️ ${total} valeur(s) à rechiffrer avec la clé « ${current} » (${detail}) ; relancer avec --rekey --apply.`);
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
    else if (args.includes('--rekey')) await rekey(conn, args.includes('--apply'));
    else await encrypt(conn, args.includes('--apply'));
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
