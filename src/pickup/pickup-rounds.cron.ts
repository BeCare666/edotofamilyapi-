import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.services';
import { setting } from '../platform-settings/platform-settings.store';
import { PUSH } from '../push/push-messages';
import { pushToOrderCustomer } from '../push/push-sender';
import { codeExpiry, formatRound, nextRound } from './pickup-rounds';
import { loadOpeningRule, pushToKitOwner } from './pickup-rounds.db';

// Tournées de retrait (12/11/2026, rapports/PLAN_TOURNEES_RETRAIT.md, étape 1.7), chaque minute :
//  - heure de disponibilité atteinte et colis traité (bouton « Traiter ») → notification « disponible »
//    (plateforme seulement, pas d'e-mail) ;
//  - colis non traité → tournée suivante (D7), code valable à partir de la nouvelle heure (D6),
//    notification de la nouvelle heure.
// Chaque envoi est « réservé » en base avant de partir (UPDATE conditionnel) : jamais deux fois, même avec deux serveurs.
// PUSH_CRON=off désactive ces envois (comme les autres notifications programmées).

// Colis encore à retirer (ni retiré, ni annulé, ni remboursé)
export const ORDER_PENDING_SQL = `o.payment_status = 'payment-success' AND o.delivery_type <> 'CUSTOM' AND o.otp_used = 0
  AND o.delivered_at IS NULL AND o.order_status NOT IN ('order-completed', 'order-cancelled', 'order-refunded', 'order-failed')`;
export const KIT_PENDING_SQL = `r.otp_used = 0 AND r.picked_up = 0
  AND r.order_status NOT IN ('order-completed', 'order-cancelled', 'order-refunded', 'order-failed')`;

const BATCH = 200;

@Injectable()
export class PickupRoundsCron {
  private readonly logger = new Logger('Tournées');
  private running = false;

  constructor(private readonly db: DatabaseService) {}

  private off() {
    return String(process.env.PUSH_CRON || '').toLowerCase() === 'off';
  }

  @Cron('* * * * *')
  async tick() {
    if (this.off() || this.running) return;
    this.running = true;
    try {
      const now = new Date();
      await this.orders(now);
      await this.kits(now);
    } catch (e: any) {
      this.logger.error(`${e?.message || e}`);
    } finally {
      this.running = false;
    }
  }

  private async orders(now: Date) {
    const pool: any = this.db.getPool();
    const [rows]: any = await pool.query(
      `SELECT o.id, o.pickup_point_id, o.processed_at, o.available_at FROM orders o
       WHERE o.available_notified_at IS NULL AND o.available_at IS NOT NULL AND o.available_at <= ? AND ${ORDER_PENDING_SQL}
       ORDER BY o.available_at, o.id LIMIT ${BATCH}`,
      [now],
    );
    for (const o of rows || []) {
      if (o.processed_at) {
        const [claim]: any = await pool.query(
          `UPDATE orders SET available_notified_at = UTC_TIMESTAMP() WHERE id = ? AND available_notified_at IS NULL AND available_at = ?`,
          [o.id, o.available_at],
        );
        if (claim?.affectedRows) await pushToOrderCustomer(pool, o.id, PUSH.orderAvailable(o.id));
        continue;
      }
      const next = await this.nextFor(pool, o.pickup_point_id, o.available_at, now);
      if (!next) continue;
      const [claim]: any = await pool.query(
        `UPDATE orders SET available_at = ?, otp_expires_at = ?, updated_at = NOW()
         WHERE id = ? AND available_notified_at IS NULL AND available_at = ? AND processed_at IS NULL`,
        [next, codeExpiry(next, setting('order.pickup_otp_ttl_hours')), o.id, o.available_at],
      );
      if (!claim?.affectedRows) continue;
      const { day, hour } = formatRound(next);
      await pushToOrderCustomer(pool, o.id, PUSH.orderNewTime(o.id, day, hour));
    }
  }

  private async kits(now: Date) {
    const pool: any = this.db.getPool();
    const [rows]: any = await pool.query(
      `SELECT r.id, r.email, r.pickup_center, r.processed_at, r.available_at FROM campaign_registrations r
       WHERE r.available_notified_at IS NULL AND r.available_at IS NOT NULL AND r.available_at <= ? AND ${KIT_PENDING_SQL}
       ORDER BY r.available_at, r.id LIMIT ${BATCH}`,
      [now],
    );
    for (const r of rows || []) {
      if (r.processed_at) {
        const [claim]: any = await pool.query(
          `UPDATE campaign_registrations SET available_notified_at = UTC_TIMESTAMP() WHERE id = ? AND available_notified_at IS NULL AND available_at = ?`,
          [r.id, r.available_at],
        );
        if (claim?.affectedRows) await pushToKitOwner(pool, r.email, PUSH.kitAvailable());
        continue;
      }
      const next = await this.nextFor(pool, Number(r.pickup_center), r.available_at, now);
      if (!next) continue;
      const [claim]: any = await pool.query(
        `UPDATE campaign_registrations SET available_at = ?, otp_expires_at = ?, updated_at = NOW()
         WHERE id = ? AND available_notified_at IS NULL AND available_at = ? AND processed_at IS NULL`,
        [next, codeExpiry(next, setting('campaign.otp_ttl_hours')), r.id, r.available_at],
      );
      if (!claim?.affectedRows) continue;
      const { day, hour } = formatRound(next);
      await pushToKitOwner(pool, r.email, PUSH.kitNewTime(day, hour));
    }
  }

  /** D7 : tournée suivante ; après un arrêt du serveur, à partir de maintenant (jamais une heure déjà passée) */
  private async nextFor(pool: any, pointId: number, current: Date, now: Date): Promise<Date | null> {
    const from = new Date(Math.max(new Date(current).getTime(), now.getTime()));
    const next = nextRound(from, await loadOpeningRule(pool, Number(pointId), now));
    if (!next) this.logger.warn(`Point ${pointId} : aucune tournée possible dans l'année (jours d'ouverture).`);
    return next;
  }
}
