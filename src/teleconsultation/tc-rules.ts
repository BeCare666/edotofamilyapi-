import { BadRequestException } from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'crypto';

// Téléconsultation (19/10/2026) : règles pures (créneaux, codes, libellés), sans base de données.
// Heures saisies et affichées à l'heure du Bénin (UTC+1, sans heure d'été) ; base en UTC.

export const BENIN_OFFSET_MIN = 60;
export const BOOKING_WINDOW_DAYS = 30; // créneaux proposés sur les 30 prochains jours
export const MIN_LEAD_MINUTES = 30; // pas de réservation à moins de 30 min (le rappel part 10 min avant)
export const REMINDER_MINUTES = 10; // rappel « à moins de 10 min » du début
export const REFERRAL_TTL_DAYS = 90; // validité du code QR d'orientation
export const INVITATION_TTL_DAYS = 7;
export const DEFAULT_SLOT_MINUTES = 30;

export type Mode = 'video' | 'phone';
export const MODES: Mode[] = ['video', 'phone'];
export const MODE_LABEL: Record<Mode, string> = { video: 'Visio', phone: 'Appel téléphonique' };

// Demande du jeune, choisie par le médecin dans le compte rendu
export const REQUEST_TYPES: Record<string, string> = {
  contraception: 'Contraception',
  sti_screening: 'Dépistage IST ou VIH',
  pregnancy: 'Grossesse (test ou suivi)',
  menstrual: 'Règles (douleurs, retard, irrégularités)',
  infection: 'Infection ou symptômes génitaux',
  violence: 'Violences subies',
  counselling: 'Information et conseil',
  other: 'Autre demande',
};

export const URGENCY_LABEL: Record<string, string> = {
  routine: 'Sans urgence',
  soon: 'À voir dans les 7 jours',
  urgent: 'Urgent : sous 48 heures',
};

export const ORGANIZATION_LABEL: Record<string, string> = {
  abpf: 'ABPF',
  abms: 'ABMS',
  clinic: 'Clinique',
  other: 'Autre centre',
};

export const APPOINTMENT_STATUS_LABEL: Record<string, string> = {
  booked: 'Confirmé',
  completed: 'Terminé',
  cancelled: 'Annulé',
  no_show: 'Absent',
};

export const REFERRAL_STATUS_LABEL: Record<string, string> = {
  issued: 'En attente de visite',
  viewed: 'Dossier consulté',
  completed: 'Prise en charge faite',
  expired: 'Expiré',
};

export const WEEKDAY_LABEL = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

const fail = (m: string): never => {
  throw new BadRequestException(m);
};

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export function newInvitationToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: sha256(token) };
}

// Codes lisibles sans caractère ambigu (pas de 0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function readableCode(length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}
export const newReference = () => `TC${readableCode(6)}`;
export const newShortCode = () => readableCode(8);
export const newReferralToken = () => randomBytes(24).toString('hex');
/** Code court affiché par groupes de 4 (« K7M4 Q9XP ») */
export const formatShortCode = (c: string) => String(c || '').replace(/(.{4})(?=.)/g, '$1 ');
/** Code saisi par le centre : espaces et casse ignorés */
export const normalizeShortCode = (c: unknown) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Salle Jitsi privée et imprévisible pour chaque rendez-vous
export function newJitsiRoom(reference: string) {
  return `EdotoFamily${reference}${randomBytes(6).toString('hex')}`;
}
export function jitsiUrl(room: string) {
  const base = (process.env.JITSI_BASE_URL || 'https://meet.jit.si').replace(/\/+$/, '');
  return `${base}/${room}`;
}

