// Tournées de retrait (12/11/2026, rapports/PLAN_TOURNEES_RETRAIT.md, 1.4) : commande payée
jest.mock('./feexpay-verify', () => ({ verifyFeexPayForOrder: jest.fn().mockResolvedValue({ status: 'SUCCESSFUL' }) }));
jest.mock('../auth/mailer', () => ({ sendVerificationEmail: jest.fn().mockResolvedValue(undefined) }));
import { PaymentIntentService } from './payment-intent.service';
import { sendVerificationEmail } from '../auth/mailer';

const mailer = sendVerificationEmail as jest.Mock;

function fakeDb(order: any) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT * FROM orders WHERE tracking_number')) return [[order], []];
    if (sql.startsWith('SELECT email FROM users')) return [[{ email: 'c@t.io' }], []];
    if (sql.startsWith('SELECT name FROM users')) return [[{ name: 'Point A' }], []];
    if (sql.startsWith('INSERT')) return [{ insertId: 77 }, []];
    return [[], []];
  });
  const conn = { query, beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
  const pool = { query, getConnection: jest.fn(async () => conn) };
  return { calls, db: { getPool: () => pool } as any };
}

function run(order: any) {
  const { calls, db } = fakeDb(order);
  const svc = new PaymentIntentService(db);
  jest.spyOn(svc as any, 'updateWallets').mockResolvedValue(undefined);
  jest.spyOn(svc as any, 'updateAnalytics').mockResolvedValue(undefined);
  jest.spyOn(svc as any, 'generateInvoices').mockResolvedValue(undefined);
  return { calls, done: svc.completeFeexPayPayment({ transaction_id: 't', custom_id: 'ORD-5', feexpay_verified_reference: 't' }) };
}

const otpUpdate = (calls: { sql: string; params: any[] }[]) => calls.find((c) => c.sql.startsWith('UPDATE orders SET otp_code'))!;

beforeEach(() => mailer.mockClear());

describe('paiement d’une commande (1.4)', () => {
  it('retrait à un point : heure de la tournée, code valable à partir d’elle (D6), phrase dans l’e-mail', async () => {
    const { calls, done } = run({ id: 5, tracking_number: 'ORD-5', customer_id: 10, total: 5000, delivery_type: 'PICKUP', pickup_point_id: 20 });
    await done;
    const [, expiresAt, availableAt, id] = otpUpdate(calls).params;
    expect(availableAt).toBeInstanceOf(Date);
    expect(availableAt.getTime()).toBeGreaterThan(Date.now());
    expect([availableAt.getUTCMinutes(), availableAt.getUTCSeconds(), availableAt.getUTCMilliseconds()]).toEqual([0, 0, 0]);
    expect(expiresAt.getTime() - availableAt.getTime()).toBe(48 * 3600000);
    expect(id).toBe(5);
    expect(mailer.mock.calls[0][0].message).toMatch(/Votre commande sera disponible à votre point de retrait Point A le \S+ \d+ \S+ à \d\d h 00\./);
  });

  it('livraison à domicile : pas de tournée, code valable à partir du paiement, e-mail inchangé', async () => {
    const { calls, done } = run({ id: 5, tracking_number: 'ORD-5', customer_id: 10, total: 5000, delivery_type: 'CUSTOM', pickup_point_id: null });
    const before = Date.now();
    await done;
    const [, expiresAt, availableAt] = otpUpdate(calls).params;
    expect(availableAt).toBeNull();
    expect(Math.abs(expiresAt.getTime() - before - 48 * 3600000)).toBeLessThan(5000);
    expect(mailer.mock.calls[0][0].message).not.toMatch(/sera disponible/);
  });
});
