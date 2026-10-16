import { cityOf } from '../common/geo-city';

// Ville d'un point de retrait, déduite de sa position GPS enregistrée (décision du 16/10/2026).
// Gardée en base (users.pickup_city) avec la position qui a servi au calcul : recalculée
// seulement si le point a changé de position.
export async function pickupCityOf(
  pool: { query: (sql: string, params?: any[]) => Promise<any> },
  point: { id: number | string; pickup_lat: any; pickup_lng: any; pickup_city?: string | null; pickup_city_src?: string | null },
): Promise<string | null> {
  const lat = Number(point.pickup_lat);
  const lng = Number(point.pickup_lng);
  if (point.pickup_lat === null || point.pickup_lat === undefined || point.pickup_lng === null || point.pickup_lng === undefined ||
      !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  const src = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (point.pickup_city && point.pickup_city_src === src) return point.pickup_city;
  const city = await cityOf(lat, lng);
  await pool.query(`UPDATE users SET pickup_city = ?, pickup_city_src = ? WHERE id = ?`, [city, src, point.id]);
  return city;
}
