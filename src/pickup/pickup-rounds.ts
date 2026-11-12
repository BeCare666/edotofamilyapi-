// Tournées de retrait 09 h / 17 h (12/11/2026, rapports/PLAN_TOURNEES_RETRAIT.md, étape 1.3).
// Fichier de règles unique, sans base de données : tout calcul d'heure de disponibilité passe par ici.
//  D1 : payé (commande) ou demandé (kit) avant la limite du matin → tournée du matin le jour même ;
//       entre la limite du matin et la limite du soir → tournée du soir ; après → tournée du matin du lendemain.
//  D3 : tournées tous les jours ; D8/D9 : on prend la première tournée qui tombe un jour d'ouverture du point.
//  D5 : heures réglables par le super admin (Paramètres, groupe Commandes).
//  D6 : le code de retrait est valable à partir de l'heure de disponibilité.
//  D7 : à l'heure venue, colis non traité → tournée suivante.
//  D10/D11, Q1-Q3 : changement des jours d'un point (refus et recalcul).
// Heures en heure du Bénin (UTC+1, sans changement d'heure).
import { setting, settingDef } from '../platform-settings/platform-settings.store';
import { BENIN_OFFSET_MIN, beninNow, isValidDate } from '../push/reminder-rules';

export const ROUND_KEYS = {
  morningCutoff: 'pickup.morning_cutoff_hour',
  morningRound: 'pickup.morning_round_hour',
  eveningCutoff: 'pickup.evening_cutoff_hour',
  eveningRound: 'pickup.evening_round_hour',
} as const;

export type RoundHours = { morningCutoff: number; morningRound: number; eveningCutoff: number; eveningRound: number };

const ORDERED: (keyof RoundHours)[] = ['morningCutoff', 'morningRound', 'eveningCutoff', 'eveningRound'];
const KEYS = Object.values(ROUND_KEYS) as string[];

/** Valeurs en vigueur, indexées par clé de paramètre (pour le contrôle à l'enregistrement) */
export function currentRoundHours(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of KEYS) out[k] = setting(k);
  return out;
}

const toHours = (byKey: Record<string, number>): RoundHours =>
  ({
    morningCutoff: Number(byKey[ROUND_KEYS.morningCutoff]),
    morningRound: Number(byKey[ROUND_KEYS.morningRound]),
    eveningCutoff: Number(byKey[ROUND_KEYS.eveningCutoff]),
    eveningRound: Number(byKey[ROUND_KEYS.eveningRound]),
  }) as RoundHours;

const inOrder = (h: RoundHours) => ORDERED.every((k, i) => i === 0 || h[ORDERED[i - 1]] < h[k]);

/** Message de refus si l'enregistrement casserait l'ordre limite matin < tournée matin < limite soir < tournée soir */
export function roundSettingsError(byKey: Record<string, number>, changedKey?: string): string | null {
  if (changedKey && !KEYS.includes(changedKey)) return null;
  if (inOrder(toHours(byKey))) return null;
  const label = (k: keyof RoundHours) => settingDef(ROUND_KEYS[k]).label.toLowerCase();
  return `Les heures des tournées doivent rester dans cet ordre : ${ORDERED.map(label).join(' < ')}.`;
}

/** Heures en vigueur ; valeurs incohérentes (ne devrait pas arriver) : valeurs d'origine */
export function roundHours(): RoundHours {
  const h = toHours(currentRoundHours());
  if (inOrder(h)) return h;
  const byKey: Record<string, number> = {};
  for (const k of KEYS) byKey[k] = Number(settingDef(k).fallback());
  return toHours(byKey);
}

// ---------- Jours d'ouverture d'un point (D8) ----------

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type Closure = { from: string; to: string }; // dates du Bénin YYYY-MM-DD, incluses
export type OpeningRule = { days: Record<Weekday, boolean>; closures: Closure[] };

export const allDaysOpen = (): Record<Weekday, boolean> =>
  WEEKDAYS.reduce((acc, d) => ({ ...acc, [d]: true }), {} as Record<Weekday, boolean>);
export const ALWAYS_OPEN: OpeningRule = { days: allDaysOpen(), closures: [] };

const pad = (n: number) => String(n).padStart(2, '0');
const utcOf = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

