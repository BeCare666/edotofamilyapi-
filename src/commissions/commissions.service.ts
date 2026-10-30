import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { CommissionType, parseCommissionValue, parseScope } from './commission-rules';
import { parsePayout, pointMoney } from './payouts';

const COLUMN: Record<CommissionType, 'order_rate_percent' | 'kit_amount'> = {
  orders: 'order_rate_percent',
  kits: 'kit_amount',
};

@Injectable()
export class CommissionsService {
  constructor(private readonly db: DatabaseService) { }

  async getSettings() {
    const [rows]: any = await this.db.getPool().query(
      `SELECT order_rate_percent, kit_amount, updated_at FROM pickup_commission_settings WHERE id = 1 LIMIT 1`,
    );
    const r = rows?.[0] ?? {};
    return {
      order_rate_percent: Number(r.order_rate_percent ?? 0),
      kit_amount: Number(r.kit_amount ?? 0),
      updated_at: r.updated_at ?? null,
    };
  }

  // Points de retrait validés, avec leur valeur (particulière ou par défaut) et leurs commissions cumulées
  async overview(q?: string) {
    const pool = this.db.getPool();
    const settings = await this.getSettings();
    const search = typeof q === 'string' && q.trim() ? `%${q.trim()}%` : null;
    const [rows]: any = await pool.query(
      `SELECT u.id, u.name, u.email, u.pickup_address, u.is_active,
              ov.order_rate_percent AS own_order_rate, ov.kit_amount AS own_kit_amount,
              (SELECT COUNT(*) FROM orders o WHERE o.pickup_point_id = u.id AND o.order_status = 'order-completed') AS orders_withdrawn,
              (SELECT COALESCE(SUM(o.commission_amount), 0) FROM orders o WHERE o.pickup_point_id = u.id AND o.order_status = 'order-completed') AS orders_commission,
              (SELECT COUNT(*) FROM campaign_registrations r WHERE r.pickup_center = CAST(u.id AS CHAR) AND r.picked_up = 1) AS kits_withdrawn,
              (SELECT COALESCE(SUM(r.commission_amount), 0) FROM campaign_registrations r WHERE r.pickup_center = CAST(u.id AS CHAR) AND r.picked_up = 1) AS kits_commission
       FROM users u
       LEFT JOIN pickup_commission_overrides ov ON ov.pickup_point_id = u.id
       WHERE u.role = 'super_pickuppoint' AND u.pickup_approved = 1
         ${search ? 'AND (u.name LIKE ? OR u.email LIKE ? OR u.pickup_address LIKE ?)' : ''}
       ORDER BY u.name ASC`,
      search ? [search, search, search] : [],
    );
    // Versements (B7, migration 024) : absents avant la migration, tout reste alors « à verser »
    const paidBy = new Map<number, number>();
    try {
      const [paid]: any = await pool.query(`SELECT pickup_point_id, SUM(amount) AS paid FROM pickup_payouts GROUP BY pickup_point_id`);
      for (const p of paid || []) paidBy.set(Number(p.pickup_point_id), Number(p.paid) || 0);
    } catch (err: any) {
      if (!/pickup_payouts/.test(String(err?.message))) throw err;
    }
    return {
      settings,
      points: rows.map((r: any) => {
        const ownRate = r.own_order_rate === null ? null : Number(r.own_order_rate);
        const ownKit = r.own_kit_amount === null ? null : Number(r.own_kit_amount);
        return {
          id: Number(r.id),
          name: r.name,
          email: r.email,
          pickup_address: r.pickup_address,
          status: Number(r.is_active) === 0 ? 'blocked' : 'active',
          order_rate_percent: ownRate ?? settings.order_rate_percent,
          order_rate_is_custom: ownRate !== null,
          kit_amount: ownKit ?? settings.kit_amount,
          kit_amount_is_custom: ownKit !== null,
          orders_withdrawn: Number(r.orders_withdrawn) || 0,
          orders_commission: Number(r.orders_commission) || 0,
          kits_withdrawn: Number(r.kits_withdrawn) || 0,
          kits_commission: Number(r.kits_commission) || 0,
          paid_total: paidBy.get(Number(r.id)) ?? 0,
          balance: Math.max(0, (Number(r.orders_commission) || 0) + (Number(r.kits_commission) || 0) - (paidBy.get(Number(r.id)) ?? 0)),
        };
      }),
    };
  }

