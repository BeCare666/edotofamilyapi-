import { BadRequestException } from '@nestjs/common';

// Décisions du 24/09/2026 :
// - statut calculé à partir des dates : à venir (avant le début), en cours, terminée (après la fin) ;
//   date du jour au Bénin (UTC+1, sans heure d'été) ;
// - une campagne sans date de fin (ancienne donnée) reste « en cours » après son début ;
// - budget = somme des montants des sponsors ; kits fournis = objective_kits ;
//   inscrits et kits réellement retirés comptés dans campaign_registrations.
export type CampaignStatus = 'a_venir' | 'en_cours' | 'terminee';
export const CAMPAIGN_STATUSES: CampaignStatus[] = ['a_venir', 'en_cours', 'terminee'];
export const STATUS_LABELS: Record<CampaignStatus, string> = {
  a_venir: 'À venir',
  en_cours: 'En cours',
  terminee: 'Terminée',
};

export const TODAY_SQL = 'DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR))';

export function statusSql(alias = 'c') {
  return `(CASE WHEN ${alias}.date_start > ${TODAY_SQL} THEN 'a_venir'
    WHEN ${alias}.date_end IS NOT NULL AND ${alias}.date_end < ${TODAY_SQL} THEN 'terminee'
    ELSE 'en_cours' END)`;
}

// Même règle côté serveur Node (tests, fichiers Excel) ; dates au format AAAA-MM-JJ
export function computeStatus(dateStart: string, dateEnd: string | null, today: string): CampaignStatus {
  if (dateStart > today) return 'a_venir';
  if (dateEnd && dateEnd < today) return 'terminee';
  return 'en_cours';
}

export function todayInBenin(now = new Date()): string {
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Date renvoyée par mysql2 (objet Date à minuit heure locale du serveur) ou chaîne → AAAA-MM-JJ
export function toIsoDate(v: any): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}

export interface CampaignInput {
  title: string;
  description: string | null;
  image_url: string | null;
  objective_kits: number;
  date_start: string;
  date_end: string;
  cities: string[];
  sponsors: { sponsor_id: number; amount: number }[];
}

function isValidDate(s: any): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function parseCampaignInput(body: any): CampaignInput {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) throw new BadRequestException('Le nom de la campagne est obligatoire.');
  if (title.length > 255) throw new BadRequestException('Le nom de la campagne est limité à 255 caractères.');

  const kits = Number(body?.objective_kits);
  if (!Number.isInteger(kits) || kits < 0) throw new BadRequestException('Nombre de kits fournis invalide.');

  if (!isValidDate(body?.date_start)) throw new BadRequestException('Date de début invalide.');
  if (!isValidDate(body?.date_end)) throw new BadRequestException('La date de fin est obligatoire.');
  if (body.date_end < body.date_start) {
    throw new BadRequestException('La date de fin doit être après la date de début.');
  }

  const rawCities = Array.isArray(body?.cities) ? body.cities : [];
  const cities: string[] = [];
  const seen = new Set<string>();
  for (const c of rawCities) {
    const city = typeof c === 'string' ? c.trim() : '';
    if (!city) continue;
    if (city.length > 100) throw new BadRequestException('Nom de ville trop long (100 caractères max).');
    const key = city.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      cities.push(city);
    }
  }
  if (cities.length === 0) throw new BadRequestException('Indiquez au moins une ville.');

  const rawSponsors = Array.isArray(body?.sponsors) ? body.sponsors : [];
  const sponsors: { sponsor_id: number; amount: number }[] = [];
  const seenSponsors = new Set<number>();
  for (const s of rawSponsors) {
    const id = Number(s?.sponsor_id);
    const amount = Number(s?.amount ?? 0);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestException('Sponsor invalide.');
    if (!Number.isFinite(amount) || amount < 0) throw new BadRequestException('Montant de sponsor invalide.');
    if (seenSponsors.has(id)) throw new BadRequestException('Un même sponsor ne peut être ajouté qu’une fois.');
    seenSponsors.add(id);
    sponsors.push({ sponsor_id: id, amount: Math.round(amount * 100) / 100 });
  }

  const description = typeof body?.description === 'string' && body.description.trim() ? body.description.trim() : null;
  const imageUrl = typeof body?.image_url === 'string' && body.image_url.trim() ? body.image_url.trim() : null;
  if (imageUrl && imageUrl.length > 500) throw new BadRequestException("Lien de l'image trop long.");

  return {
    title,
    description,
    image_url: imageUrl,
    objective_kits: kits,
    date_start: body.date_start,
    date_end: body.date_end,
    cities,
    sponsors,
  };
}

export function parseSponsorInput(body: any) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!name || name.length > 255) throw new BadRequestException('Nom du sponsor obligatoire (255 caractères max).');
  if (!email || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException('E-mail du sponsor invalide.');
  }
  return { name, email };
}

// Sponsors d'une campagne à modifier : ajouts, mises à jour de montant, retraits
export function diffSponsors(
  current: { sponsor_id: number; amount: number }[],
  wanted: { sponsor_id: number; amount: number }[],
) {
  const cur = new Map(current.map((s) => [Number(s.sponsor_id), Number(s.amount)]));
  const want = new Map(wanted.map((s) => [s.sponsor_id, s.amount]));
  return {
    added: wanted.filter((s) => !cur.has(s.sponsor_id)),
    updated: wanted.filter((s) => cur.has(s.sponsor_id) && cur.get(s.sponsor_id) !== s.amount),
    removed: current.filter((s) => !want.has(Number(s.sponsor_id))).map((s) => Number(s.sponsor_id)),
  };
}
