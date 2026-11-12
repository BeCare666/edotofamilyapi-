import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { setting } from '../platform-settings/platform-settings.store';
import { PUSH } from '../push/push-messages';
import { pushToOrderCustomer } from '../push/push-sender';
import { beninNow } from '../push/reminder-rules';
import {
  ALWAYS_OPEN,
  OpeningRule,
  Parcel,
  WEEKDAYS,
  closingConflicts,
  codeExpiry,
  formatDate,
  formatRound,
  nextRound,
  parseOpeningRule,
  rescheduledRound,
} from './pickup-rounds';
import { loadOpeningRule, pushToKitOwner } from './pickup-rounds.db';
import { KIT_PENDING_SQL, ORDER_PENDING_SQL } from './pickup-rounds.cron';

// Jours d'ouverture d'un point de retrait (12/11/2026, rapports/PLAN_TOURNEES_RETRAIT.md, 1.8 et 1.9).
// Réglés par le point lui-même (D8) ; le super admin ne les modifie pas.

const MAX_PUBLIC_POINTS = 50;

@Injectable()
export class PickupOpeningService {
  constructor(private readonly db: DatabaseService) {}

  private pool(): any {
    return this.db.getPool();
  }

  /** Espace du point : jours cochés, congés à venir, prochaine tournée */
  async get(pointId: number) {
    const now = new Date();
    const rule = await loadOpeningRule(this.pool(), pointId, now);
    return { ...rule, next: this.describeNext(rule, now) };
  }

