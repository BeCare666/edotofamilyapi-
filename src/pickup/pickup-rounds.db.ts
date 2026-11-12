// Tournées de retrait (12/11/2026, rapports/PLAN_TOURNEES_RETRAIT.md) : lectures en base autour de pickup-rounds.ts.
// Tables absentes (migration 030 pas encore lancée) : point ouvert tous les jours, rien ne casse.
import { beninNow } from '../push/reminder-rules';
import { ALWAYS_OPEN, OpeningRule, WEEKDAYS, allDaysOpen, nextRound } from './pickup-rounds';
import { pushToUser } from '../push/push-sender';
import { PushMessage } from '../push/push-messages';

const missingTable = (e: any) => e?.code === 'ER_NO_SUCH_TABLE' || e?.code === 'ER_BAD_FIELD_ERROR';

/** Jours d'ouverture et congés à venir d'un point (D8) */
export async function loadOpeningRule(db: any, pointId: number, now: Date = new Date()): Promise<OpeningRule> {
  try {
    const [dayRows]: any = await db.query(
      `SELECT ${WEEKDAYS.join(', ')} FROM pickup_open_days WHERE pickup_point_id = ? LIMIT 1`,
      [Number(pointId)],
    );
    const row = Array.isArray(dayRows) ? dayRows[0] : null;
    const days = allDaysOpen();
    if (row) for (const d of WEEKDAYS) days[d] = Number(row[d]) === 1;
    const [rows]: any = await db.query(
      `SELECT DATE_FORMAT(date_from, '%Y-%m-%d') AS date_from, DATE_FORMAT(date_to, '%Y-%m-%d') AS date_to
       FROM pickup_closures WHERE pickup_point_id = ? AND date_to >= ? ORDER BY date_from, id`,
      [Number(pointId), beninNow(now).date],
    );
    return { days, closures: (Array.isArray(rows) ? rows : []).map((r: any) => ({ from: r.date_from, to: r.date_to })) };
  } catch (e: any) {
    if (missingTable(e)) return ALWAYS_OPEN;
    throw e;
  }
}

/** Heure de disponibilité au point pour un colis payé ou demandé à l'instant donné (D1, D9) */
export async function availabilityAt(db: any, pointId: number | null | undefined, from: Date = new Date()): Promise<Date | null> {
  if (!pointId) return null;
  return nextRound(from, await loadOpeningRule(db, Number(pointId), from));
}

/** Demande de kit : rattachée au compte par l'e-mail (comme à l'inscription). Ne lève jamais d'erreur. */
export async function pushToKitOwner(db: any, email: string, msg: PushMessage): Promise<void> {
  try {
    const [rows]: any = await db.query(`SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1`, [email]);
    await pushToUser(db, rows?.[0]?.id, msg);
  } catch (e: any) {
    console.error(`[push] ${e?.message || e}`);
  }
}
