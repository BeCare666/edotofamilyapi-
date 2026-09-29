jest.mock('../auth/mailer', () => ({ sendVerificationEmail: jest.fn().mockResolvedValue(undefined) }));

import { BadRequestException } from '@nestjs/common';
import { CommissionsService } from './commissions.service';
import { PickupDashboardService } from '../pickup/pickup-dashboard.service';
import { OrdersService } from '../orders/orders.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import {
  bucketKey,
  computeOrderCommission,
  KIT_AMOUNT_SQL,
  ORDER_COMMISSION_SET_SQL,
  parseCommissionValue,
  parsePeriod,
  parseScope,
} from './commission-rules';

type Handler = (sql: string, params: any[]) => any;
function fakeDb(handler: Handler) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    return [handler(sql, params) ?? [], []];
  });
  const conn = { query, beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
  const pool = { query, getConnection: jest.fn(async () => conn) };
  return { calls, conn, db: { getPool: () => pool, query } as any };
}

describe('Règles des commissions', () => {
  it('commande : pourcentage du montant des produits, arrondi au franc', () => {
    expect(computeOrderCommission(8000, 5)).toBe(400);
    expect(computeOrderCommission(2931, 2.5)).toBe(73);
    expect(ORDER_COMMISSION_SET_SQL).toContain('SUM(oc.subtotal)');
    expect(ORDER_COMMISSION_SET_SQL).toContain('COALESCE(ov.order_rate_percent, s.order_rate_percent)');
    expect(KIT_AMOUNT_SQL).toContain('COALESCE(ov.kit_amount, s.kit_amount)');
  });

  it('valeurs : pourcentage 0–100, montant par kit ≥ 0 arrondi', () => {
    expect(parseCommissionValue('orders', '7.555')).toBe(7.56);
    expect(() => parseCommissionValue('orders', 101)).toThrow('100 %');
    expect(() => parseCommissionValue('orders', -1)).toThrow(BadRequestException);
    expect(() => parseCommissionValue('kits', '')).toThrow(BadRequestException);
    expect(parseCommissionValue('kits', '499.6')).toBe(500);
  });

  it('portée : tous, ou points cochés (au moins un)', () => {
    expect(parseScope({ scope: 'all' })).toEqual({ scope: 'all', ids: [] });
    expect(parseScope({ scope: 'selected', pickup_point_ids: ['3', 3, 'x', 5] })).toEqual({ scope: 'selected', ids: [3, 5] });
    expect(() => parseScope({ scope: 'selected', pickup_point_ids: [] })).toThrow('Cochez');
    expect(() => parseScope({})).toThrow(BadRequestException);
  });

  it('périodes à l’heure du Bénin (UTC+1) : bornes UTC et regroupement', () => {
    const day = parsePeriod('day', '2026-09-25');
    expect([day.startUtc, day.endUtc]).toEqual(['2026-09-24 23:00:00', '2026-09-25 23:00:00']);
    expect(day.buckets).toHaveLength(24);
    const month = parsePeriod('month', '2026-02');
    expect([month.startUtc, month.endUtc, month.buckets.length]).toEqual(['2026-01-31 23:00:00', '2026-02-28 23:00:00', 28]);
    const year = parsePeriod('year', '2026');
    expect([year.startUtc, year.endUtc, year.buckets.length]).toEqual(['2025-12-31 23:00:00', '2026-12-31 23:00:00', 12]);
    const dec = parsePeriod('month', '2026-12');
    expect(dec.endUtc).toBe('2026-12-31 23:00:00');
    // 23h30 UTC le 24 = 00h30 le 25 au Bénin
    expect(bucketKey('2026-09-24 23:30:00', 'day')).toBe('00');
    expect(bucketKey('2026-09-24 23:30:00', 'month')).toBe('25');
    expect(parsePeriod(undefined, undefined, new Date('2026-09-24T23:30:00Z')).key).toBe('2026-09');
    expect(() => parsePeriod('month', '2026-13')).toThrow('Période invalide');
  });
});