  /** Enregistrement : refus selon D11 et Q1-Q3, puis recalcul et notifications (D10) */
  async save(pointId: number, body: any) {
    const now = new Date();
    const { rule, error } = parseOpeningRule(body, now);
    if (error) throw new BadRequestException(error);
    const pool = this.pool();
    const before = await loadOpeningRule(pool, pointId, now);

    const conflicts = closingConflicts(before, rule, await this.parcels(pointId), now);
    if (conflicts.length) {
      const shown = conflicts.slice(0, 5).map(formatDate).join(', ');
      const more = conflicts.length > 5 ? ` (et ${conflicts.length - 5} autre${conflicts.length - 5 > 1 ? 's' : ''})` : '';
      throw new BadRequestException(
        `Des colis de clients sont chez vous ou doivent y arriver le ${shown}${more} : ${conflicts.length > 1 ? 'ces jours ne peuvent pas être fermés' : 'ce jour ne peut pas être fermé'} tant qu'ils ne sont pas retirés ou que leur code n'a pas expiré.`,
      );
    }

    const conn: any = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO pickup_open_days (pickup_point_id, ${WEEKDAYS.join(', ')}) VALUES (?, ${WEEKDAYS.map(() => '?').join(', ')})
         ON DUPLICATE KEY UPDATE ${WEEKDAYS.map((d) => `${d} = VALUES(${d})`).join(', ')}`,
        [pointId, ...WEEKDAYS.map((d) => (rule.days[d] ? 1 : 0))],
      );
      // Congés à venir remplacés ; les congés passés restent (historique)
      await conn.query(`DELETE FROM pickup_closures WHERE pickup_point_id = ? AND date_to >= ?`, [pointId, beninNow(now).date]);
      if (rule.closures.length) {
        await conn.query(`INSERT INTO pickup_closures (pickup_point_id, date_from, date_to) VALUES ?`, [
          rule.closures.map((c) => [pointId, c.from, c.to]),
        ]);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      conn.release?.();
    }

    const moved = await this.reschedule(pointId, rule, now);
    return {
      success: true,
      message: moved
        ? `Jours d'ouverture enregistrés. ${moved} client${moved > 1 ? 's ont' : ' a'} reçu la nouvelle heure de son colis.`
        : "Jours d'ouverture enregistrés.",
      ...rule,
      next: this.describeNext(rule, now),
    };
  }

  /** Colis encore à retirer chez ce point (commandes et kits), arrivés ou prévus */
  private async parcels(pointId: number): Promise<Parcel[]> {
    const pool = this.pool();
    const [orders]: any = await pool.query(
      `SELECT o.available_at, o.otp_expires_at FROM orders o
       WHERE o.pickup_point_id = ? AND o.available_at IS NOT NULL AND ${ORDER_PENDING_SQL}`,
      [pointId],
    );
    const [kits]: any = await pool.query(
      `SELECT r.available_at, r.otp_expires_at FROM campaign_registrations r
       WHERE r.pickup_center = ? AND r.available_at IS NOT NULL AND ${KIT_PENDING_SQL}`,
      [String(pointId)],
    );
    return [...(orders || []), ...(kits || [])].map((p: any) => ({
      available_at: new Date(p.available_at),
      otp_expires_at: p.otp_expires_at ? new Date(p.otp_expires_at) : null,
    }));
  }

  /** D10 : colis pas encore arrivés recalculés ; chaque client reçoit sa nouvelle heure (notification seulement) */
  private async reschedule(pointId: number, rule: OpeningRule, now: Date): Promise<number> {
    const pool = this.pool();
    let moved = 0;
    const [orders]: any = await pool.query(
      `SELECT o.id, o.available_at FROM orders o
       WHERE o.pickup_point_id = ? AND o.available_notified_at IS NULL AND o.available_at > ? AND ${ORDER_PENDING_SQL}`,
      [pointId, now],
    );
    for (const o of orders || []) {
      const next = rescheduledRound(new Date(o.available_at), rule, now);
      if (!next) continue;
      const [res]: any = await pool.query(
        `UPDATE orders SET available_at = ?, otp_expires_at = ?, updated_at = NOW()
         WHERE id = ? AND available_notified_at IS NULL AND available_at = ?`,
        [next, codeExpiry(next, setting('order.pickup_otp_ttl_hours')), o.id, o.available_at],
      );
      if (!res?.affectedRows) continue;
      moved++;
      const { day, hour } = formatRound(next);
      void pushToOrderCustomer(pool, o.id, PUSH.orderNewTime(o.id, day, hour));
    }
    const [kits]: any = await pool.query(
      `SELECT r.id, r.email, r.available_at FROM campaign_registrations r
       WHERE r.pickup_center = ? AND r.available_notified_at IS NULL AND r.available_at > ? AND ${KIT_PENDING_SQL}`,
      [String(pointId), now],
    );
    for (const r of kits || []) {
      const next = rescheduledRound(new Date(r.available_at), rule, now);
      if (!next) continue;
      const [res]: any = await pool.query(
        `UPDATE campaign_registrations SET available_at = ?, otp_expires_at = ?, updated_at = NOW()
         WHERE id = ? AND available_notified_at IS NULL AND available_at = ?`,
        [next, codeExpiry(next, setting('campaign.otp_ttl_hours')), r.id, r.available_at],
      );
      if (!res?.affectedRows) continue;
      moved++;
      const { day, hour } = formatRound(next);
      void pushToKitOwner(pool, r.email, PUSH.kitNewTime(day, hour));
    }
    return moved;
  }

  /**
   * Prochaine tournée d'un point ; closed_on : jour (« dimanche ») où la tournée aurait eu lieu si le point
   * était ouvert (D9 : « fermé le dimanche : disponible lundi à 09 h 00 »), sinon null.
   */
  private describeNext(rule: OpeningRule, now: Date) {
    const at = nextRound(now, rule);
    if (!at) return { available_at: null, day: null, hour: null, closed_on: null };
    const usual = nextRound(now, ALWAYS_OPEN);
    const closedDay = usual && beninNow(usual).date !== beninNow(at).date ? formatDate(beninNow(usual).date).split(' ')[0] : null;
    return { available_at: at, ...formatRound(at), closed_on: closedDay };
  }

  /** 1.9 Route publique : prochaine heure de disponibilité de chaque point demandé (choix du point, D9) */
  async nextForPoints(raw: unknown) {
    const ids = [
      ...new Set(
        String(raw ?? '')
          .split(',')
          .map((v) => Number(v.trim()))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ].slice(0, MAX_PUBLIC_POINTS);
    if (!ids.length) return [];
    const [rows]: any = await this.pool().query(
      `SELECT id FROM users WHERE role = 'super_pickuppoint' AND pickup_approved = 1 AND id IN (?)`,
      [ids],
    );
    const now = new Date();
    const out: any[] = [];
    for (const r of rows || []) {
      out.push({ id: Number(r.id), ...this.describeNext(await loadOpeningRule(this.pool(), Number(r.id), now), now) });
    }
    return out;
  }
}