export function addDays(ymd: string, n: number): string {
  const t = new Date(utcOf(ymd) + n * 86400000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekdayOf(ymd: string): Weekday {
  return WEEKDAYS[(new Date(utcOf(ymd)).getUTCDay() + 6) % 7];
}

export function isOpenOn(rule: OpeningRule, ymd: string): boolean {
  if (!rule.days[weekdayOf(ymd)]) return false;
  return !rule.closures.some((c) => c.from <= ymd && ymd <= c.to);
}

/** Instant réel (UTC) d'une heure pile, heure du Bénin */
export function roundInstant(ymd: string, hour: number): Date {
  return new Date(utcOf(ymd) + hour * 3600000 - BENIN_OFFSET_MIN * 60000);
}

/** Au-delà, un point fermé sans fin : aucune tournée (ne devrait pas arriver, au moins un jour reste coché) */
export const MAX_SEARCH_DAYS = 400;

/**
 * Première tournée à partir de l'instant donné (paiement, demande de kit, tournée manquée) qui tombe un jour
 * d'ouverture du point. Depuis l'heure d'une tournée, on obtient la tournée suivante (D7).
 * null : le point n'ouvre plus dans l'année qui vient.
 */
export function nextRound(from: Date, rule: OpeningRule = ALWAYS_OPEN, h: RoundHours = roundHours()): Date | null {
  const { date, minutes } = beninNow(from);
  let day = date;
  let evening = false;
  if (minutes < h.morningCutoff * 60) evening = false;
  else if (minutes < h.eveningCutoff * 60) evening = true;
  else day = addDays(day, 1);
  for (let i = 0; i <= MAX_SEARCH_DAYS; i++) {
    if (isOpenOn(rule, day)) return roundInstant(day, evening ? h.eveningRound : h.morningRound);
    // Jour fermé : première tournée du jour d'ouverture suivant
    day = addDays(day, 1);
    evening = false;
  }
  return null;
}

/** D6 : fin de validité du code de retrait, comptée à partir de l'heure de disponibilité */
export function codeExpiry(availableAt: Date, ttlHours: number): Date {
  return new Date(availableAt.getTime() + ttlHours * 3600000);
}

// ---------- Changement des jours d'un point (D10, D11, Q1-Q3) ----------

/** Colis d'un client pour ce point : heure de disponibilité et fin de validité du code */
export type Parcel = { available_at: Date; otp_expires_at: Date | null };

/**
 * Q1-Q3 : jours qui deviendraient fermés alors qu'un colis est chez le point ou doit y arriver ce jour-là.
 * Un colis compte de son jour d'arrivée jusqu'à l'expiration de son code (Q3), puis ne bloque plus.
 * Même règle pour un jour de semaine décoché et pour une date de congé (Q2). Seuls les jours à venir comptent.
 */
export function closingConflicts(before: OpeningRule, after: OpeningRule, parcels: Parcel[], now: Date): string[] {
  const today = beninNow(now).date;
  const found = new Set<string>();
  for (const p of parcels) {
    if (!p.available_at) continue;
    if (p.otp_expires_at && p.otp_expires_at.getTime() <= now.getTime()) continue;
    const start = beninNow(p.available_at).date;
    const end = p.otp_expires_at ? beninNow(p.otp_expires_at).date : start;
    let day = start < today ? today : start;
    for (let i = 0; day <= end && i <= MAX_SEARCH_DAYS; i++, day = addDays(day, 1)) {
      if (isOpenOn(before, day) && !isOpenOn(after, day)) found.add(day);
    }
  }
  return [...found].sort();
}

/**
 * D10 : nouvelle heure d'un colis pas encore arrivé après un changement des jours du point ; null si inchangée.
 * Jour actuel resté ouvert : on garde l'heure, sauf si une tournée plus proche est désormais possible (jour rouvert).
 * Jour actuel devenu fermé : première tournée possible à partir de maintenant.
 */
export function rescheduledRound(current: Date, rule: OpeningRule, now: Date, h: RoundHours = roundHours()): Date | null {
  const next = nextRound(now, rule, h);
  if (!next) return null;
  const keep = isOpenOn(rule, beninNow(current).date) && current.getTime() <= next.getTime();
  return keep ? null : next;
}

/** Contrôle d'un réglage envoyé par le point de retrait ; message clair si refusé */
export function parseOpeningRule(body: any, now: Date): { rule: OpeningRule; error?: string } {
  const days = allDaysOpen();
  const src = body?.days && typeof body.days === 'object' ? body.days : {};
  for (const d of WEEKDAYS) if (src[d] !== undefined) days[d] = src[d] === true || src[d] === 1 || src[d] === '1' || src[d] === 'true';
  const rule: OpeningRule = { days, closures: [] };
  if (!WEEKDAYS.some((d) => days[d])) return { rule, error: 'Cochez au moins un jour d’ouverture dans la semaine.' };
  const list = Array.isArray(body?.closures) ? body.closures : [];
  if (list.length > MAX_CLOSURES) return { rule, error: `Au plus ${MAX_CLOSURES} périodes de congé.` };
  const today = beninNow(now).date;
  for (const c of list) {
    const from = String(c?.from ?? '').trim();
    const to = String(c?.to ?? c?.from ?? '').trim();
    if (!isValidDate(from) || !isValidDate(to)) return { rule, error: 'Date de congé invalide.' };
    if (to < from) return { rule, error: `Congé du ${formatDate(from)} : la date de fin est avant la date de début.` };
    if (to < today) continue; // congé passé : n'est plus gardé
    if (utcOf(to) - utcOf(from) > MAX_CLOSURE_DAYS * 86400000) return { rule, error: `Un congé dure au plus ${MAX_CLOSURE_DAYS} jours.` };
    rule.closures.push({ from, to });
  }
  rule.closures.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return { rule };
}
export const MAX_CLOSURES = 30;
export const MAX_CLOSURE_DAYS = 120;

// ---------- Textes (Q4) ----------

const DAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « jeudi 12 novembre » pour une date du Bénin YYYY-MM-DD */
export function formatDate(ymd: string): string {
  const t = new Date(utcOf(ymd));
  return `${DAYS_FR[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS_FR[t.getUTCMonth()]}`;
}

/** { day: « jeudi 12 novembre », hour: « 09 h 00 » } pour un instant réel */
export function formatRound(at: Date): { day: string; hour: string } {
  const { date, minutes } = beninNow(at);
  return { day: formatDate(date), hour: `${pad(Math.floor(minutes / 60))} h ${pad(minutes % 60)}` };
}
