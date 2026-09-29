import { OrdersService } from './orders.service';
import { MASKED_OTP } from '../common/sanitize';

type Handler = (sql: string, params: any[]) => any;
function fakeDb(handler: Handler) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    return [handler(sql, params) ?? [], []];
  });
  return { calls, db: { getPool: () => ({ query }), query } as any };
}

const ROWS = [
  { id: 1, customer_id: 10, pickup_point_id: 20, otp_code: '123456', order_status: 'order-processing' },
  { id: 2, customer_id: 11, pickup_point_id: null, otp_code: null, order_status: 'order-pending' },
];
const handler: Handler = (sql) => {
  if (sql.includes('COUNT(*)')) return [{ total: 2 }];
  if (sql.startsWith('SELECT * FROM orders')) return ROWS.map((r) => ({ ...r }));
  if (sql.startsWith('SELECT id, name, email FROM users WHERE id IN')) {
    return [{ id: 20, name: 'Point A', email: 'a@pt.io' }, { id: 10, name: 'Awa', email: 'awa@t.io' }, { id: 11, name: 'Bio', email: 'bio@t.io' }];
  }
  return [];
};

describe('G2 — liste des commandes côté admin', () => {
  it('admin : nom du point de retrait et du client ajoutés, code en clair (2 requêtes groupées)', async () => {
    const { db, calls } = fakeDb(handler);
    const svc = new OrdersService({} as any, {} as any, {} as any, db);
    const res: any = await svc.getOrders({ page: 1, limit: 20 } as any, { id: 1, permissions: ['super_admin'] });
    expect(res.data[0]).toEqual(expect.objectContaining({ pickup_point_name: 'Point A', customer_display: { name: 'Awa', email: 'awa@t.io' }, otp_code: '123456' }));
    expect(res.data[1].pickup_point_name).toBeNull();
    expect(calls.filter((c) => c.sql.startsWith('SELECT id, name, email FROM users WHERE id IN'))).toHaveLength(2);
  });

  it('point de retrait : pas d’enrichissement, code masqué', async () => {
    const { db, calls } = fakeDb(handler);
    const svc = new OrdersService({} as any, {} as any, {} as any, db);
    const res: any = await svc.getOrders({ page: 1, limit: 20 } as any, { id: 20, permissions: ['super_pickuppoint'] });
    expect(calls.some((c) => c.sql.startsWith('SELECT id, name, email FROM users WHERE id IN'))).toBe(false);
    expect(res.data[0]).not.toHaveProperty('customer_display');
    expect(res.data[0].otp_code).toBe(MASKED_OTP);
  });
});
