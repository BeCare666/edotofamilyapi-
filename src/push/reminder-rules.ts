// Rappel contraception à rythme libre (décision D4, 04/11/2026) : la personne choisit le rythme,
// l'heure et la date de départ ; le site ne fait aucun calcul médical.
// Heures en heure du Bénin (UTC+1, sans changement d'heure).

export const RHYTHMS = ['daily', 'weekly', 'every4weeks', 'every3months', 'once'] as const;
export type Rhythm = (typeof RHYTHMS)[number];

export const BENIN_OFFSET_MIN = 60;
/** Rappel manqué (serveur arrêté) : envoyé s'il a moins de ce retard, sinon on attend le suivant */
export const LATE_TOLERANCE_MIN = 120;

export type Reminder = {
  rhythm: Rhythm;
  time_hm: string; // HH:MM
  start_date: string; // YYYY-MM-DD
  active: boolean;
  last_sent_at: Date | null; // instant réel (UTC)
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Date et minute du jour au Bénin pour un instant donné */
export function beninNow(now: Date): { date: string; minutes: number } {
  const t = new Date(now.getTime() + BENIN_OFFSET_MIN * 60000);
  return {
    date: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
  };
}

const dayNumber = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
};

const lastDayOfMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Le jour (heure du Bénin) est-il un jour de rappel ? */
export function isOccurrenceDay(rhythm: Rhythm, startDate: string, day: string): boolean {
  const diff = dayNumber(day) - dayNumber(startDate);
  if (diff < 0) return false;
  switch (rhythm) {
    case 'daily':
      return true;
    case 'weekly':
      return diff % 7 === 0;
    case 'every4weeks':
      return diff % 28 === 0;
    case 'once':
      return diff === 0;
    case 'every3months': {
      const [sy, sm, sd] = startDate.split('-').map(Number);
      const [y, m, d] = day.split('-').map(Number);
      const months = (y - sy) * 12 + (m - sm);
      if (months % 3 !== 0) return false;
      // 31 janvier tous les 3 mois : le 30 avril (dernier jour du mois)
      return d === Math.min(sd, lastDayOfMonth(y, m - 1));
    }
    default:
      return false;
  }
}

export function parseTime(hm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function isValidDate(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return false;
  const [y, m, d] = ymd.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= lastDayOfMonth(y, m - 1);
}

/** Le rappel doit-il partir maintenant ? */
export function isDue(r: Reminder, now: Date): boolean {
  if (!r.active) return false;
  const at = parseTime(r.time_hm);
  if (at === null || !isValidDate(r.start_date)) return false;
  const { date, minutes } = beninNow(now);
  if (!isOccurrenceDay(r.rhythm, r.start_date, date)) return false;
  if (minutes < at || minutes - at > LATE_TOLERANCE_MIN) return false;
  // Déjà envoyé ce jour-là (heure du Bénin)
  if (r.last_sent_at && beninNow(r.last_sent_at).date === date) return false;
  return true;
}
