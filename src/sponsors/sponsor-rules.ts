import { BadRequestException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';

// Espace sponsor — règles (décisions du 25/09/2026)
export const INVITATION_TTL_DAYS = 7; // lien d'invitation : renvoyable par l'admin à tout moment
export const PREDICTION_MIN_DAYS = 7; // prévision : campagne en cours lancée depuis au moins 7 jours
export const MIN_PASSWORD_LENGTH = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const BENIN_OFFSET_MS = 60 * 60 * 1000;

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export function newInvitationToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: sha256(token) };
}

export function parseNewPassword(raw: any): string {
  const p = typeof raw === 'string' ? raw : '';
  if (p.length < MIN_PASSWORD_LENGTH) {
    throw new BadRequestException(`Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`);
  }
  if (p.length > 128) throw new BadRequestException('Mot de passe trop long.');
  return p;
}

// Date du jour au Bénin (AAAA-MM-JJ) et conversion d'un horodatage UTC « AAAA-MM-JJ HH:MM:SS »
export function todayBenin(now = new Date()): string {
  return new Date(now.getTime() + BENIN_OFFSET_MS).toISOString().slice(0, 10);
}
export function beninDay(utc: string): string {
  return new Date(new Date(`${utc.replace(' ', 'T')}Z`).getTime() + BENIN_OFFSET_MS).toISOString().slice(0, 10);
}
export function beninMonth(utc: string): string {
  return beninDay(utc).slice(0, 7);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}
function addDays(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

// Séries quotidiennes cumulées (inscriptions, retraits) du début de la campagne à aujourd'hui (ou à la fin)
export function dailySeries(dateStart: string, dateEnd: string | null, today: string, registrationsUtc: string[], withdrawalsUtc: string[]) {
  const last = dateEnd && dateEnd < today ? dateEnd : today;
  if (last < dateStart) return [];
  const regs = new Map<string, number>();
  const wds = new Map<string, number>();
  registrationsUtc.forEach((u) => regs.set(beninDay(u), (regs.get(beninDay(u)) || 0) + 1));
  withdrawalsUtc.forEach((u) => wds.set(beninDay(u), (wds.get(beninDay(u)) || 0) + 1));
  // Inscriptions antérieures au début de la campagne : comptées le premier jour
  let r = registrationsUtc.filter((u) => beninDay(u) < dateStart).length;
  let w = withdrawalsUtc.filter((u) => beninDay(u) < dateStart).length;
  const out: { date: string; registrations: number; withdrawals: number }[] = [];
  for (let d = dateStart; d <= last; d = addDays(d, 1)) {
    r += regs.get(d) || 0;
    w += wds.get(d) || 0;
    out.push({ date: d, registrations: r, withdrawals: w });
  }
  return out;
}

// Prévision : kits retirés à la date de fin au rythme moyen observé depuis le début.
// Affichée seulement pour une campagne en cours lancée depuis au moins 7 jours (et avec une date de fin).
export function prediction(input: { status: string; dateStart: string; dateEnd: string | null; today: string; withdrawn: number; objective: number }) {
  const { status, dateStart, dateEnd, today, withdrawn, objective } = input;
  const elapsed = daysBetween(dateStart, today);
  if (status !== 'en_cours') return { available: false, reason: 'La prévision n’est calculée que pour une campagne en cours.' };
  if (elapsed < PREDICTION_MIN_DAYS) {
    return { available: false, reason: `Pas encore assez de données : prévision disponible après ${PREDICTION_MIN_DAYS} jours de campagne.` };
  }
  if (!dateEnd) return { available: false, reason: 'Pas de date de fin : impossible de projeter.' };
  const ratePerDay = withdrawn / elapsed;
  const remaining = Math.max(0, daysBetween(today, dateEnd));
  const projected = Math.round(withdrawn + ratePerDay * remaining);
  return {
    available: true,
    method: 'Rythme moyen des retraits depuis le début, prolongé jusqu’à la date de fin (estimation).',
    rate_per_day: Math.round(ratePerDay * 100) / 100,
    days_elapsed: elapsed,
    days_remaining: remaining,
    projected_withdrawals: projected,
    projected_percent_of_objective: objective > 0 ? Math.round((projected / objective) * 1000) / 10 : null,
  };
}

// 12 derniers mois (AAAA-MM), du plus ancien au plus récent
export function lastMonths(today: string, n = 12): string[] {
  const [y, m] = today.split('-').map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}
