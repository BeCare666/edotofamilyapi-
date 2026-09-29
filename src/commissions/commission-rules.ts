import { BadRequestException } from '@nestjs/common';

// Commissions des points de retrait (décisions du 25/09/2026) :
// - commandes : pourcentage du montant des produits de la commande retirée ;
// - kits : montant fixe (FCFA) par kit retiré ;
// - valeur par défaut (pickup_commission_settings) ou valeur particulière du point (overrides) ;
// - calculée et figée au moment du retrait ; arrondie au franc.
export type CommissionType = 'orders' | 'kits';
export const MAX_KIT_AMOUNT = 1_000_000;

// Taux applicable au point de retrait de la commande `o` (NULL si réglages absents)
export const ORDER_RATE_SQL = `(SELECT COALESCE(ov.order_rate_percent, s.order_rate_percent)
  FROM pickup_commission_settings s
  LEFT JOIN pickup_commission_overrides ov ON ov.pickup_point_id = o.pickup_point_id
  WHERE s.id = 1)`;

// Montant des produits de la commande `o` (sans frais de livraison)
export const ORDER_PRODUCTS_SQL = `(SELECT COALESCE(SUM(oc.subtotal), 0) FROM order_children oc WHERE oc.order_id = o.id)`;

export const ORDER_COMMISSION_SET_SQL = `commission_rate = ${ORDER_RATE_SQL},
  commission_amount = ROUND(${ORDER_PRODUCTS_SQL} * ${ORDER_RATE_SQL} / 100, 0)`;

// Montant par kit applicable au point de l'inscription `r` (pickup_center = identifiant du point, en texte)
export const KIT_AMOUNT_SQL = `(SELECT COALESCE(ov.kit_amount, s.kit_amount)
  FROM pickup_commission_settings s
  LEFT JOIN pickup_commission_overrides ov ON CAST(ov.pickup_point_id AS CHAR) = r.pickup_center
  WHERE s.id = 1)`;

export function computeOrderCommission(productsAmount: number, ratePercent: number) {
  return Math.round((Number(productsAmount) || 0) * (Number(ratePercent) || 0) / 100);
}

export function parseCommissionValue(type: CommissionType, raw: any): number {
  const v = Number(raw);
  if (raw === null || raw === undefined || raw === '' || !Number.isFinite(v) || v < 0) {
    throw new BadRequestException(type === 'orders' ? 'Pourcentage invalide.' : 'Montant par kit invalide.');
  }
  if (type === 'orders') {
    if (v > 100) throw new BadRequestException('Le pourcentage ne peut pas dépasser 100 %.');
    return Math.round(v * 100) / 100;
  }
  if (v > MAX_KIT_AMOUNT) throw new BadRequestException('Montant par kit trop élevé.');
  return Math.round(v);
}

export function parseScope(body: any): { scope: 'all' | 'selected'; ids: number[] } {
  if (body?.scope === 'all') return { scope: 'all', ids: [] };
  if (body?.scope !== 'selected') throw new BadRequestException('Choisissez « tous les points » ou des points cochés.');
  const ids = [...new Set((Array.isArray(body?.pickup_point_ids) ? body.pickup_point_ids : []).map(Number))]
    .filter((n) => Number.isInteger(n) && n > 0) as number[];
  if (!ids.length) throw new BadRequestException('Cochez au moins un point de retrait.');
  return { scope: 'selected', ids };
}

// ---------------------------------------------------------------- périodes (heure du Bénin, UTC+1)
export type Period = 'day' | 'month' | 'year';
const BENIN_OFFSET_MS = 60 * 60 * 1000;

function pad(n: number) {
  return String(n).padStart(2, '0');
}

// Chaîne « AAAA-MM-JJ HH:MM:SS » en UTC pour une date locale Bénin (année, mois 1-12, jour)
function beninLocalToUtc(y: number, m: number, d: number): string {
  const t = Date.UTC(y, m - 1, d) - BENIN_OFFSET_MS;
  return new Date(t).toISOString().slice(0, 19).replace('T', ' ');
}

export interface PeriodRange {
  period: Period;
  key: string; // AAAA-MM-JJ, AAAA-MM ou AAAA
  startUtc: string;
  endUtc: string; // exclu
  buckets: { key: string; label: string }[];
}

export function parsePeriod(periodRaw: any, dateRaw: any, now = new Date()): PeriodRange {
  const period: Period = ['day', 'month', 'year'].includes(periodRaw) ? periodRaw : 'month';
  const today = new Date(now.getTime() + BENIN_OFFSET_MS).toISOString().slice(0, 10);
  const date = typeof dateRaw === 'string' ? dateRaw : '';
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  let d = Number(today.slice(8, 10));

  if (period === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(date)) [y, m, d] = date.split('-').map(Number);
  if (period === 'month' && /^\d{4}-\d{2}$/.test(date)) [y, m] = date.split('-').map(Number);
  if (period === 'year' && /^\d{4}$/.test(date)) y = Number(date);
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) {
    throw new BadRequestException('Période invalide.');
  }

  if (period === 'day') {
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    return {
      period,
      key: `${y}-${pad(m)}-${pad(d)}`,
      startUtc: beninLocalToUtc(y, m, d),
      endUtc: beninLocalToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()),
      buckets: Array.from({ length: 24 }, (_, h) => ({ key: pad(h), label: `${pad(h)}h` })),
    };
  }
  if (period === 'month') {
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return {
      period,
      key: `${y}-${pad(m)}`,
      startUtc: beninLocalToUtc(y, m, 1),
      endUtc: beninLocalToUtc(ny, nm, 1),
      buckets: Array.from({ length: days }, (_, i) => ({ key: pad(i + 1), label: String(i + 1) })),
    };
  }
  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  return {
    period,
    key: String(y),
    startUtc: beninLocalToUtc(y, 1, 1),
    endUtc: beninLocalToUtc(y + 1, 1, 1),
    buckets: MONTHS.map((label, i) => ({ key: pad(i + 1), label })),
  };
}

// Clé de regroupement d'un horodatage UTC « AAAA-MM-JJ HH:MM:SS » selon la période (heure du Bénin)
export function bucketKey(utc: string, period: Period): string {
  const local = new Date(new Date(`${utc.replace(' ', 'T')}Z`).getTime() + BENIN_OFFSET_MS).toISOString();
  if (period === 'day') return local.slice(11, 13);
  if (period === 'month') return local.slice(8, 10);
  return local.slice(5, 7);
}

// Horodatage UTC (base) → ISO avec « Z » pour l'affichage côté navigateur
export function utcToIso(utc: string | null): string | null {
  return utc ? `${utc.replace(' ', 'T')}Z` : null;
}