// ---- Heures ----
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const toMinutes = (hhmm: string) => {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
export const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Jour + heure du Bénin → instant UTC */
export function beninToUtc(day: string, minutes: number): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minutes - BENIN_OFFSET_MIN));
}
/** Instant → jour du Bénin (AAAA-MM-JJ) */
export const beninDayOf = (d: Date) => new Date(d.getTime() + BENIN_OFFSET_MIN * 60000).toISOString().slice(0, 10);
/** Jour de semaine 1 (lundi) à 7 (dimanche) d'un jour AAAA-MM-JJ */
export function weekdayOf(day: string) {
  const w = new Date(`${day}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** « lundi 20 octobre 2026 à 14 h 30 » (heure du Bénin) */
export function beninLabel(d: Date | string, withTime = true) {
  const date = typeof d === 'string' ? new Date(d) : d;
  const day = date.toLocaleDateString('fr-FR', { timeZone: 'Africa/Porto-Novo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (!withTime) return day;
  const t = date.toLocaleTimeString('fr-FR', { timeZone: 'Africa/Porto-Novo', hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
  return `${day} à ${t}`;
}

// ---- Disponibilités ----
export type AvailabilityRule = { weekday: number; start_time: string; end_time: string; modes: string };
export type TimeOff = { date_from: string; date_to: string };
export type Busy = { starts_at: Date; ends_at: Date };

export function cleanAvailability(rows: unknown): AvailabilityRule[] {
  if (!Array.isArray(rows)) fail('Disponibilités invalides.');
  const list = rows as any[];
  if (list.length > 60) fail('Trop de plages horaires (60 au maximum).');
  const out: AvailabilityRule[] = list.map((r, i) => {
    const weekday = Number(r?.weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) fail(`Plage ${i + 1} : jour invalide.`);
    const start = String(r?.start_time ?? '');
    const end = String(r?.end_time ?? '');
    if (Number.isNaN(toMinutes(start)) || Number.isNaN(toMinutes(end))) fail(`Plage ${i + 1} : heure invalide (format HH:MM).`);
    if (toMinutes(end) <= toMinutes(start)) fail(`Plage ${i + 1} : l'heure de fin doit suivre l'heure de début.`);
    const modes = ['both', 'video', 'phone'].includes(r?.modes) ? r.modes : 'both';
    return { weekday, start_time: start, end_time: end, modes };
  });
  // Pas de chevauchement le même jour
  for (let d = 1; d <= 7; d++) {
    const day = out.filter((r) => r.weekday === d).sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
    for (let i = 1; i < day.length; i++) {
      if (toMinutes(day[i].start_time) < toMinutes(day[i - 1].end_time)) fail(`${WEEKDAY_LABEL[d]} : deux plages se chevauchent.`);
    }
  }
  return out;
}

export function cleanSlotMinutes(v: unknown) {
  const n = Number(v);
  if (![15, 20, 30, 45, 60].includes(n)) fail('Durée de consultation : 15, 20, 30, 45 ou 60 minutes.');
  return n;
}

/**
 * Créneaux libres d'un médecin entre deux jours (inclus) :
 * plages hebdomadaires découpées selon la durée de consultation, sans les jours d'absence,
 * sans les créneaux déjà réservés, et pas avant « maintenant + délai minimum ».
 */
export function freeSlots(opts: {
  rules: AvailabilityRule[];
  timeOff: TimeOff[];
  busy: Busy[];
  slotMinutes: number;
  fromDay: string;
  toDay: string;
  mode?: Mode | null;
  now?: Date;
}): Date[] {
  const { rules, timeOff, busy, slotMinutes, fromDay, toDay, mode } = opts;
  const now = opts.now ?? new Date();
  const earliest = now.getTime() + MIN_LEAD_MINUTES * 60000;
  const out: Date[] = [];
  for (let day = fromDay; day <= toDay; day = addDays(day, 1)) {
    if (timeOff.some((t) => day >= String(t.date_from).slice(0, 10) && day <= String(t.date_to).slice(0, 10))) continue;
    const wd = weekdayOf(day);
    for (const r of rules) {
      if (r.weekday !== wd) continue;
      if (mode && r.modes !== 'both' && r.modes !== mode) continue;
      const end = toMinutes(r.end_time);
      for (let m = toMinutes(r.start_time); m + slotMinutes <= end; m += slotMinutes) {
        const start = beninToUtc(day, m);
        const stop = new Date(start.getTime() + slotMinutes * 60000);
        if (start.getTime() < earliest) continue;
        if (busy.some((b) => start < b.ends_at && stop > b.starts_at)) continue;
        out.push(start);
      }
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Heures fixes du médecin E.doto family (décision du 20/10/2026) : lundi à vendredi, 8 h à 18 h (heure du Bénin),
 * consultations de 30 minutes, visio et appel. Ses heures saisies ailleurs ne comptent pas.
 */
export const HOUSE_SLOT_MINUTES = 30;
export const HOUSE_RULES: AvailabilityRule[] = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_time: '08:00', end_time: '18:00', modes: 'both' }));
export const HOUSE_HOURS_LABEL = 'Lundi à vendredi, 8 h à 18 h, consultations de 30 minutes';

/**
 * Médecin E.doto family (20/10/2026) : il prend en charge toutes les heures où aucun autre médecin n'est libre.
 * Ses créneaux qui chevauchent un créneau libre d'un autre médecin sont retirés.
 */
export function houseGaps(house: Date[], houseMinutes: number, others: { start: Date; minutes: number }[]): Date[] {
  return house.filter((s) => {
    const a = s.getTime();
    const b = a + houseMinutes * 60000;
    return !others.some((o) => {
      const c = o.start.getTime();
      return a < c + o.minutes * 60000 && b > c;
    });
  });
}

// ---- Saisies ----
const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
export function cleanText(v: unknown, max: number, label: string, required = false): string | null {
  const s = str(v).replace(/\r\n/g, '\n').trim();
  if (!s) {
    if (required) fail(`${label} est obligatoire.`);
    return null;
  }
  if (s.length > max) fail(`${label} ne doit pas dépasser ${max} caractères.`);
  return s;
}

export function parseMode(v: unknown): Mode {
  if (v === 'video' || v === 'phone') return v;
  return fail('Choisissez la visio ou l’appel téléphonique.');
}
