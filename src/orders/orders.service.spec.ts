import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PaymentIntentService } from '../payment-intent/payment-intent.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { MASKED_OTP } from '../common/sanitize';

type Handler = (sql: string, params: any[]) => any;

// Pool simulé : enregistre les requêtes et délègue la réponse à `handler`
function fakeDb(handler: Handler) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    return [handler(sql, params) ?? [], []];
  });
  const conn = {
    query,
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
  const pool = { query, getConnection: jest.fn(async () => conn) };
  return { calls, db: { getPool: () => pool, query } as any };
}

const admin = { id: 1, permissions: ['super_admin'] };
const customer = { id: 10, permissions: ['customer'] };
const pickup = { id: 20, permissions: ['super_pickuppoint'] };
const owner = { id: 30, permissions: ['store_owner'] };

const ORDER_ROW = { id: 5, customer_id: 10, pickup_point_id: 20, otp_code: '123456', otp_used: 0, order_status: 'order-processing' };

function makeOrders(handler: Handler) {
  const { calls, db } = fakeDb(handler);
  const authService = { me: jest.fn().mockResolvedValue({ id: 10, email: 'c@t.io' }) };
  const svc = new OrdersService(authService as any, {} as any, {} as any, db);
  return { svc, calls };
}

describe('OrdersService.getOrders — périmètre par rôle', () => {
  const listHandler: Handler = (sql) => {
    if (sql.includes('COUNT(*)')) return [{ total: 1 }];
    if (sql.includes('FROM shops WHERE owner_id')) return [{ id: 7 }];
    if (sql.startsWith('SELECT * FROM orders')) return [{ ...ORDER_ROW }];
    return [];
  };
  const mainQuery = (calls: any[]) => calls.find((c) => c.sql.startsWith('SELECT * FROM orders'));

  it('client : impose customer_id = son id, OTP visible', async () => {
    const { svc, calls } = makeOrders(listHandler);
    const res: any = await svc.getOrders({} as any, customer);
    const q = mainQuery(calls);
    expect(q.sql).toContain('customer_id = ?');
    expect(q.params[0]).toBe(10);
    expect(res.data[0].otp_code).toBe('123456');
  });

  it("client : refuse le customer_id d'un autre", async () => {
    const { svc } = makeOrders(listHandler);
    await expect(svc.getOrders({ customer_id: 11 } as any, customer)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('point de retrait : imposé à son id, OTP masqué, recherche OTP exacte', async () => {
    const { svc, calls } = makeOrders(listHandler);
    const res: any = await svc.getOrders({ search: '12' } as any, pickup);
    const q = mainQuery(calls);
    expect(q.sql).toContain('pickup_point_id = ?');
    expect(q.params).toContain(20);
    expect(q.sql).toContain('otp_code = ?');
    expect(q.sql).not.toContain('otp_code LIKE');
    expect(res.data[0].otp_code).toBe(MASKED_OTP);
  });

  it("point de retrait : refuse le pickup_point_id d'un autre", async () => {
    const { svc } = makeOrders(listHandler);
    await expect(svc.getOrders({ pickup_point_id: 21 } as any, pickup)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('store_owner : limité aux commandes de ses boutiques', async () => {
    const { svc, calls } = makeOrders(listHandler);
    const res: any = await svc.getOrders({} as any, owner);
    const q = mainQuery(calls);
    expect(q.sql).toContain('SELECT order_id FROM order_children WHERE shop_id IN (?)');
    expect(q.params).toContain(7);
    expect(res.data[0].otp_code).toBe(MASKED_OTP);
  });

  it('store_owner sans boutique : liste vide sans requête sur orders', async () => {
    const { svc, calls } = makeOrders(() => []);
    const res: any = await svc.getOrders({} as any, owner);
    expect(res.data).toEqual([]);
    expect(mainQuery(calls)).toBeUndefined();
  });

  it('admin : pas de filtre imposé, sortedBy nettoyé, OTP visible', async () => {
    const { svc, calls } = makeOrders(listHandler);
    const res: any = await svc.getOrders({ sortedBy: 'DESC; DROP TABLE orders' } as any, admin);
    const q = mainQuery(calls);
    expect(q.sql).not.toContain('customer_id = ?');
    expect(q.sql).not.toContain('DROP');
    expect(q.sql).toContain('ORDER BY created_at DESC');
    expect(res.data[0].otp_code).toBe('123456');
  });
});

describe('OrdersService.getOrderForUser — IDOR', () => {
  const handler: Handler = (sql) => {
    if (sql.includes('FROM orders WHERE id = ? OR tracking_number')) return [{ ...ORDER_ROW }];
    return [];
  };

  it('propriétaire : OTP visible', async () => {
    const { svc } = makeOrders(handler);
    expect((await svc.getOrderForUser(5, customer) as any).otp_code).toBe('123456');
  });
  it('point de retrait assigné : OTP masqué', async () => {
    const { svc } = makeOrders(handler);
    expect((await svc.getOrderForUser(5, pickup) as any).otp_code).toBe(MASKED_OTP);
  });
  it('autre client : 403', async () => {
    const { svc } = makeOrders(handler);
    await expect(svc.getOrderForUser(5, { id: 11, permissions: ['customer'] })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('commande inconnue : 404', async () => {
    const { svc } = makeOrders(() => []);
    await expect(svc.getOrderForUser(999, admin)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OrdersService.updateForUser — liste blanche (S7)', () => {
  const handler = (overrides: any = {}): Handler => (sql) => {
    if (sql.includes('SELECT id, customer_id, pickup_point_id')) return [{ ...ORDER_ROW, ...overrides }];
    if (sql.includes("role = 'super_pickuppoint'")) return [{ id: 21 }];
    if (sql.startsWith('SELECT * FROM orders WHERE id')) return [{ ...ORDER_ROW }];
    return [];
  };
  const updateSql = (calls: any[]) => calls.find((c) => c.sql.startsWith('UPDATE orders SET'));

  it('client : seuls pickup_point_id et note sont écrits', async () => {
    const { svc, calls } = makeOrders(handler());
    await svc.updateForUser(5, { pickup_point_id: 21, note: 'x', order_status: 'order-completed', total: 0 }, customer);
    const u = updateSql(calls);
    expect(u.sql).toContain('pickup_point_id = ?');
    expect(u.sql).toContain('note = ?');
    expect(u.sql).not.toContain('order_status');
    expect(u.sql).not.toContain('total');
  });

  it("client : clé d'injection ignorée → rien à écrire → 400", async () => {
    const { svc, calls } = makeOrders(handler());
    await expect(
      svc.updateForUser(5, { 'otp_used = 1, order_status': 'x' } as any, customer),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateSql(calls)).toBeUndefined();
  });

  it('client : point de retrait inexistant → 400', async () => {
    const { svc } = makeOrders((sql) => (sql.includes('SELECT id, customer_id') ? [{ ...ORDER_ROW }] : []));
    await expect(svc.updateForUser(5, { pickup_point_id: 99 }, customer)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('client : commande déjà retirée → 400', async () => {
    const { svc } = makeOrders(handler({ otp_used: 1 }));
    await expect(svc.updateForUser(5, { pickup_point_id: 21 }, customer)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('autre client : 403', async () => {
    const { svc } = makeOrders(handler());
    await expect(svc.updateForUser(5, { note: 'x' }, { id: 11, permissions: ['customer'] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('point de retrait : aucun champ modifiable → 400', async () => {
    const { svc } = makeOrders(handler());
    await expect(svc.updateForUser(5, { order_status: 'order-completed' }, pickup)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('admin : peut changer le statut (valeur ENUM)', async () => {
    const { svc, calls } = makeOrders(handler());
    await svc.updateForUser(5, { order_status: 'order-cancelled', id: 1 }, admin);
    expect(updateSql(calls).sql).toContain('order_status = ?');
    expect(updateSql(calls).sql).not.toMatch(/\bid = \?,/);
  });
});

describe('OrdersService.verifyOtp (S13)', () => {
  const handler = (row: any): Handler => (sql) => {
    if (sql.includes('SELECT id, otp_code, otp_used')) return row ? [row] : [];
    if (sql.includes('UPDATE orders') && sql.includes('otp_used = 1')) return { affectedRows: 1 };
    if (sql.startsWith('SELECT * FROM orders')) return [{ ...ORDER_ROW, otp_used: 1 }];
    return {};
  };

  it('bon code, bon point : commande terminée, OTP masqué dans la réponse', async () => {
    const { svc, calls } = makeOrders(handler({ ...ORDER_ROW }));
    const res: any = await svc.verifyOtp({ order_id: 5, otp_code: '123456' }, pickup);
    expect(res.success).toBe(true);
    expect(res.order.otp_code).toBe(MASKED_OTP);
    // Pas de double validation concurrente (otp_used = 0 dans le WHERE) ; commission figée dans la même requête
    expect(calls.some((c) => c.sql.includes('WHERE o.id = ? AND o.otp_used = 0') && c.sql.includes('commission_amount = ROUND('))).toBe(true);
  });

  it('mauvais code : tentative comptée, 404', async () => {
    const { svc, calls } = makeOrders(handler({ ...ORDER_ROW }));
    await expect(svc.verifyOtp({ order_id: 5, otp_code: '000000' }, pickup)).rejects.toBeInstanceOf(NotFoundException);
    expect(calls.some((c) => c.sql.includes('otp_attempts = otp_attempts + 1 WHERE id = ?'))).toBe(true);
  });

  it('autre point de retrait : 404 sans révéler la commande', async () => {
    const { svc } = makeOrders(handler({ ...ORDER_ROW }));
    await expect(svc.verifyOtp({ order_id: 5, otp_code: '123456' }, { id: 21, permissions: ['super_pickuppoint'] }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('OTP déjà utilisé : 400', async () => {
    const { svc } = makeOrders(handler({ ...ORDER_ROW, otp_used: 1 }));
    await expect(svc.verifyOtp({ order_id: 5, otp_code: '123456' }, pickup)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rôle client : 403', async () => {
    const { svc } = makeOrders(handler({ ...ORDER_ROW }));
    await expect(svc.verifyOtp({ order_id: 5, otp_code: '123456' }, customer as any)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('OrdersService.create — prix serveur (S10)', () => {
  const handler: Handler = (sql) => {
    if (sql.includes('SELECT id, price, sale_price FROM products')) {
      return [{ id: 3, price: '10000.00', sale_price: '8000.00' }, { id: 4, price: '5000.00', sale_price: null }];
    }
    if (sql.startsWith('INSERT INTO orders')) return { insertId: 77 };
    if (sql.includes('SELECT shop_id, image FROM products')) return [{ shop_id: 7, image: null }];
    return {};
  };

  it('ignore les prix du client et recalcule le total', async () => {
    const { svc, calls } = makeOrders(handler);
    const order: any = await svc.create({
      products: [
        { product_id: 3, order_quantity: 2, unit_price: 1, subtotal: 2 },
        { product_id: 4, order_quantity: 1, unit_price: 1, subtotal: 1 },
      ],
      total: 3,
      payment_gateway: 'FEEXPAY',
    } as any, 'Bearer x', customer);
    expect(order.total).toBe(2 * 8000 + 5000);
    const insert = calls.find((c) => c.sql.startsWith('INSERT INTO orders'));
    expect(insert.params[3]).toBe(21000);
    const children = calls.filter((c) => c.sql.includes('INSERT INTO order_children'));
    expect(children[0].params.slice(1, 5)).toEqual([3, 2, 8000, 16000]);
  });

  it('refuse CASH / FULL_WALLET_PAYMENT pour un client', async () => {
    const { svc } = makeOrders(handler);
    await expect(svc.create({ products: [{ product_id: 3, order_quantity: 1 }], payment_gateway: 'FULL_WALLET_PAYMENT' } as any, 'Bearer x', customer))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create({ products: [{ product_id: 3, order_quantity: 1 }], payment_gateway: 'CASH' } as any, 'Bearer x', customer))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuse une quantité invalide ou un produit inconnu', async () => {
    const { svc } = makeOrders(handler);
    await expect(svc.create({ products: [{ product_id: 3, order_quantity: 0 }] } as any, 'Bearer x', customer))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create({ products: [{ product_id: 999, order_quantity: 1 }] } as any, 'Bearer x', customer))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PaymentIntentService.completeFeexPayForUser (S4)', () => {
  const make = (order: any) => {
    const { db } = fakeDb((sql) => (sql.includes('SELECT id, customer_id, payment_status FROM orders') ? (order ? [order] : []) : []));
    const svc = new PaymentIntentService(db);
    const inner = jest.spyOn(svc, 'completeFeexPayPayment').mockResolvedValue({ success: true, processed: true, otp: '123456', orderId: 5 } as any);
    return { svc, inner };
  };
  const body = { transaction_id: 't', custom_id: 'ORD-5' };

  it("propriétaire : traité, l'OTP n'est pas renvoyé", async () => {
    const { svc } = make({ id: 5, customer_id: 10, payment_status: 'payment-pending' });
    const res: any = await svc.completeFeexPayForUser(body, customer);
    expect(res.processed).toBe(true);
    expect(res).not.toHaveProperty('otp');
  });
  it('autre utilisateur : 403, rien traité', async () => {
    const { svc, inner } = make({ id: 5, customer_id: 10, payment_status: 'payment-pending' });
    await expect(svc.completeFeexPayForUser(body, { id: 11, permissions: ['customer'] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(inner).not.toHaveBeenCalled();
  });
  it('déjà payée : aucun nouvel OTP', async () => {
    const { svc, inner } = make({ id: 5, customer_id: 10, payment_status: 'payment-success' });
    const res: any = await svc.completeFeexPayForUser(body, customer);
    expect(res.alreadyProcessed).toBe(true);
    expect(inner).not.toHaveBeenCalled();
  });
  it('commande inconnue : 404', async () => {
    const { svc } = make(null);
    await expect(svc.completeFeexPayForUser(body, customer)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CampaignsService — retrait réservé au point choisi (S12)', () => {
  const reg = { id: 1, pickup_center: '20', otp_code: '654321', otp_used: 0, otp_attempts: 0, picked_up: 0, otp_expires_at: new Date(Date.now() + 3600e3) };
  const make = (row: any) => {
    const { db, calls } = fakeDb((sql) => (sql.includes('FROM campaign_registrations WHERE id') ? [row] : sql.includes('WHERE pickup_center') ? [row] : {}));
    return { svc: new CampaignsService(db), calls };
  };

  it('autre point de retrait : 404 sur verify et mark-pickup', async () => {
    const { svc } = make({ ...reg });
    await expect(svc.verifyCampaignOtp({ registration_id: 1, otp: '654321' }, 21)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.markPickup({ registration_id: 1 }, 21)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('bon point de retrait : OTP validé', async () => {
    const { svc } = make({ ...reg });
    await expect(svc.verifyCampaignOtp({ registration_id: 1, otp: '654321' }, 20)).resolves.toEqual({ message: 'OTP validé avec succès.' });
  });
  it('liste du point de retrait : OTP masqué', async () => {
    const { svc } = make({ ...reg });
    const rows: any = await svc.getRegistrationsByPickupCenter(20);
    expect(rows[0].otp_code).toBe(MASKED_OTP);
  });
});
