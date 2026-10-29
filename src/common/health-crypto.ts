import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Données de santé chiffrées en base (audit sécurité 2.5, 29/10/2026) : AES-256-GCM.
 * - HEALTH_DATA_KEY : 32 octets en base64 (ou 64 caractères hexadécimaux), sur Render uniquement, jamais en base.
 * - HEALTH_DATA_KEY_ID : identifiant de la clé, écrit avec chaque valeur (défaut « k1 »).
 * - HEALTH_DATA_OLD_KEYS : anciennes clés encore lisibles après une rotation, « k1:base64,k2:base64 ».
 * Valeur stockée : hd1.<id de clé>.<iv>.<tag>.<texte chiffré> (base64url).
 * Sans clé, rien n'est chiffré (déploiement possible avant la clé) ; les anciennes valeurs en clair restent lisibles.
 * Valeur chiffrée sans la bonne clé : erreur, jamais un champ vide qui serait ensuite réenregistré.
 */
const PREFIX = 'hd1';
const KEY_ID_RE = /^[A-Za-z0-9_-]{1,16}$/;

type KeyRing = { current: { id: string; key: Buffer } | null; all: Map<string, Buffer> };

let cache: { signature: string; ring: KeyRing } | null = null;

function parseKey(raw: string, name: string): Buffer {
  const v = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v, 'base64');
  if (key.length !== 32) throw new Error(`${name} invalide : 32 octets attendus (base64 ou hexadécimal).`);
  return key;
}

function keyRing(): KeyRing {
  const current = process.env.HEALTH_DATA_KEY || '';
  const currentId = (process.env.HEALTH_DATA_KEY_ID || 'k1').trim();
  const old = process.env.HEALTH_DATA_OLD_KEYS || '';
  const signature = `${current}|${currentId}|${old}`;
  if (cache?.signature === signature) return cache.ring;

  const all = new Map<string, Buffer>();
  for (const part of old.split(',').map((p) => p.trim()).filter(Boolean)) {
    const i = part.indexOf(':');
    const id = part.slice(0, i);
    if (i < 1 || !KEY_ID_RE.test(id)) throw new Error('HEALTH_DATA_OLD_KEYS invalide : format « id:clé,id:clé ».');
    all.set(id, parseKey(part.slice(i + 1), `HEALTH_DATA_OLD_KEYS (${id})`));
  }
  let ring: KeyRing = { current: null, all };
  if (current) {
    if (!KEY_ID_RE.test(currentId)) throw new Error('HEALTH_DATA_KEY_ID invalide : lettres, chiffres, - ou _, 16 caractères au plus.');
    const key = parseKey(current, 'HEALTH_DATA_KEY');
    all.set(currentId, key);
    ring = { current: { id: currentId, key }, all };
  }
  cache = { signature, ring };
  return ring;
}

/** Au démarrage : clé mal formée → refus ; clé absente en production → avertissement */
export function checkHealthKey(): void {
  const ring = keyRing();
  if (!ring.current && process.env.NODE_ENV === 'production') {
    console.warn('⚠️ HEALTH_DATA_KEY absente : les données de santé sont enregistrées en clair (audit sécurité 2.5).');
  }
}

export function healthEncryptionEnabled(): boolean {
  return keyRing().current !== null;
}

export function isSealed(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(`${PREFIX}.`);
}

/** Chiffre une valeur avant l'écriture (null, vide ou déjà chiffrée : inchangée) */
export function sealHealth<T extends string | null | undefined>(value: T): T | string {
  if (typeof value !== 'string' || value === '' || isSealed(value)) return value;
  const ring = keyRing();
  if (!ring.current) return value;
  const { id, key } = ring.current;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${PREFIX}.${id}`));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [PREFIX, id, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

/** Déchiffre une valeur lue en base (valeur en clair d'avant le chiffrement : rendue telle quelle) */
export function openHealth<T>(value: T): T | string {
  if (!isSealed(value)) return value;
  const [, id, iv, tag, data] = (value as unknown as string).split('.');
  const key = keyRing().all.get(id);
  if (!key) throw new Error(`Donnée de santé chiffrée avec la clé « ${id} », absente de HEALTH_DATA_KEY / HEALTH_DATA_OLD_KEYS.`);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`${PREFIX}.${id}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error(`Donnée de santé illisible avec la clé « ${id} » (clé incorrecte ou valeur altérée).`);
  }
}

/** Déchiffre les champs indiqués d'une ligne (copie ; null ou undefined : rendu tel quel) */
export function openFields<T extends Record<string, any> | null | undefined>(row: T, fields: readonly string[]): T {
  if (!row) return row;
  const out: Record<string, any> = { ...row };
  for (const f of fields) if (f in out) out[f] = openHealth(out[f]);
  return out as T;
}

/** Colonnes chiffrées, par table (aussi utilisées par l'outil de chiffrement des anciennes lignes) */
export const HEALTH_FIELDS = {
  tc_reports: [
    'request_detail',
    'chief_complaint',
    'history',
    'gyneco_history',
    'allergies',
    'current_treatments',
    'findings',
    'assessment',
    'plan',
    'center_instructions',
    'patient_summary',
  ],
  tc_referrals: ['completed_note'],
  contraception_requests: ['youth_note', 'admin_note', 'refuse_reason', 'conclusion_note', 'outcome_note'],
  contraception_followups: ['content'],
  ai_chat_logs: ['question', 'answer', 'guard_reason'],
} as const;
