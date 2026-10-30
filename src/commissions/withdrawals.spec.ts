jest.mock('../auth/mailer', () => ({ sendVerificationEmail: jest.fn().mockResolvedValue(undefined) }));

import { BadRequestException } from '@nestjs/common';
import { WithdrawalsService, parseWithdrawalRequest } from './withdrawals';
import { RefundsService, parseRefund } from '../orders/refunds';

// Retraits des commissions et remboursements (B7, 30/10/2026)
function fakeDb(handler: (sql: string, params: any[]) => any) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    const out = handler(sql, params);
    if (out instanceof Error) throw out;
    return [out ?? [], []];
  });
  const conn = { query, beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
  const pool = { query, getConnection: jest.fn(async () => conn) };
  return { calls, conn, db: { getPool: () => pool } as any };
}

// Point : gagné 1 500, versé 500 (reste 1 000), 300 déjà demandés (disponible 700)
const money = (status = 'pending') => (sql: string) => {
  if (sql.includes("role = 'super_pickuppoint'") && sql.includes('FOR UPDATE')) return [{ id: 8 }];
  if (sql.includes('AS earned_orders')) return [{ earned_orders: 1000, earned_kits: 500 }];
  if (sql.startsWith('SELECT id, amount, method, reference')) return [{ id: 1, amount: 500, method: 'cash', paid_at: '2026-10-01' }];
  if (sql.includes('FROM pickup_withdrawal_requests WHERE pickup_point_id')) return [{ id: 4, amount: 300, method: 'mobile_money', account: '97000000', status: 'pending' }];
  if (sql.startsWith('SELECT id, pickup_point_id, amount, method, status')) return [{ id: 4, pickup_point_id: 8, amount: 300, method: 'mobile_money', status }];
  if (sql.startsWith('SELECT status FROM pickup_withdrawal_requests')) return [{ status }];
  if (sql.startsWith('INSERT INTO pickup_payouts')) return { insertId: 77 };
  return { affectedRows: 1 };
};

describe('Retraits : demande du point de retrait', () => {
  it('règles : montant positif, moyen connu, numéro obligatoire sauf espèces', () => {
    expect(parseWithdrawalRequest({ amount: '250.6', method: 'mobile_money', account: ' 97 00 00 00 ' }))
      .toEqual({ amount: 251, method: 'mobile_money', account: '97 00 00 00', note: null });
    expect(parseWithdrawalRequest({ amount: 100, method: 'cash' }).account).toBe('');
    expect(() => parseWithdrawalRequest({ amount: 100, method: 'mobile_money' })).toThrow(BadRequestException);
    expect(() => parseWithdrawalRequest({ amount: 0, method: 'cash' })).toThrow(BadRequestException);
    expect(() => parseWithdrawalRequest({ amount: 10, method: 'crypto', account: 'x' })).toThrow(BadRequestException);
  });

  it('au plus le disponible (reste à verser - demandes en attente), ligne du point verrouillée', async () => {
    const { db, calls, conn } = fakeDb(money());
    const svc = new WithdrawalsService(db);
    await expect(svc.request(8, { amount: 701, method: 'mobile_money', account: '97000000' })).rejects.toBeInstanceOf(BadRequestException);
    expect(calls.some((c) => c.sql.startsWith('INSERT INTO pickup_withdrawal_requests'))).toBe(false);
    expect(conn.rollback).toHaveBeenCalled();

    const res = await svc.request(8, { amount: 700, method: 'mobile_money', account: '97000000' });
    expect(res.success).toBe(true);
    expect(calls.find((c) => c.sql.startsWith('INSERT INTO pickup_withdrawal_requests'))?.params).toEqual([8, 700, 'mobile_money', '97000000', null]);
    expect(res).toMatchObject({ balance: 1000, pending: 300, available: 700 });
  });

  it('annulation : seulement sa propre demande, encore en attente', async () => {
    const { db, calls } = fakeDb((sql) => (sql.startsWith('UPDATE pickup_withdrawal_requests') ? { affectedRows: 0 } : money()(sql)));
    await expect(new WithdrawalsService(db).cancel(8, 4)).rejects.toBeInstanceOf(BadRequestException);
    const upd = calls.find((c) => c.sql.startsWith('UPDATE pickup_withdrawal_requests'));
    expect(upd?.sql).toContain("pickup_point_id = ? AND status = 'pending'");
    expect(upd?.params).toEqual([4, 8]);
  });
});

