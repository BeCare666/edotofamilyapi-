import { createHash, randomInt, timingSafeEqual } from 'crypto';

/**
 * Mot de passe oublié (durci le 22/10/2026, audit sécurité C4) :
 * code tiré par un générateur cryptographique, stocké haché, 5 essais au plus,
 * 10 minutes de validité, demandes limitées par adresse et par minute.
 */
export const RESET_CODE_TTL_MINUTES = 10;
export const RESET_MAX_ATTEMPTS = 5;
export const RESET_REQUEST_LIMITS = [
  { max: 1, windowMs: 60 * 1000 }, // une demande par minute
  { max: 5, windowMs: 60 * 60 * 1000 }, // cinq demandes par heure
];

// Même réponse que l'adresse existe ou non : on ne révèle pas qui a un compte
export const RESET_REQUEST_MESSAGE = 'Si un compte existe avec cette adresse, un code vient de lui être envoyé.';
export const RESET_INVALID_MESSAGE = 'Code invalide ou expiré.';

export function newResetCode(): string {
  return String(randomInt(100000, 1000000));
}

export function hashResetCode(code: string): string {
  return createHash('sha256').update(String(code ?? '').trim()).digest('hex');
}

// Comparaison en temps constant du code saisi avec l'empreinte enregistrée
export function resetCodeMatches(code: string, storedHash: string): boolean {
  const a = Buffer.from(hashResetCode(code), 'hex');
  const b = Buffer.from(String(storedHash ?? ''), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function normalizeResetEmail(email: unknown): string {
  return String(email ?? '').trim().toLowerCase();
}
