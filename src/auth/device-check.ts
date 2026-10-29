import { createHash, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import * as jwt from 'jsonwebtoken';

/**
 * Vérification d'un nouvel appareil (décision du 29/10/2026) : jeunes et points de retrait.
 * Connexion depuis un appareil inconnu → code à 6 chiffres envoyé par e-mail (10 min, une seule fois)
 * → appareil reconnu 30 jours (jeton signé gardé par le navigateur, lié au compte et à sa version de session :
 * un changement de mot de passe ou un blocage le révoque). Aucune table : le code n'existe qu'en empreinte
 * dans le défi signé. Rôles : NEW_DEVICE_ROLES (défaut « customer,super_pickuppoint », « off » = désactivé).
 */
export const DEVICE_CHALLENGE_PURPOSE = 'device-check';
export const TRUSTED_DEVICE_PURPOSE = 'trusted-device';
export const DEVICE_CODE_TTL_SECONDS = 10 * 60;
export const TRUSTED_DEVICE_DAYS = 30;

const key = (purpose: string) => `${process.env.JWT_SECRET_KEY}:${purpose}`;

export function newDeviceRoles(env = process.env.NEW_DEVICE_ROLES): string[] {
  if (env === undefined || env === '') return ['customer', 'super_pickuppoint'];
  if (env.trim().toLowerCase() === 'off') return [];
  return env.split(',').map((r) => r.trim()).filter(Boolean);
}

function codeHash(code: string, jti: string): string {
  return createHash('sha256').update(`${jti}:${String(code).replace(/\s/g, '')}`).digest('hex');
}

/** Nouveau code et défi signé (le code est envoyé par e-mail, seul son empreinte voyage dans le défi) */
export function newDeviceChallenge(user: { id: number; token_version?: number }): { code: string; challenge: string } {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const jti = randomUUID();
  const challenge = jwt.sign(
    { id: user.id, purpose: DEVICE_CHALLENGE_PURPOSE, tv: Number(user.token_version) || 0, h: codeHash(code, jti) },
    key(DEVICE_CHALLENGE_PURPOSE),
    { expiresIn: DEVICE_CODE_TTL_SECONDS, jwtid: jti },
  );
  return { code, challenge };
}

export function readDeviceChallenge(challenge: unknown): { id: number; tv: number; h: string; jti: string } | null {
  try {
    const p: any = jwt.verify(String(challenge || ''), key(DEVICE_CHALLENGE_PURPOSE));
    if (p?.purpose !== DEVICE_CHALLENGE_PURPOSE || !p.jti) return null;
    return { id: Number(p.id), tv: Number(p.tv), h: String(p.h), jti: String(p.jti) };
  } catch {
    return null;
  }
}

export function codeMatches(challenge: { h: string; jti: string }, code: unknown): boolean {
  const c = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const a = Buffer.from(codeHash(c, challenge.jti));
  const b = Buffer.from(challenge.h);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Un code accepté ne resservira pas (défi retenu jusqu'à son expiration, mémoire du processus)
const usedChallenges = new Map<string, number>();
export function consumeChallenge(jti: string, now = Date.now()): boolean {
  for (const [k, exp] of usedChallenges) if (exp < now) usedChallenges.delete(k);
  if (usedChallenges.has(jti)) return false;
  usedChallenges.set(jti, now + DEVICE_CODE_TTL_SECONDS * 1000);
  return true;
}

export function signTrustedDevice(user: { id: number; token_version?: number }): string {
  return jwt.sign({ id: user.id, purpose: TRUSTED_DEVICE_PURPOSE, tv: Number(user.token_version) || 0 }, key(TRUSTED_DEVICE_PURPOSE), {
    expiresIn: `${TRUSTED_DEVICE_DAYS}d`,
  });
}

export function isTrustedDevice(token: unknown, user: { id: number; token_version?: number }): boolean {
  try {
    const p: any = jwt.verify(String(token || ''), key(TRUSTED_DEVICE_PURPOSE));
    return p?.purpose === TRUSTED_DEVICE_PURPOSE && Number(p.id) === Number(user.id) && Number(p.tv) === (Number(user.token_version) || 0);
  } catch {
    return false;
  }
}

/** a***@gmail.com : montré à l'écran pour dire où le code est parti */
export function emailHint(email: string): string {
  const [u, d] = String(email || '').split('@');
  return d ? `${u.slice(0, 1)}***@${d}` : '***';
}

export function deviceCodeEmail(code: string): string {
  return `
  <div style="font-family: Inter, Arial, sans-serif; max-width: 560px; margin: auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #f1ece4;">
    <div style="background: #1f1b16; padding: 24px; text-align: center;">
      <p style="color: #ffffff; font-size: 20px; margin: 0; font-family: Poppins, Arial, sans-serif;">E.doto family</p>
    </div>
    <div style="padding: 28px; color: #1f1b16; font-size: 15px; line-height: 1.6;">
      <p>Une connexion à votre compte est demandée depuis un nouvel appareil. Voici votre code :</p>
      <p style="text-align: center; font-size: 32px; letter-spacing: 8px; font-weight: 700; margin: 20px 0;">${code}</p>
      <p>Il est valable 10 minutes. Ne le donnez à personne : l'équipe E.doto family ne vous le demandera jamais.</p>
      <p style="color: #8a837a; font-size: 13px;">Ce n'est pas vous ? Ne saisissez pas ce code et changez votre mot de passe.</p>
    </div>
  </div>`;
}
