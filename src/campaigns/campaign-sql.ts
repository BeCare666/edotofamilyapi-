import { statusSql, toIsoDate } from './campaign-rules';

// Colonnes calculées communes (statut, villes, budget, inscrits, kits retirés)
export function campaignExtraColumns(alias = 'c') {
  return `${statusSql(alias)} AS status,
    (SELECT GROUP_CONCAT(l.city ORDER BY l.city SEPARATOR '||') FROM campaign_locations l WHERE l.campaign_id = ${alias}.id) AS cities_raw,
    (SELECT COALESCE(SUM(cs.amount), 0) FROM campaign_sponsors cs WHERE cs.campaign_id = ${alias}.id) AS budget,
    (SELECT COUNT(*) FROM campaign_registrations r WHERE r.campaign_id = ${alias}.id) AS registrations_count,
    (SELECT COUNT(*) FROM campaign_registrations r WHERE r.campaign_id = ${alias}.id AND r.picked_up = 1) AS picked_up_count`;
}

// Mise en forme : villes en tableau ; `location` = villes jointes (compatibilité de l'affichage existant)
export function decorateCampaign(row: any) {
  const { cities_raw, ...rest } = row;
  const cities: string[] = cities_raw ? String(cities_raw).split('||') : row.location ? [row.location] : [];
  return {
    ...rest,
    cities,
    location: cities.length ? cities.join(', ') : row.location ?? null,
    budget: Number(row.budget) || 0,
    registrations_count: Number(row.registrations_count) || 0,
    picked_up_count: Number(row.picked_up_count) || 0,
  };
}

export function isoDates(row: any) {
  return { ...row, date_start: toIsoDate(row.date_start), date_end: toIsoDate(row.date_end) };
}
