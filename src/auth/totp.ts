import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Double authentification (audit sécurité 3.1, 29/10/2026) : codes à 6 chiffres d'une application
 * d'authentification (Google Authenticator, Microsoft Authenticator, Authy…), RFC 6238 :
 * HMAC-SHA1, pas de 30 s, une période d'écart tolérée (horloge du téléphone).
 */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_ISSUER = 'E.doto family';
export const RECOVERY_CODE_COUNT = 8;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = String(text || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Clé TOTP invalide.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Nouvelle clé secrète (160 bits), en base32 comme l'attendent les applications */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string | Buffer, timeMs = Date.now(), digits = TOTP_DIGITS): string {
  const key = Buffer.isBuffer(secret) ? secret : base32Decode(secret);
  const counter = Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac('sha1', key).update(msg).digest();
  const offset = h[h.length - 1] & 0xf;
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Vérifie un code : période courante, précédente ou suivante.
 * Renvoie le numéro de période accepté (pour refuser qu'un même code serve deux fois), sinon null.
 */
export function verifyTotp(secret: string, code: unknown, timeMs = Date.now()): number | null {
  const c = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const step = Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS);
  for (const d of [0, -1, 1]) {
    if (same(totpCode(secret, (step + d) * TOTP_STEP_SECONDS * 1000), c)) return step + d;
  }
  return null;
}

/** Lien lu par les applications (code QR) */
export function otpauthUrl(secret: string, account: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(TOTP_ISSUER)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

/** Codes de secours : 8 codes « XXXX-XXXX », montrés une seule fois ; seule leur empreinte est gardée */
export function newRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(5)).slice(0, 8);
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
}

export function hashRecoveryCode(code: unknown): string {
  const clean = String(code ?? '').toUpperCase().replace(/[\s-]/g, '');
  return createHash('sha256').update(`edoto-recovery:${clean}`).digest('hex');
}

/** Rôles pour lesquels la double authentification est obligatoire (variable TOTP_ROLES, vide = aucun) */
export const TOTP_ELIGIBLE_ROLES = ['super_admin', 'doctor', 'health_center', 'sponsor'] as const;

export function totpRequiredRoles(env = process.env.TOTP_ROLES): string[] {
  return String(env || '')
    .split(',')
    .map((r) => r.trim())
    .filter((r) => (TOTP_ELIGIBLE_ROLES as readonly string[]).includes(r));
}
