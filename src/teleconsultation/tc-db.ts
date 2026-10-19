// Dates de la téléconsultation : toujours écrites et lues en UTC, sous forme de texte,
// pour ne dépendre ni du fuseau du serveur Node ni de celui de la session MySQL.
export const utcSql = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
export const iso = (col: string, alias?: string) => `DATE_FORMAT(${col}, '%Y-%m-%dT%H:%i:%sZ') AS ${alias ?? col.split('.').pop()}`;
export const isoDate = (v: unknown) => (v ? new Date(String(v)) : null);
export const num = (v: unknown) => Number(v ?? 0);