describe('Admin : appliquer une commission', () => {
  it('à tous : nouvelle valeur par défaut, valeurs particulières de ce type retirées', async () => {
    const { db, calls, conn } = fakeDb(() => ({}));
    const res = await new CommissionsService(db).apply('orders', { value: 5, scope: 'all' });
    expect(calls[0].sql).toContain('INSERT INTO pickup_commission_settings (id, order_rate_percent)');
    expect(calls[0].params).toEqual([5]);
    expect(calls[1].sql).toBe('UPDATE pickup_commission_overrides SET order_rate_percent = NULL');
    expect(calls[2].sql).toContain('DELETE FROM pickup_commission_overrides WHERE order_rate_percent IS NULL AND kit_amount IS NULL');
    expect(conn.commit).toHaveBeenCalled();
    expect(res.message).toContain('tous les points');
  });

  it('aux points cochés : valeur particulière pour chacun ; point inconnu → annulé', async () => {
    const ok = fakeDb((sql) => (sql.startsWith('SELECT id FROM users') ? [{ id: 3 }, { id: 5 }] : {}));
    await new CommissionsService(ok.db).apply('kits', { value: 500, scope: 'selected', pickup_point_ids: [3, 5] });
    const ups = ok.calls.filter((c) => c.sql.startsWith('INSERT INTO pickup_commission_overrides'));
    expect(ups.map((c) => c.params)).toEqual([[3, 500], [5, 500]]);
    expect(ups[0].sql).toContain('kit_amount = VALUES(kit_amount)');
    expect(ok.calls.some((c) => c.sql.includes('pickup_commission_settings'))).toBe(false);

    const bad = fakeDb((sql) => (sql.startsWith('SELECT id FROM users') ? [{ id: 3 }] : {}));
    await expect(new CommissionsService(bad.db).apply('kits', { value: 500, scope: 'selected', pickup_point_ids: [3, 99] })).rejects.toThrow('inconnu');
    expect(bad.conn.rollback).toHaveBeenCalled();
  });

  it('vue d’ensemble : valeur particulière sinon valeur par défaut', async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes('FROM pickup_commission_settings')) return [{ order_rate_percent: '5.00', kit_amount: '300.00' }];
      if (sql.includes('FROM users u')) return [
        { id: 3, name: 'A', own_order_rate: '7.50', own_kit_amount: null, is_active: 1, orders_withdrawn: 2, orders_commission: '600', kits_withdrawn: 1, kits_commission: '300' },
        { id: 5, name: 'B', own_order_rate: null, own_kit_amount: null, is_active: 0, orders_withdrawn: 0, orders_commission: '0', kits_withdrawn: 0, kits_commission: '0' },
      ];
      return [];
    });
    const res = await new CommissionsService(db).overview();
    expect(res.points[0]).toEqual(expect.objectContaining({ order_rate_percent: 7.5, order_rate_is_custom: true, kit_amount: 300, kit_amount_is_custom: false, orders_commission: 600 }));
    expect(res.points[1]).toEqual(expect.objectContaining({ order_rate_percent: 5, order_rate_is_custom: false, status: 'blocked' }));
  });
});

describe('Commission figée au moment du retrait', () => {
  it('commande : calculée dans la même requête que le retrait', async () => {
    const { db, calls } = fakeDb((sql) => {
      if (sql.includes('SELECT id, otp_code, otp_used, otp_expires_at, pickup_point_id')) {
        return [{ id: 5, otp_code: '123456', otp_used: 0, otp_expires_at: new Date(Date.now() + 3600e3), pickup_point_id: 20, order_status: 'order-processing' }];
      }
      if (sql.includes('UPDATE orders o')) return { affectedRows: 1 };
      return [{ id: 5 }];
    });
    const svc = new OrdersService({} as any, {} as any, {} as any, db);
    await svc.verifyOtp({ order_id: 5, otp_code: '123456' } as any, { id: 20, permissions: ['super_pickuppoint'] });
    const up = calls.find((c) => c.sql.includes('UPDATE orders o'));
    expect(up.sql).toContain('commission_rate =');
    expect(up.sql).toContain('commission_amount = ROUND(');
    expect(up.sql).toContain('o.otp_used = 0');
  });

  it('kit : montant par kit enregistré au retrait', async () => {
    const { db, calls } = fakeDb((sql) =>
      sql.includes('SELECT * FROM campaign_registrations') ? [{ id: 9, pickup_center: '20', otp_used: 1, picked_up: 0 }] : {});
    await new CampaignsService(db).markPickup({ registration_id: 9 }, 20);
    const up = calls.find((c) => c.sql.includes('UPDATE campaign_registrations r'));
    expect(up.sql).toContain('r.commission_amount = (SELECT COALESCE(ov.kit_amount, s.kit_amount)');
  });
});

