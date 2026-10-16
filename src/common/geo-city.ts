import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

// Ville (commune) d'une position GPS, par OpenStreetMap (Nominatim), comme la détection du site
// (edoto/lib/beninCities.js). Sert à vérifier qu'une personne est bien dans la ville d'une campagne
// et à connaître la ville d'un point de retrait à partir de sa position enregistrée (16/10/2026).
// Volume faible (une lecture par demande de kit, une par point de retrait) : conforme à l'usage
// gratuit de Nominatim (1 requête/seconde au plus, en-tête User-Agent identifiant le service).

const NOMINATIM = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'edotofamily-api/1.0 (edotofamily@gmail.com)';
const TTL = 24 * 60 * 60 * 1000;

// Comparaison de noms de villes : sans accents, sans casse, traits d'union et apostrophes = espaces
export function normCity(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-'’_.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanPosition(lat: unknown, lng: unknown): { lat: number; lng: number } {
  const la = Number(lat);
  const lo = Number(lng);
  if (lat === null || lat === undefined || lat === '' || lng === null || lng === undefined || lng === '' ||
      !Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
    throw new BadRequestException('Position GPS manquante ou non valide : autorisez la localisation pour continuer.');
  }
  return { lat: la, lng: lo };
}

type Lookup = { names: string[]; country: string | null };
const cache = new Map<string, { at: number; value: Lookup }>();
let queue: Promise<unknown> = Promise.resolve();
let last = 0;

// Une requête à la fois, espacées d'au moins 1,1 s (règle d'usage de Nominatim)
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

export type Fetcher = (url: string, init: any) => Promise<{ ok: boolean; json: () => Promise<any> }>;
let fetcher: Fetcher = (url, init) => fetch(url, init) as any;
// Pour les tests uniquement
export function setGeoFetcher(f: Fetcher | null) {
  fetcher = f ?? ((url, init) => fetch(url, init) as any);
  cache.clear();
  last = 0;
}

// Noms candidats de la commune pour une position (du plus précis au plus large)
export async function lookupPosition(lat: number, lng: number): Promise<Lookup> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await throttled(async () => {
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetcher(
        `${NOMINATIM}/reverse?format=json&zoom=10&lat=${lat}&lon=${lng}&accept-language=fr`,
        { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: ctrl.signal },
      );
      if (!res.ok) throw new Error('réponse invalide');
      const a = (await res.json())?.address || {};
      const names = [a.city, a.town, a.municipality, a.village, a.county, a.state_district]
        .filter((x) => typeof x === 'string' && x.trim());
      return { names, country: typeof a.country_code === 'string' ? a.country_code : null };
    } finally {
      clearTimeout(tm);
    }
  }).catch(() => {
    // Vérification impossible : on refuse plutôt que de laisser passer sans contrôle
    throw new ServiceUnavailableException('Vérification de votre position impossible pour le moment. Réessayez dans un instant.');
  });
  cache.set(key, { at: Date.now(), value });
  return value;
}

// Ville de la liste « allowed » où se trouve la position, ou null si elle n'y est pas
export async function cityAmong(lat: number, lng: number, allowed: string[]): Promise<string | null> {
  const { names } = await lookupPosition(lat, lng);
  const wanted = new Map(allowed.map((c) => [normCity(c), c]));
  for (const n of names) {
    const m = wanted.get(normCity(n));
    if (m) return m;
  }
  return null;
}

// Commune d'une position (premier nom trouvé), ou null
export async function cityOf(lat: number, lng: number): Promise<string | null> {
  const { names } = await lookupPosition(lat, lng);
  return names[0] ?? null;
}