describe('Retraits : traitement par l’admin', () => {
  it('payer : versement noté avec la référence, demande « payée » et liée au versement', async () => {
    const { db, calls, conn } = fakeDb(money());
    const res = await new WithdrawalsService(db).pay(4, { reference: 'MM-555' }, 1);
    expect(res.success).toBe(true);
    const payout = calls.find((c) => c.sql.startsWith('INSERT INTO pickup_payouts'));
    expect(payout?.params.slice(0, 4)).toEqual([8, 300, 'mobile_money', 'MM-555']);
    const done = calls.find((c) => c.sql.startsWith("UPDATE pickup_withdrawal_requests SET status = 'paid'"));
    expect(done?.params[0]).toBe(77);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('demande déjà traitée : ni versement ni changement', async () => {
    const { db, calls } = fakeDb(money('paid'));
    await expect(new WithdrawalsService(db).pay(4, {}, 1)).rejects.toBeInstanceOf(BadRequestException);
    await expect(new WithdrawalsService(db).reject(4, { admin_note: 'x' }, 1)).rejects.toBeInstanceOf(BadRequestException);
    expect(calls.some((c) => c.sql.startsWith('INSERT INTO pickup_payouts'))).toBe(false);
  });

  it('refus : motif obligatoire', async () => {
    const { db } = fakeDb(money());
    await expect(new WithdrawalsService(db).reject(4, {}, 1)).rejects.toBeInstanceOf(BadRequestException);
    await expect(new WithdrawalsService(db).reject(4, { admin_note: 'Numéro incorrect' }, 1)).resolves.toMatchObject({ success: true });
  });
});

describe('Remboursement d’une commande', () => {
  const order = (o: any) => (sql: string) => {
    if (sql.startsWith('SELECT id, tracking_number')) return [o];
    if (sql.startsWith('SELECT id, amount, method, reference, reason')) return [{ id: 1, amount: 5000, method: 'mobile_money', reason: 'Rupture', refunded_at: '2026-10-30' }];
    return { affectedRows: 1, insertId: 1 };
  };
  const paid = { id: 5, tracking_number: 'TRK5', total: 5000, paid_total: 5000, order_status: 'order-processing', payment_status: 'payment-success', otp_used: 0 };

  it('règles : montant, moyen, motif obligatoire, pas de date future', () => {
    const today = new Date('2026-10-30T10:00:00Z');
    expect(parseRefund({ amount: 5000, method: 'mobile_money', reason: ' Rupture de stock ' }, today))
      .toEqual({ amount: 5000, method: 'mobile_money', reference: null, reason: 'Rupture de stock', refundedAt: '2026-10-30' });
    expect(() => parseRefund({ amount: 5000, method: 'mobile_money' }, today)).toThrow(BadRequestException);
    expect(() => parseRefund({ amount: 5000, method: 'mobile_money', reason: 'x', refunded_at: '2026-11-01' }, today)).toThrow(BadRequestException);
  });

  it('commande payée, non retirée : remboursement noté, commande « remboursée », code de retrait annulé', async () => {
    const { db, calls, conn } = fakeDb(order(paid));
    const res = await new RefundsService(db).refund(5, { amount: 5000, method: 'mobile_money', reason: 'Rupture', reference: 'MM-1' }, 1);
    expect(res.success).toBe(true);
    expect(calls.find((c) => c.sql.startsWith('INSERT INTO order_refunds'))?.params.slice(0, 5)).toEqual([5, 5000, 'mobile_money', 'MM-1', 'Rupture']);
    const upd = calls.find((c) => c.sql.startsWith('UPDATE orders SET'));
    expect(upd?.sql).toContain("order_status = 'order-refunded', otp_code = NULL");
    expect(conn.commit).toHaveBeenCalled();
  });

  it('refusé : non payée, déjà retirée, déjà remboursée, montant au-delà du payé', async () => {
    for (const o of [
      { ...paid, payment_status: 'payment-pending' },
      { ...paid, otp_used: 1 },
      { ...paid, order_status: 'order-completed' },
      { ...paid, order_status: 'order-refunded' },
    ]) {
      const { db, calls } = fakeDb(order(o));
      await expect(new RefundsService(db).refund(5, { amount: 100, method: 'cash', reason: 'x' }, 1)).rejects.toBeInstanceOf(BadRequestException);
      expect(calls.some((c) => c.sql.startsWith('INSERT INTO order_refunds'))).toBe(false);
    }
    const { db } = fakeDb(order(paid));
    await expect(new RefundsService(db).refund(5, { amount: 5001, method: 'cash', reason: 'x' }, 1)).rejects.toBeInstanceOf(BadRequestException);
  });
});