describe('Dashboard du point de retrait', () => {
  it('résumé : uniquement ses retraits de la période, totaux et regroupement, sans OTP', async () => {
    const { db, calls } = fakeDb((sql) => {
      if (sql.includes('FROM orders o LEFT JOIN users u') && sql.includes("'order-completed'")) {
        return [
          { id: 1, reference: 'ORD-1', customer: 'Awa', at: '2026-09-02 10:00:00', amount: '8000', commission: '400' },
          { id: 2, reference: 'ORD-2', customer: 'Bio', at: '2026-09-24 23:30:00', amount: '1000', commission: null },
        ];
      }
      if (sql.includes('FROM campaign_registrations r JOIN campaigns c') && sql.includes('picked_up = 1')) {
        return [{ id: 7, reference: 'Campagne X', customer: 'Cica', at: '2026-09-02 11:00:00', amount: null, commission: '300' }];
      }
      if (sql.includes('COUNT(*) AS n FROM orders')) return [{ n: 3 }];
      if (sql.includes('COUNT(*) AS n FROM campaign_registrations')) return [{ n: 2 }];
      return [];
    });
    const res: any = await new PickupDashboardService(db).summary(20, 'month', '2026-09');
    expect(res.totals).toEqual({ orders_withdrawn: 2, kits_withdrawn: 1, products_amount: 9000, commission_orders: 400, commission_kits: 300, commission_total: 700 });
    expect(res.pending).toEqual({ orders: 3, kits: 2 });
    expect(res.series[1]).toEqual(expect.objectContaining({ label: '2', orders: 1, kits: 1, commission: 700 }));
    expect(res.series[24]).toEqual(expect.objectContaining({ label: '25', orders: 1 })); // 23h30 UTC = 25 au Bénin
    expect(res.latest[0].reference).toBe('ORD-2');
    const ordersQ = calls.find((c) => c.sql.includes('o.delivered_at >= ?'));
    expect(ordersQ.params.slice(0, 3)).toEqual([20, '2026-08-31 23:00:00', '2026-09-30 23:00:00']);
    const kitsQ = calls.find((c) => c.sql.includes('r.picked_up_at >= ?'));
    expect(kitsQ.params[0]).toBe('20');
    expect(calls.every((c) => !/otp_code\s*(AS|,|$)/.test(c.sql) || c.sql.includes('IS NOT NULL'))).toBe(true);
  });

  it('commandes : payées, du point uniquement, recherche par numéro ou nom, jamais le code', async () => {
    const { db, calls } = fakeDb((sql) => (sql.includes('COUNT(*) AS total') ? [{ total: 1 }] : [
      { id: 1, tracking_number: 'ORD-1', customer_name: 'Awa', order_status: 'order-processing', created_at: '2026-09-01 10:00:00', delivered_at: null, otp_expires_at: '2026-09-03 10:00:00', has_otp: 1, products_amount: '8000', commission_amount: null },
    ]));
    const res: any = await new PickupDashboardService(db).orders(20, { status: 'pending', q: 'awa' });
    expect(calls[0].sql).toContain("o.payment_status = 'payment-success'");
    expect(calls[0].sql).toContain('(o.tracking_number LIKE ? OR u.name LIKE ?)');
    expect(calls[0].params.slice(0, 3)).toEqual([20, '%awa%', '%awa%']);
    expect(calls[0].sql).not.toMatch(/o\.otp_code(?! IS NOT NULL)/);
    expect(res.data[0]).toEqual(expect.objectContaining({ has_otp: true, withdrawn: false, products_amount: 8000, created_at: '2026-09-01T10:00:00Z' }));
    expect(res.data[0]).not.toHaveProperty('otp_code');
  });

  it('kits : toutes les campagnes du point (pas seulement la campagne en cours)', async () => {
    const { db, calls } = fakeDb(() => []);
    await new PickupDashboardService(db).kits(20, { status: 'all' });
    expect(calls[0].sql).toContain('WHERE r.pickup_center = ?');
    expect(calls[0].sql).not.toMatch(/en_cours|status =/);
    expect(calls[0].params).toEqual(['20']);
  });
});
