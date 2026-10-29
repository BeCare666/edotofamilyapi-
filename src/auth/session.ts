import * as jwt from 'jsonwebtoken';
import { DOCTOR, HEALTH_CENTER, SUPER_ADMIN } from './roles.decorator';

/**
 * Sessions (audit sécurité 1.5, H3, 24/10/2026).
 * - Le jeton porte tv = users.token_version : incrémenter la version invalide tous les jetons du compte
 *   (changement ou réinitialisation du mot de passe, blocage, changement de rôle).
 * - Un jeton sans tv (émis avant le 24/10) est refusé : chacun se reconnecte une fois (décision utilisateur).
 * - Durée maximale depuis la connexion : 12 h pour super admin, médecin et centre ; 7 jours pour les autres rôles.
 * - Inactivité (décision du 29/10/2026) : chaque jeton ne vaut que SESSION_IDLE_MINUTES (5 min par défaut) ;
 *   l'admin et le site le renouvellent (POST /token/refresh) tant que la personne agit. Le renouvellement
 *   garde l'heure de connexion (st) : la durée maximale ne peut pas être dépassée.
 */

export const SHORT_SESSION_ROLES = [SUPER_ADMIN, DOCTOR, HEALTH_CENTER];

/** Durée maximale d'une session depuis la connexion */
export function sessionTtl(role: string): string {
  return SHORT_SESSION_ROLES.includes(role) ? '12h' : '7d';
}

export function sessionMaxSeconds(role: string): number {
  return SHORT_SESSION_ROLES.includes(role) ? 12 * 3600 : 7 * 86400;
}

export function sessionIdleSeconds(env = process.env.SESSION_IDLE_MINUTES): number {
  const m = Number(env);
  return (Number.isFinite(m) && m > 0 ? m : 5) * 60;
}

// user : ligne de la table users (id, email, token_version) ; startedAt : heure de connexion (secondes)
export function signSession(user: Record<string, any>, role: string, startedAt = Math.floor(Date.now() / 1000)): string {
  const now = Math.floor(Date.now() / 1000);
  const left = startedAt + sessionMaxSeconds(role) - now;
  if (left <= 0) throw new Error('Durée maximale de la session atteinte.');
  return jwt.sign(
    { id: user.id, email: user.email, permissions: [role], tv: Number(user.token_version) || 0, st: startedAt },
    process.env.JWT_SECRET_KEY,
    { expiresIn: Math.min(sessionIdleSeconds(), left) } as jwt.SignOptions,
  );
}

/** Renouvellement : même heure de connexion (jetons d'avant le 29/10 : heure d'émission) */
export function sessionStart(payload: any): number {
  const st = Number(payload?.st ?? payload?.iat);
  return Number.isFinite(st) && st > 0 ? st : Math.floor(Date.now() / 1000);
}

// Lien de vérification d'e-mail : purpose contrôlé, pour qu'un jeton de session ne serve pas de lien
// (et inversement). Secret séparé EMAIL_VERIFY_SECRET reporté (décision du 24/10/2026).
export const VERIFY_EMAIL_PURPOSE = 'verify-email';

export function signEmailVerification(email: string): string {
  return jwt.sign({ email, purpose: VERIFY_EMAIL_PURPOSE }, process.env.JWT_SECRET_KEY, { expiresIn: '5m' });
}

// Renvoie l'e-mail du lien, ou lève une erreur si le jeton est invalide, expiré ou d'un autre usage
export function readEmailVerification(token: string): string {
  const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY) as any;
  if (decoded?.purpose !== VERIFY_EMAIL_PURPOSE || typeof decoded?.email !== 'string') {
    throw new Error('Jeton de vérification invalide.');
  }
  return decoded.email;
}

// is_active NULL vaut actif (DEFAULT 1 dans users.sql) : seul 0 bloque
export function isBlocked(isActive: any): boolean {
  return isActive !== null && isActive !== undefined && Number(isActive) === 0;
}

// Cache de 30 s des lignes users lues par JwtStrategy, pour limiter la charge
export const SESSION_CACHE_MS = 30 * 1000;
type SessionRow = { id: number; role: string; is_active: any; token_version: number };
const sessionCache = new Map<number, { row: SessionRow | null; at: number }>();

export function cachedSessionRow(id: number, now = Date.now()): SessionRow | null | undefined {
  const hit = sessionCache.get(id);
  if (!hit || now - hit.at > SESSION_CACHE_MS) return undefined;
  return hit.row;
}

export function cacheSessionRow(id: number, row: SessionRow | null, now = Date.now()): void {
  sessionCache.set(id, { row, at: now });
}

export function clearSessionCache(id?: number): void {
  if (id === undefined) sessionCache.clear();
  else sessionCache.delete(id);
}

/**
 * Invalide tous les jetons des comptes visés. `where` est un fragment SQL fixe (jamais une saisie),
 * par exemple 'id = ?' ou 'LOWER(email) = ?'.
 */
export async function bumpTokenVersion(
  db: { query: (sql: string, params?: any[]) => Promise<any> },
  where: string,
  params: any[],
): Promise<void> {
  await db.query(`UPDATE users SET token_version = token_version + 1 WHERE ${where}`, params);
  // Le cache est vidé en entier : la condition peut porter sur l'e-mail plutôt que sur l'id
  clearSessionCache();
}
