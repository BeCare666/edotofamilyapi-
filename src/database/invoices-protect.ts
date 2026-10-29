import * as dotenv from 'dotenv';
import * as mysql from 'mysql2/promise';
import { v2 as cloudinary } from 'cloudinary';
import { tidbSsl } from './tls';
import { INVOICE_STORAGE_TYPE, configureCloudinary, parseRawUrl } from '../payment-intent/invoice-storage';

/**
 * Factures (audit sécurité 2.8, 29/10/2026) : passe les PDF déjà publics en accès restreint sur Cloudinary.
 *   npm run invoices:protect             → liste les factures encore publiques (aucune écriture)
 *   npm run invoices:protect -- --apply  → les passe en « authenticated » et met à jour invoices.pdf_url (rejouable)
 * Après --apply, l'ancienne adresse publique ne répond plus.
 */
dotenv.config();

async function main() {
  const apply = process.argv.includes('--apply');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || '4000', 10),
    ssl: tidbSsl(),
  });
  try {
    configureCloudinary();
    const [rows]: any = await conn.query(`SELECT id, type, order_id, pdf_url FROM invoices ORDER BY id`);
    const open = rows.filter((r: any) => parseRawUrl(r.pdf_url)?.type === 'upload');
    console.log(`${rows.length} facture(s), ${open.length} encore publique(s).`);
    let done = 0;
    for (const r of open) {
      const { publicId } = parseRawUrl(r.pdf_url)!;
      console.log(`- facture #${r.id} (${r.type}, commande ${r.order_id}) : ${publicId}`);
      if (!apply) continue;
      try {
        const res: any = await cloudinary.uploader.rename(publicId, publicId, {
          resource_type: 'raw',
          type: 'upload',
          to_type: INVOICE_STORAGE_TYPE,
          invalidate: true,
        });
        await conn.query(`UPDATE invoices SET pdf_url = ? WHERE id = ? AND pdf_url = ?`, [res.secure_url, r.id, r.pdf_url]);
        done++;
      } catch (err: any) {
        console.error(`  ❌ facture #${r.id} : ${err?.error?.message || err?.message || err}`);
      }
    }
    console.log(apply ? `✅ ${done} facture(s) passée(s) en accès restreint sur ${open.length}.` : 'ℹ️ Relancer avec --apply pour les protéger.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
