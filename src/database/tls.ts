import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Audit sécurité 2.4 (28/10/2026) : connexion TLS à TiDB toujours vérifiée.
 *
 * - Certificat racine de TiDB Cloud (ISRG Root X1, empreinte SHA-256 96:BC:EC:06…:08:C6) chargé
 *   depuis certs/tidb-ca.pem, à côté de ce fichier (src/ en développement, dist/src/ après le build).
 * - Avant : chemin faux (process.cwd()/../database/certs), fichier sans en-têtes PEM et
 *   rejectUnauthorized: false, donc aucune vérification du serveur.
 * - Fichier absent : vérification avec les racines intégrées à Node (ISRG Root X1 en fait partie),
 *   jamais de connexion non vérifiée.
 */
export const TIDB_CA_PATH = join(__dirname, 'certs', 'tidb-ca.pem');

export function tidbSsl(caPath = TIDB_CA_PATH) {
  const base = { rejectUnauthorized: true, minVersion: 'TLSv1.2' as const };
  if (existsSync(caPath)) return { ...base, ca: readFileSync(caPath, 'utf8') };
  console.warn('⚠️ Certificat TiDB introuvable : vérification avec les racines de Node');
  return base;
}
