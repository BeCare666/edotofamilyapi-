// Recherche des anciennes listes de l'admin (19/10/2026).
// L'admin envoie « search=name:texte;is_active:true » (format hérité) ; les listes cherchaient la
// chaîne entière (« %name:texte% ») et ne trouvaient jamais rien. Ce lecteur accepte les deux formes :
// texte simple ou paires clé:valeur séparées par « ; ».

export type LegacySearch = { text: string; fields: Record<string, string> };

export function parseLegacySearch(search: unknown, textKeys: string[] = ['name', 'text', 'q']): LegacySearch {
  const raw = typeof search === 'string' ? search.trim() : '';
  if (!raw) return { text: '', fields: {} };
  const parts = raw.split(';').map((p) => p.trim()).filter(Boolean);
  const isPairs = parts.every((p) => /^[a-z_][a-z0-9_.]*:/i.test(p));
  if (!isPairs) return { text: raw, fields: {} };
  const fields: Record<string, string> = {};
  for (const p of parts) {
    const i = p.indexOf(':');
    fields[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  const key = textKeys.find((k) => fields[k]);
  return { text: key ? fields[key] : '', fields };
}

/** Valeur booléenne d'un filtre (« true », « 1 », « false », « 0 ») ; null si absente ou illisible */
export function boolParam(v: unknown): boolean | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return null;
}

/** Sens de tri sûr */
export const sortDir = (v: unknown) => (String(v ?? '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC');

/** Jour au Bénin (AAAA-MM-JJ, UTC+1) → borne UTC pour MySQL ; null si le format est invalide */
export function beninDayStartUtc(s: unknown, addDays = 0): string | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + addDays) - 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}
