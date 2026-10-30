jest.mock('../auth/mailer', () => ({ sendVerificationEmail: jest.fn().mockResolvedValue(undefined) }));

import { BadRequestException } from '@nestjs/common';
import { CommissionsService } from './commissions.service';
import { money, parsePayout, pointMoney } from './payouts';

// Versements aux points de retrait (B7, 30/10/2026)
function fakeDb(handler: (sql: string, params: any[]) => any) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    return [handler(sql, params) ?? [], []];
  });
  const conn = { query, beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
  const pool = { query, getConnection: jest.fn(async () => conn) };
  return { calls, conn, db: { getPool: () => pool } as any };
}

describe('Versements : règles', () => {
  const today = new Date('2026-10-30T10:00:00Z');

  it('montant positif arrondi au franc, moyen connu, date du jour par défaut', () => {
    expect(parsePayout({ pickup_point_id: '8', amount: '1500.4', method: 'mobile_money' }, today))
      .toEqual({ pointId: 8, amount: 1500, method: 'mobile_money', reference: null, note: null, paidAt: '2026-10-30' });
    expect(() => parsePayout({ pickup_point_id: 8, amount: 0, method: 'cash' }, today)).toThrow(BadRequestException);
    expect(() => parsePayout({ pickup_point_id: 8, amount: 100, method: 'cheque' }, today)).toThrow(BadRequestException);
    expect(() => parsePayout({ pickup_point_id: 'x', amount: 100, method: 'cash' }, today)).toThrow(BadRequestException);
  });

  it('date passée acceptée, future ou mal écrite refusée', () => {
    expect(parsePayout({ pickup_point_id: 8, amount: 100, method: 'bank', paid_at: '2026-10-01' }, today).paidAt).toBe('2026-10-01');
    expect(() => parsePayout({ pickup_point_id: 8, amount: 100, method: 'bank', paid_at: '2026-11-02' }, today)).toThrow(BadRequestException);
    expect(() => parsePayout({ pickup_point_id: 8, amount: 100, method: 'bank', paid_at: '30/10/2026' }, today)).toThrow(BadRequestException);
  });

  it('reste à verser = gagné - versé, jamais négatif', () => {
    expect(money('400', 600, 250)).toEqual({ earned: 1000, paid: 250, balance: 750 });
    expect(money(0, 0, 50).balance).toBe(0);
  });

  it('avant les migrations 024 et 025 : versé = 0, aucune demande, rien ne casse', async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes('FROM pickup_payouts')) throw new Error("Table 'pickup_payouts' doesn't exist");
      if (sql.includes('FROM pickup_withdrawal_requests')) throw new Error("Table 'pickup_withdrawal_requests' doesn't exist");
      return [{ earned_orders: 300, earned_kits: 200 }];
    });
    expect(await pointMoney(db.getPool(), 8)).toEqual({ earned: 500, paid: 0, balance: 500, pending: 0, available: 500, payouts: [], requests: [] });
  });
});

describe('Versements : enregistrement par l’admin', () => {
  const handler = (paid: number) => (sql: string) => {
    if (sql.includes('FOR UPDATE')) return [{ id: 8, name: 'Point A' }];
    if (sql.includes('AS earned_orders')) return [{ earned_orders: 1000, earned_kits: 500 }];
    if (sql.startsWith('SELECT id, amount')) return paid ? [{ id: 1, amount: paid, method: 'cash', paid_at: '2026-10-01' }] : [];
    return { affectedRows: 1 };
  };

  it('dans la limite du reste : noté avec l’admin, ligne du point verrouillée', async () => {
    const { db, calls, conn } = fakeDb(handler(500));
    const res = await new CommissionsService(db).addPayout({ pickup_point_id: 8, amount: 1000, method: 'mobile_money', reference: ' MM-42 ' }, 1);
    expect(res.success).toBe(true);
    const insert = calls.find((c) => c.sql.startsWith('INSERT INTO pickup_payouts'));
    expect(insert?.params.slice(0, 5)).toEqual([8, 1000, 'mobile_money', 'MM-42', null]);
    expect(insert?.params[6]).toBe(1);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('au-delà du reste : refusé, rien n’est écrit', async () => {
    const { db, calls, conn } = fakeDb(handler(500));
    await expect(new CommissionsService(db).addPayout({ pickup_point_id: 8, amount: 1001, method: 'cash' }, 1)).rejects.toBeInstanceOf(BadRequestException);
    expect(calls.some((c) => c.sql.startsWith('INSERT INTO pickup_payouts'))).toBe(false);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('point inconnu ou non validé : refusé', async () => {
    const { db } = fakeDb((sql) => (sql.includes('FOR UPDATE') ? [] : []));
    await expect(new CommissionsService(db).addPayout({ pickup_point_id: 99, amount: 10, method: 'cash' }, 1)).rejects.toBeInstanceOf(BadRequestException);
  });
});
