import { checkPassword, cleanName, cleanOrgName, cleanPhone } from '../common/field-rules';
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

// Même règle que tous les comptes (common/field-rules.ts, 16/10/2026)
export function parseNewPassword(raw: any): string {
  return checkPassword(raw);
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

// ---------------------------------------------------------------- Inscription libre et demandes de campagne (15/10/2026)
export const PROPOSAL_STATUSES = ['pending', 'approved', 'rejected', 'created'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export const PROPOSAL_LABELS: Record<ProposalStatus, string> = {
  pending: 'En attente',
  approved: 'Validée',
  rejected: 'Refusée',
  created: 'Campagne créée',
};
export const EVENT_TYPES = ['registration', 'validated', 'withdrawn'] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const EVENT_LABELS: Record<EventType, string> = {
  registration: 'Inscription',
  validated: 'Code validé au point de retrait',
  withdrawn: 'Kit retiré',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9 ]{8,20}$/;

function text(raw: any, label: string, max: number, required = true): string | null {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) {
    if (required) throw new BadRequestException(`${label} : champ obligatoire.`);
    return null;
  }
  if (v.length > max) throw new BadRequestException(`${label} : ${max} caractères maximum.`);
  return v;
}

export function parseSponsorSignup(body: any) {
  const organization = cleanOrgName(body?.organization, 'Le nom de l’organisation');
  const contactName = cleanName(body?.contact_name, 'Le nom de la personne de contact');
  const phone = cleanPhone(body?.phone) as string;
  const email = (text(body?.email, 'E-mail', 255) as string).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new BadRequestException('Adresse e-mail invalide.');
  const password = parseNewPassword(body?.password);
  return { organization, contactName, phone, email, password };
}

export function parseSponsorProfile(body: any) {
  const contactName = cleanName(body?.contact_name, 'Le nom de la personne de contact');
  const phone = cleanPhone(body?.phone) as string;
  return { contactName, phone };
}

function validDate(s: any): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Demande de campagne : mêmes champs que le formulaire de campagne de l'admin
// (nom, description, villes, dates, kits) + budget proposé par le sponsor.
export function parseProposal(body: any, today = todayBenin()) {
  const title = text(body?.title, 'Nom de la campagne', 255) as string;
  const description = text(body?.description, 'Description', 5000, false);
  const cities: string[] = [];
  const seen = new Set<string>();
  for (const c of Array.isArray(body?.cities) ? body.cities : []) {
    const city = typeof c === 'string' ? c.trim() : '';
    if (!city) continue;
    if (city.length > 100) throw new BadRequestException('Nom de ville trop long (100 caractères max).');
    if (!seen.has(city.toLowerCase())) {
      seen.add(city.toLowerCase());
      cities.push(city);
    }
  }
  if (!cities.length) throw new BadRequestException('Indiquez au moins une ville.');
  if (cities.length > 30) throw new BadRequestException('30 villes au maximum.');
  if (!validDate(body?.date_start)) throw new BadRequestException('Date de début invalide.');
  if (!validDate(body?.date_end)) throw new BadRequestException('Date de fin invalide.');
  if (body.date_start < today) throw new BadRequestException('La date de début ne peut pas être passée.');
  if (body.date_end < body.date_start) throw new BadRequestException('La date de fin doit être après la date de début.');
  const kits = Number(body?.objective_kits);
  if (!Number.isInteger(kits) || kits < 1 || kits > 1_000_000) throw new BadRequestException('Nombre de kits invalide (au moins 1).');
  const budget = Number(body?.budget ?? 0);
  if (!Number.isFinite(budget) || budget < 0 || budget > 1e12) throw new BadRequestException('Budget invalide.');
  return { title, description, cities, date_start: body.date_start as string, date_end: body.date_end as string, objective_kits: kits, budget: Math.round(budget * 100) / 100 };
}

// Échappement des valeurs saisies avant insertion dans un e-mail HTML
export const escapeHtml = (v: any) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);

// Limiteur en mémoire (inscriptions publiques) : max par clé sur une fenêtre glissante
const hits = new Map<string, number[]>();
export function allowAttempt(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return true;
}
