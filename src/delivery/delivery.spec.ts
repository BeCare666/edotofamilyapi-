import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { DeliveryService } from './delivery.service';
import { OrdersService } from '../orders/orders.service';
import {
  computeFee,
  generateCourierCredentials,
  parseCustomDelivery,
  pinMatches,
  sha256,
  whatsappUrl,
} from './delivery-rules';

jest.mock('axios');
const mockedGet = axios.get as jest.Mock;

type Handler = (sql: string, params: any[]) => any;

function fakeDb(handler: Handler) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    return [handler(sql, params) ?? [], []];
  });
  const conn = { query, beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
  const pool = { query, getConnection: jest.fn(async () => conn) };
  return { calls, db: { getPool: () => pool, query } as any };
}

const SETTINGS = { price_per_km: '150.00', center_lat: '6.36000000', center_lng: '2.42000000' };
const DEVICE = 'a'.repeat(40);
const OTHER_DEVICE = 'b'.repeat(40);

function osrmOk(meters: number) {
  mockedGet.mockResolvedValue({ data: { code: 'Ok', routes: [{ distance: meters }] } });
}

beforeEach(() => mockedGet.mockReset());

describe('Règles de la livraison personnalisée', () => {
  it('prix = km × prix au km, arrondi au franc ; distance à 2 décimales', () => {
    expect(computeFee(4321, 150)).toEqual({ distance_km: 4.32, fee: 648 });
  });

  it('description : obligatoire et limitée à 150 caractères', () => {
    const base = { lat: 6.37, lng: 2.39, phone: '+229 01 97 00 00 00' };
    expect(() => parseCustomDelivery({ ...base, description: '   ' })).toThrow(BadRequestException);
    expect(() => parseCustomDelivery({ ...base, description: 'x'.repeat(151) })).toThrow(BadRequestException);
    expect(parseCustomDelivery({ ...base, description: 'x'.repeat(150) }).description).toHaveLength(150);
  });

  it('position et téléphone obligatoires', () => {
    expect(() => parseCustomDelivery({ description: 'Portail bleu', phone: '+22901970000' })).toThrow(BadRequestException);
    expect(() => parseCustomDelivery({ lat: 6.3, lng: 2.3, description: 'Portail bleu' })).toThrow(BadRequestException);
    expect(() => parseCustomDelivery({ lat: 6.3, lng: 2.3, description: 'Portail bleu', phone: '12' })).toThrow(BadRequestException);
    expect(parseCustomDelivery({ lat: '6.3', lng: '2.3', description: ' Portail ', phone: '+229 01-97 00.00.00' }))
      .toEqual({ lat: 6.3, lng: 2.3, description: 'Portail', phone: '+2290197000000' });
  });

  it('PIN lié au lien ; seules les empreintes sont stockables', () => {
    const c = generateCourierCredentials();
    expect(c.pin).toMatch(/^\d{6}$/);
    expect(c.tokenHash).toBe(sha256(c.token));
    expect(pinMatches(c.token, c.pin, c.pinHash)).toBe(true);
    expect(pinMatches('autre-lien', c.pin, c.pinHash)).toBe(false);
    expect(pinMatches(c.token, '000000', c.pinHash)).toBe(c.pin === '000000');
  });

  it('lien WhatsApp : numéro sans « + »', () => {
    expect(whatsappUrl('+22901970000', 'a b')).toBe('https://wa.me/22901970000?text=a%20b');
  });
});