  // Appliquer à tous : nouvelle valeur par défaut, les valeurs particulières de ce type sont retirées.
  // Appliquer aux points cochés : valeur particulière pour ces points.
  async apply(type: CommissionType, body: any) {
    if (type !== 'orders' && type !== 'kits') throw new BadRequestException('Type de commission invalide.');
    const value = parseCommissionValue(type, body?.value);
    const { scope, ids } = parseScope(body);
    const col = COLUMN[type];
    const conn = await this.db.getPool().getConnection();
    try {
      await conn.beginTransaction();
      if (scope === 'all') {
        await conn.query(
          `INSERT INTO pickup_commission_settings (id, ${col}) VALUES (1, ?) ON DUPLICATE KEY UPDATE ${col} = VALUES(${col})`,
          [value],
        );
        await conn.query(`UPDATE pickup_commission_overrides SET ${col} = NULL`);
        await conn.query(`DELETE FROM pickup_commission_overrides WHERE order_rate_percent IS NULL AND kit_amount IS NULL`);
      } else {
        const [found]: any = await conn.query(
          `SELECT id FROM users WHERE role = 'super_pickuppoint' AND pickup_approved = 1 AND id IN (${ids.map(() => '?').join(',')})`,
          ids,
        );
        if (found.length !== ids.length) throw new BadRequestException('Point de retrait inconnu dans la sélection.');
        for (const id of ids) {
          await conn.query(
            `INSERT INTO pickup_commission_overrides (pickup_point_id, ${col}) VALUES (?, ?) ON DUPLICATE KEY UPDATE ${col} = VALUES(${col})`,
            [id, value],
          );
        }
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    const label = type === 'orders' ? `${value} %` : `${value.toLocaleString('fr-FR')} FCFA par kit`;
    return {
      success: true,
      message: scope === 'all'
        ? `${label} appliqué à tous les points de retrait.`
        : `${label} appliqué à ${ids.length} point${ids.length > 1 ? 's' : ''} de retrait.`,
    };
  }

  // Versements d'un point de retrait (B7) : gagné, versé, reste à verser et liste
  async payouts(pointId: number) {
    const id = Number(pointId);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestException('Point de retrait invalide.');
    return pointMoney(this.db.getPool(), id);
  }

  // Noter un versement fait à un point : jamais plus que le reste à verser. La ligne du point est verrouillée
  // pendant le contrôle, deux versements simultanés ne peuvent pas dépasser le reste.
  async addPayout(body: any, adminId: number) {
    const p = parsePayout(body);
    const conn = await this.db.getPool().getConnection();
    try {
      await conn.beginTransaction();
      const [found]: any = await conn.query(
        `SELECT id, name FROM users WHERE id = ? AND role = 'super_pickuppoint' AND pickup_approved = 1 FOR UPDATE`,
        [p.pointId],
      );
      if (!found?.length) throw new BadRequestException('Point de retrait inconnu.');
      const before = await pointMoney(conn, p.pointId);
      if (p.amount > before.balance) {
        throw new BadRequestException(
          `Le versement dépasse le reste à verser (${before.balance.toLocaleString('fr-FR')} FCFA).`,
        );
      }
      await conn.query(
        `INSERT INTO pickup_payouts (pickup_point_id, amount, method, reference, note, paid_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [p.pointId, p.amount, p.method, p.reference, p.note, p.paidAt, adminId || null],
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    return {
      success: true,
      message: `Versement de ${p.amount.toLocaleString('fr-FR')} FCFA noté.`,
      ...(await pointMoney(this.db.getPool(), p.pointId)),
    };
  }
}