describe('DeliveryService.quote', () => {
  it('calcule le prix depuis le centre de traitement (lng,lat pour OSRM)', async () => {
    const { db } = fakeDb((sql) => (sql.includes('FROM delivery_settings') ? [SETTINGS] : []));
    osrmOk(10000);
    const q = await new DeliveryService(db).quote('6.40', '2.45');
    expect(q).toEqual({ distance_km: 10, price_per_km: 150, fee: 1500 });
    expect(mockedGet.mock.calls[0][0]).toContain('/2.42,6.36;2.45,6.4');
  });

  it('réglages absents : livraison indisponible, aucun appel OSRM', async () => {
    const { db } = fakeDb((sql) => (sql.includes('FROM delivery_settings') ? [{ price_per_km: null, center_lat: null, center_lng: null }] : []));
    await expect(new DeliveryService(db).quote(6.4, 2.45)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("itinéraire impossible : erreur claire, pas de prix inventé", async () => {
    const { db } = fakeDb((sql) => (sql.includes('FROM delivery_settings') ? [SETTINGS] : []));
    mockedGet.mockRejectedValue(new Error('timeout'));
    await expect(new DeliveryService(db).quote(6.4, 2.45)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('réglages admin validés', async () => {
    const { db } = fakeDb(() => []);
    const svc = new DeliveryService(db);
    await expect(svc.updateSettings({ price_per_km: 0, center_lat: 6, center_lng: 2 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateSettings({ price_per_km: 100, center_lat: 95, center_lng: 2 })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Commande : lieu choisi avant le paiement', () => {
  function makeOrders(extra: Handler = () => undefined) {
    const handler: Handler = (sql, params) => {
      const r = extra(sql, params);
      if (r !== undefined) return r;
      if (sql.includes('FROM products WHERE id IN')) return [{ id: 1, price: 5000, sale_price: 4000 }];
      if (sql.startsWith('INSERT INTO orders')) return { insertId: 77 };
      if (sql.includes('FROM delivery_settings')) return [SETTINGS];
      if (sql.includes('SELECT shop_id, image FROM products')) return [{ shop_id: 3, image: null }];
      return [];
    };
    const { calls, db } = fakeDb(handler);
    const authService = { me: jest.fn().mockResolvedValue({ id: 10, email: 'c@t.io' }) };
    const svc = new OrdersService(authService as any, {} as any, {} as any, db, new DeliveryService(db));
    return { svc, calls };
  }
  const products = [{ product_id: 1, order_quantity: 2, unit_price: 1, subtotal: 1 }];

  it('livraison perso : frais recalculés serveur et ajoutés au total payé', async () => {
    osrmOk(4000);
    const { svc, calls } = makeOrders();
    const order: any = await svc.create({
      products, payment_gateway: 'FEEXPAY', delivery_fee: 1,
      delivery: { type: 'CUSTOM', lat: 6.4, lng: 2.45, description: 'Portail bleu', phone: '+22901970000' },
    } as any, 'tok', { id: 10, permissions: ['customer'] });
    expect(order.total).toBe(8000 + 600);
    expect(order.paid_total).toBe(8600);
    expect(order.amount).toBe(8000);
    expect(order.delivery_fee).toBe(600);
    const ins = calls.find((c) => c.sql.startsWith('INSERT INTO orders'));
    expect(ins.params).toContain(8600);
    const cd = calls.find((c) => c.sql.includes('INSERT INTO custom_deliveries'));
    expect(cd.params).toEqual([77, 'Portail bleu', '+22901970000', 6.4, 2.45, 4, 150, 600]);
    expect(calls.some((c) => c.sql.includes("delivery_type = 'CUSTOM'"))).toBe(true);
  });

  it('livraison perso invalide : aucune commande créée', async () => {
    const { svc, calls } = makeOrders();
    await expect(svc.create({
      products, delivery: { type: 'CUSTOM', lat: 6.4, lng: 2.45, description: 'x'.repeat(151), phone: '+22901970000' },
    } as any, 'tok', { id: 10, permissions: ['customer'] })).rejects.toBeInstanceOf(BadRequestException);
    expect(calls.some((c) => c.sql.startsWith('INSERT INTO orders'))).toBe(false);
  });

  it('point de retrait choisi avant paiement : enregistré, total = produits seuls', async () => {
    const { svc, calls } = makeOrders((sql) =>
      sql.includes("role = 'super_pickuppoint'") ? [{ id: 20, is_active: 1, pickup_approved: 1 }] : undefined);
    const order: any = await svc.create({ products, delivery: { type: 'PICKUP', pickup_point_id: 20 } } as any, 'tok', { id: 10, permissions: ['customer'] });
    expect(order.total).toBe(8000);
    const up = calls.find((c) => c.sql.includes("delivery_type = 'PICKUP'"));
    expect(up.params).toEqual([8000, 20, 77]);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('point de retrait bloqué ou non validé : refusé', async () => {
    const { svc } = makeOrders((sql) =>
      sql.includes("role = 'super_pickuppoint'") ? [{ id: 20, is_active: 0, pickup_approved: 1 }] : undefined);
    await expect(svc.create({ products, delivery: { type: 'PICKUP', pickup_point_id: 20 } } as any, 'tok', { id: 10, permissions: ['customer'] }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('point de retrait : ne voit que les commandes payées (le point est choisi avant paiement)', async () => {
    const { svc, calls } = makeOrders((sql) => (sql.includes('COUNT(*)') ? [{ total: 0 }] : undefined));
    const pickupUser = { id: 20, permissions: ['super_pickuppoint'] };
    await svc.getOrders({} as any, pickupUser);
    await svc.getNewOrders(pickupUser);
    await svc.getPickupStats(20);
    const reads = calls.filter((c) => /FROM orders/.test(c.sql) && c.sql.includes('pickup_point_id = ?'));
    expect(reads.length).toBeGreaterThanOrEqual(3);
    for (const c of reads) expect(c.sql).toContain("payment_status = 'payment-success'");
  });

  it('client : lieu d’une livraison perso non modifiable ; plus de « point personnalisé » après paiement', async () => {
    const custom = makeOrders((sql) =>
      sql.includes('SELECT id, customer_id, pickup_point_id') ? [{ id: 5, customer_id: 10, pickup_point_id: null, order_status: 'order-processing', otp_used: 0, delivery_type: 'CUSTOM' }] : undefined);
    await expect(custom.svc.updateForUser(5, { pickup_point_id: 20 }, { id: 10, permissions: ['customer'] })).rejects.toBeInstanceOf(BadRequestException);

    const pickup = makeOrders((sql) =>
      sql.includes('SELECT id, customer_id, pickup_point_id') ? [{ id: 5, customer_id: 10, pickup_point_id: null, order_status: 'order-processing', otp_used: 0, delivery_type: 'PICKUP' }] : undefined);
    await expect(pickup.svc.updateForUser(5, { pickup_point_id: null, note: 'chez moi' }, { id: 10, permissions: ['customer'] })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Lien du zem', () => {
  const { token, pinHash, tokenHash } = generateCourierCredentials();
  const pin = (() => { for (let i = 100000; i < 1000000; i++) if (pinMatches(token, String(i), pinHash)) return String(i); return ''; })();

  function makeCourier(state: Partial<Record<string, any>> = {}) {
    const row: any = {
      id: 9, order_id: 5, link_token_hash: tokenHash, pin_hash: pinHash, device_hash: sha256(DEVICE),
      failed_attempts: 0, link_blocked: 0, delivered_at: null, description: 'Portail bleu', phone: '+22901970000',
      lat: '6.4', lng: '2.45', courier_name: 'Koffi', tracking_number: 'ORD-5', otp_code: '123456', otp_used: 0,
      otp_expires_at: new Date(Date.now() + 3600_000), order_status: 'order-processing', payment_status: 'payment-success',
      ...state,
    };
    const { calls, db } = fakeDb((sql, params) => {
      if (sql.includes('WHERE cd.link_token_hash = ?')) return params[0] === row.link_token_hash ? [{ ...row }] : [];
      if (sql.startsWith('UPDATE custom_deliveries SET failed_attempts = failed_attempts + 1')) { row.failed_attempts++; return {}; }
      if (sql.includes('SET link_blocked = 1')) { if (row.failed_attempts >= 5) row.link_blocked = 1; return {}; }
      if (sql.startsWith('SELECT failed_attempts')) return [{ failed_attempts: row.failed_attempts }];
      if (sql.includes('SET device_hash = ?')) { if (!row.device_hash) row.device_hash = params[0]; return {}; }
      if (sql.startsWith('SELECT device_hash')) return [{ device_hash: row.device_hash }];
      if (sql.includes('UPDATE orders SET order_status')) return { affectedRows: row.otp_used ? 0 : 1 };
      return {};
    });
    return { svc: new DeliveryService(db), calls, row };
  }

  it('première ouverture : verrouillé sur ce téléphone, refusé ailleurs', async () => {
    const { svc, row } = makeCourier({ device_hash: null });
    await svc.courierOpen(token, DEVICE);
    expect(row.device_hash).toBe(sha256(DEVICE));
    await expect(svc.courierOpen(token, OTHER_DEVICE)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lien inconnu, désactivé ou déjà livré : invalide', async () => {
    await expect(makeCourier().svc.courierOpen('x'.repeat(43), DEVICE)).rejects.toBeInstanceOf(NotFoundException);
    await expect(makeCourier({ delivered_at: new Date() }).svc.courierOpen(token, DEVICE)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('PIN correct : infos de livraison ; PIN faux : essai décompté', async () => {
    const { svc, row } = makeCourier();
    const info = await svc.courierUnlock(token, { device_id: DEVICE, pin });
    expect(info).toEqual(expect.objectContaining({ description: 'Portail bleu', phone: '+22901970000', lat: 6.4 }));
    expect(info).not.toHaveProperty('otp_code');
    await expect(svc.courierUnlock(token, { device_id: DEVICE, pin: pin === '111111' ? '222222' : '111111' })).rejects.toThrow('Il reste 4 essais');
    expect(row.failed_attempts).toBe(1);
  });

  it('bon code client : commande retirée, lien expiré', async () => {
    const { svc, calls } = makeCourier();
    const res = await svc.courierDeliver(token, { device_id: DEVICE, pin, otp: ' 123456 ' });
    expect(res.success).toBe(true);
    expect(calls.some((c) => c.sql.includes("order_status = 'order-completed', otp_used = 1") && c.sql.includes('otp_used = 0'))).toBe(true);
    expect(calls.some((c) => c.sql.includes('link_token_hash = NULL') && c.sql.includes('delivered_at = NOW()'))).toBe(true);
  });

  it('5 codes faux (PIN ou OTP) : lien bloqué, même avec le bon code ensuite', async () => {
    const { svc, row } = makeCourier();
    for (let i = 0; i < 5; i++) {
      await expect(svc.courierDeliver(token, { device_id: DEVICE, pin, otp: '000000' })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(row.link_blocked).toBe(1);
    await expect(svc.courierDeliver(token, { device_id: DEVICE, pin, otp: '123456' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('autre téléphone : refusé même avec PIN et code corrects', async () => {
    const { svc, calls } = makeCourier();
    await expect(svc.courierDeliver(token, { device_id: OTHER_DEVICE, pin, otp: '123456' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(calls.some((c) => c.sql.includes('UPDATE orders'))).toBe(false);
  });

  it('code client expiré : refus sans compter un essai', async () => {
    const { svc, row } = makeCourier({ otp_expires_at: new Date(Date.now() - 1000) });
    await expect(svc.courierDeliver(token, { device_id: DEVICE, pin, otp: '123456' })).rejects.toThrow('expiré');
    expect(row.failed_attempts).toBe(0);
  });
});

describe('Admin : confier à un zem', () => {
  const ROW = { id: 9, delivered_at: null, assigned_at: null, tracking_number: 'ORD-5', payment_status: 'payment-success', order_status: 'order-processing', otp_used: 0 };

  it('renvoie lien + PIN une seule fois ; stocke seulement les empreintes', async () => {
    process.env.FRONTEND_CALLBACK_URL = 'https://edoto.test/';
    const { db, calls } = fakeDb((sql) => (sql.includes('FROM custom_deliveries cd JOIN orders') ? [ROW] : {}));
    const res = await new DeliveryService(db).assign(5, { courier_name: 'Koffi', courier_phone: '+229 01 97 00 00 00' });
    expect(res.link).toMatch(/^https:\/\/edoto\.test\/livraison\/[A-Za-z0-9_-]{43}$/);
    expect(res.pin).toMatch(/^\d{6}$/);
    expect(res.whatsapp_url).toContain('https://wa.me/2290197000000?text=');
    expect(res.whatsapp_url).not.toContain(res.pin);
    const up = calls.find((c) => c.sql.includes('SET courier_name = ?'));
    const token = res.link.split('/').pop();
    expect(up.params).toContain(sha256(token));
    expect(up.params).not.toContain(token);
    expect(up.params).not.toContain(res.pin);
  });

  it('téléphone du zem sans indicatif international : refusé', async () => {
    const { db } = fakeDb((sql) => (sql.includes('FROM custom_deliveries cd JOIN orders') ? [ROW] : {}));
    await expect(new DeliveryService(db).assign(5, { courier_name: 'Koffi', courier_phone: '0197000000' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('commande non payée ou déjà remise : refusé', async () => {
    const unpaid = fakeDb((sql) => (sql.includes('FROM custom_deliveries cd JOIN orders') ? [{ ...ROW, payment_status: 'payment-pending' }] : {}));
    await expect(new DeliveryService(unpaid.db).assign(5, { courier_name: 'K', courier_phone: '+22901970000' })).rejects.toBeInstanceOf(BadRequestException);
    const done = fakeDb((sql) => (sql.includes('FROM custom_deliveries cd JOIN orders') ? [{ ...ROW, delivered_at: new Date() }] : {}));
    await expect(new DeliveryService(done.db).unblock(5)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("liste admin : uniquement les commandes payées, jamais d'empreinte", async () => {
    const { db, calls } = fakeDb((sql) => (sql.includes('COUNT(*)') ? [{ total: 0 }] : []));
    await new DeliveryService(db).adminList({ status: 'to_assign' });
    expect(calls[0].sql).toContain("o.payment_status = 'payment-success'");
    expect(calls[0].sql).toContain('cd.assigned_at IS NULL');
    expect(calls[0].sql).not.toMatch(/cd\.(pin_hash|device_hash)|cd\.link_token_hash,/);
  });
});
