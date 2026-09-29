process.env.JWT_SECRET_KEY = 'test-secret';
jest.mock('../auth/mailer', () => ({ sendVerificationEmail: jest.fn().mockResolvedValue(undefined) }));

import * as bcrypt from 'bcrypt';
import { BadRequestException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { sendVerificationEmail } from '../auth/mailer';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
import { OrdersService } from '../orders/orders.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { PickupAdminService, pickupPointStatus } from './pickup-admin.service';

type Handler = (sql: string, params: any[]) => any;

function fakeDb(handler: Handler) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    return [handler(sql, params) ?? [], []];
  });
  const pool = { query, getConnection: jest.fn() };
  return { calls, db: { getPool: () => pool, query } as any };
}

const mailer = sendVerificationEmail as jest.Mock;
beforeEach(() => mailer.mockReset().mockResolvedValue(undefined));

// ------------------------------------------------------------------ inscription / connexion
describe('Inscription point de retrait', () => {
  const dto = { name: 'Pharmacie X', email: 'p@x.io', password: 'secret', pickup_lat: 6.37, pickup_lng: 2.39, pickup_address: 'Akpakpa' };

  it('crée le compte en attente (pickup_approved = 0) avec les coordonnées', async () => {
    const { db, calls } = fakeDb((sql) => (sql.startsWith('SELECT id FROM users') ? [] : {}));
    const res = await new AuthService(db).registerPickUpPoint(dto as any);
    const insert = calls.find((c) => c.sql.includes('INSERT INTO users'));
    expect(insert.sql).toContain('pickup_approved');
    expect(insert.params.slice(3)).toEqual(['super_pickuppoint', false, 0, null, 1, null, 6.37, 2.39, 'Akpakpa', 0]);
    expect(res.message).toContain('validation');
    expect(mailer.mock.calls[0][0].message).toContain('examinée par notre équipe');
  });

  it('refuse des coordonnées invalides ou incomplètes, sans rien créer', async () => {
    const { db, calls } = fakeDb(() => []);
    const svc = new AuthService(db);
    await expect(svc.registerPickUpPoint({ ...dto, pickup_lat: 200 } as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.registerPickUpPoint({ ...dto, pickup_lng: null } as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.registerPickUpPoint({ ...dto, name: ' ' } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(calls.some((c) => c.sql.includes('INSERT'))).toBe(false);
  });

  it('accepte une inscription sans coordonnées (page /admin/add-pickup-point existante)', async () => {
    const { db, calls } = fakeDb((sql) => (sql.startsWith('SELECT id FROM users') ? [] : {}));
    await new AuthService(db).registerPickUpPoint({ ...dto, pickup_lat: null, pickup_lng: null } as any);
    const insert = calls.find((c) => c.sql.includes('INSERT INTO users'));
    expect(insert.params.slice(9, 11)).toEqual([null, null]);
  });

  it('e-mail déjà utilisé : 403 comme avant', async () => {
    const { db } = fakeDb(() => [{ id: 1 }]);
    await expect(new AuthService(db).registerPickUpPoint(dto as any)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('Connexion point de retrait', () => {
  let hash: string;
  beforeAll(async () => { hash = await bcrypt.hash('secret', 4); });
  const login = (row: any) => {
    const { db } = fakeDb(() => [row]);
    return new AuthService(db).login('p@x.io', 'secret');
  };

  it('en attente de validation : 403 explicite, aucun token', async () => {
    await expect(login({ id: 5, role: 'super_pickuppoint', password: hash, pickup_approved: 0 }))
      .rejects.toThrow('en attente de validation');
  });
  it('validé : token émis', async () => {
    const res = await login({ id: 5, role: 'super_pickuppoint', password: hash, pickup_approved: 1 });
    expect(res.token).toBeDefined();
    expect(res.permissions).toEqual(['super_pickuppoint']);
  });
  it('client : inchangé (colonne sans effet)', async () => {
    const res = await login({ id: 6, role: 'customer', password: hash, pickup_approved: 0 });
    expect(res.permissions).toEqual(['customer']);
  });
});

// ------------------------------------------------------------------ admin
describe('PickupAdminService', () => {
  it('statut dérivé : en attente, actif, bloqué', () => {
    expect(pickupPointStatus({ pickup_approved: 0, is_active: 1 })).toBe('pending');
    expect(pickupPointStatus({ pickup_approved: 0, is_active: 0 })).toBe('pending');
    expect(pickupPointStatus({ pickup_approved: 1, is_active: 1 })).toBe('active');
    expect(pickupPointStatus({ pickup_approved: 1, is_active: 0 })).toBe('blocked');
  });

  it('liste filtrée par statut, sans mot de passe', async () => {
    const { db, calls } = fakeDb((sql) => (sql.includes('COUNT(*)') ? [{ total: 1 }] : [{ id: 5, pickup_approved: 0, is_active: 1 }]));
    const res = await new PickupAdminService(db).list({ status: 'pending' });
    expect(calls[0].sql).toContain("role = 'super_pickuppoint' AND pickup_approved = 0");
    expect(calls[0].sql).not.toContain('password');
    expect(res.data[0].status).toBe('pending');
  });

  it('filtre inconnu ignoré (pas injecté dans le SQL)', async () => {
    const { db, calls } = fakeDb((sql) => (sql.includes('COUNT(*)') ? [{ total: 0 }] : []));
    await new PickupAdminService(db).list({ status: "x' OR 1=1 --" });
    expect(calls[0].sql).not.toContain('OR 1=1');
  });

  it('validation : e-mail confirmé requis', async () => {
    const { db, calls } = fakeDb(() => [{ id: 5, is_verified: 0, pickup_approved: 0 }]);
    await expect(new PickupAdminService(db).approve(5)).rejects.toThrow("n'a pas encore été confirmée");
    expect(calls.some((c) => c.sql.startsWith('UPDATE'))).toBe(false);
  });

  it('validation OK', async () => {
    const { db, calls } = fakeDb((sql) => (sql.startsWith('UPDATE') ? { affectedRows: 1 } : [{ id: 5, is_verified: 1, pickup_approved: 0 }]));
    await expect(new PickupAdminService(db).approve(5)).resolves.toEqual(expect.objectContaining({ success: true, email_sent: true }));
    expect(calls[1].sql).toContain('SET pickup_approved = 1');
  });

  it('déjà validé : 400 ; inconnu : 404', async () => {
    const already = fakeDb(() => [{ id: 5, is_verified: 1, pickup_approved: 1 }]);
    await expect(new PickupAdminService(already.db).approve(5)).rejects.toBeInstanceOf(BadRequestException);
    const none = fakeDb(() => []);
    await expect(new PickupAdminService(none.db).approve(5)).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ------------------------------------------------------------------ points bloqués
describe('Points bloqués : visibles mais non sélectionnables', () => {
  it('liste publique : exclut les inscriptions en attente, marque les bloqués', async () => {
    const { db, calls } = fakeDb((sql) => (/^\s*SELECT COUNT\(\*\) as total/i.test(sql)
      ? [{ total: 2 }]
      : [{ id: 1, name: 'A', is_active: 1 }, { id: 2, name: 'B', is_active: 0 }]));
    const res: any = await new UsersService(db).getPublicUsersByRole({ role: 'super_pickuppoint' } as any);
    expect(calls[0].sql).toContain('pickup_approved = 1');
    expect(res.data.map((p) => p.status)).toEqual(['active', 'blocked']);
  });

  const orderHandler = (point: any): Handler => (sql) => {
    if (sql.includes('SELECT id, customer_id, pickup_point_id')) {
      return [{ id: 5, customer_id: 10, pickup_point_id: 2, order_status: 'order-processing', otp_used: 0 }];
    }
    if (sql.includes("role = 'super_pickuppoint'")) return point ? [point] : [];
    if (sql.startsWith('SELECT * FROM orders WHERE id')) return [{ id: 5 }];
    return {};
  };
  const customer = { id: 10, permissions: ['customer'] };
  const orders = (h: Handler) => new OrdersService({} as any, {} as any, {} as any, fakeDb(h).db);

  it('commande : choisir un point bloqué → 400', async () => {
    await expect(orders(orderHandler({ id: 3, is_active: 0, pickup_approved: 1 })).updateForUser(5, { pickup_point_id: 3 }, customer))
      .rejects.toThrow('bloqué');
  });
  it('commande : point en attente de validation → 400 inconnu', async () => {
    await expect(orders(orderHandler({ id: 3, is_active: 1, pickup_approved: 0 })).updateForUser(5, { pickup_point_id: 3 }, customer))
      .rejects.toThrow('inconnu');
  });
  it('commande : point actif accepté', async () => {
    await expect(orders(orderHandler({ id: 3, is_active: 1, pickup_approved: 1 })).updateForUser(5, { pickup_point_id: 3 }, customer))
      .resolves.toBeDefined();
  });
  it('commande : garder son point devenu bloqué ne casse pas la mise à jour', async () => {
    await expect(orders(orderHandler({ id: 2, is_active: 0, pickup_approved: 1 })).updateForUser(5, { pickup_point_id: 2, note: 'x' }, customer))
      .resolves.toBeDefined();
  });

  it('campagne : inscription sur un point bloqué → 400, avant toute écriture', async () => {
    const { db, calls } = fakeDb((sql) => {
      if (sql.includes('FROM campaigns WHERE id')) return [{ id: 1 }];
      if (sql.includes('FROM campaign_locations WHERE campaign_id')) return [{ city: 'Cotonou' }];
      if (sql.includes('SELECT name, role, is_active, pickup_approved')) return [{ name: 'B', role: 'super_pickuppoint', is_active: 0, pickup_approved: 1 }];
      return [];
    });
    await expect(new CampaignsService(db).register({ campaign_id: 1, pickup_center: '2', city: 'Cotonou' } as any, 10)).rejects.toThrow('bloqué');
    expect(calls.some((c) => c.sql.includes('INSERT'))).toBe(false);
  });
});

// ------------------------------------------------------------------ OTP : expiration et régénération
describe('OTP de retrait : expiration et régénération', () => {
  const past = new Date(Date.now() - 3600e3);
  const future = new Date(Date.now() + 3600e3);
  const base = {
    id: 5, customer_id: 10, tracking_number: 'ORD-5', payment_status: 'payment-success', order_status: 'order-processing',
    otp_code: '111111', otp_used: 0, otp_expires_at: past, delivered_at: null, email: 'c@t.io', pickup_point_id: 20,
  };
  const customer = { id: 10, permissions: ['customer'] };

  const make = (row: any, updateAffected = 1) => {
    const { db, calls } = fakeDb((sql) => {
      if (sql.includes('FROM orders o')) return row ? [row] : [];
      if (sql.includes('SELECT id, otp_code, otp_used, otp_expires_at')) return row ? [row] : [];
      if (sql.startsWith('UPDATE orders') || sql.trim().startsWith('UPDATE')) return { affectedRows: updateAffected };
      return [];
    });
    return { svc: new OrdersService({} as any, {} as any, {} as any, db), calls };
  };

  it('code expiré, pas retiré : nouveau code, e-mail envoyé, expiration +48 h', async () => {
    const { svc, calls } = make({ ...base });
    const res: any = await svc.regenerateOtp(5, customer);
    expect(res.success).toBe(true);
    const upd = calls.find((c) => c.sql.includes('SET otp_code = ?, otp_expires_at = ?'));
    expect(upd.sql).toContain('otp_used = 0 AND delivered_at IS NULL');
    expect(upd.params[0]).toMatch(/^\d{6}$/);
    expect(upd.params[0]).not.toBe('111111');
    expect(upd.params[1].getTime() - Date.now()).toBeGreaterThan(47 * 3600e3);
    expect(mailer).toHaveBeenCalledWith(expect.objectContaining({ email: 'c@t.io' }));
    expect(mailer.mock.calls[0][0].message).toContain(upd.params[0]);
    expect(res).not.toHaveProperty('otp');
  });

  it.each([
    ['otp déjà utilisé', { otp_used: 1 }],
    ['commande terminée', { order_status: 'order-completed' }],
    ['delivered_at renseigné', { delivered_at: new Date() }],
  ])('retrait déjà effectué (%s) : refus, rien modifié', async (_l, patch) => {
    const { svc, calls } = make({ ...base, ...patch });
    await expect(svc.regenerateOtp(5, customer)).rejects.toThrow('déjà été retirée');
    expect(calls.some((c) => c.sql.includes('SET otp_code'))).toBe(false);
    expect(mailer).not.toHaveBeenCalled();
  });

  it('code encore valable : refus', async () => {
    const { svc } = make({ ...base, otp_expires_at: future });
    await expect(svc.regenerateOtp(5, customer)).rejects.toThrow('encore valable');
  });

  it('commande non payée, annulée, autre client : refus', async () => {
    await expect(make({ ...base, payment_status: 'payment-pending' }).svc.regenerateOtp(5, customer)).rejects.toBeInstanceOf(BadRequestException);
    await expect(make({ ...base, order_status: 'order-cancelled' }).svc.regenerateOtp(5, customer)).rejects.toBeInstanceOf(BadRequestException);
    await expect(make({ ...base }).svc.regenerateOtp(5, { id: 11, permissions: ['customer'] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(make(null).svc.regenerateOtp(5, customer)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("validation concurrente par le point de retrait : l'UPDATE conditionnel ne touche rien → 400, pas d'e-mail", async () => {
    const { svc } = make({ ...base }, 0);
    await expect(svc.regenerateOtp(5, customer)).rejects.toBeInstanceOf(BadRequestException);
    expect(mailer).not.toHaveBeenCalled();
  });

  it("échec de l'e-mail : ancien code restauré pour permettre une nouvelle tentative", async () => {
    mailer.mockRejectedValueOnce(new Error('brevo down'));
    const { svc, calls } = make({ ...base });
    await expect(svc.regenerateOtp(5, customer)).rejects.toBeInstanceOf(InternalServerErrorException);
    const restore = calls.filter((c) => c.sql.startsWith('UPDATE orders SET otp_code = ?, otp_expires_at = ? WHERE id = ? AND otp_code = ?'));
    expect(restore).toHaveLength(1);
    expect(restore[0].params[0]).toBe('111111');
  });

  it('validation par le point de retrait : code expiré refusé, même correct', async () => {
    const { svc, calls } = make({ ...base });
    await expect(svc.verifyOtp({ order_id: 5, otp_code: '111111' }, { id: 20, permissions: ['super_pickuppoint'] }))
      .rejects.toThrow('expiré');
    expect(calls.some((c) => c.sql.includes("otp_used = 1"))).toBe(false);
  });

  it('validation par le point de retrait : code valable accepté', async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes('SELECT id, otp_code, otp_used, otp_expires_at')) return [{ ...base, otp_expires_at: future }];
      if (sql.includes('otp_used = 1')) return { affectedRows: 1 };
      return [{ ...base }];
    });
    const svc = new OrdersService({} as any, {} as any, {} as any, db);
    await expect(svc.verifyOtp({ order_id: 5, otp_code: '111111' }, { id: 20, permissions: ['super_pickuppoint'] }))
      .resolves.toEqual(expect.objectContaining({ success: true }));
  });
});

// ------------------------------------------------------------------ renvoi e-mail, notification, blocage
import { ActivePickupGuard } from '../auth/active-pickup.guard';
import { UnauthorizedException } from '@nestjs/common';
import * as jwtLib from 'jsonwebtoken';

describe("Renvoi de l'e-mail de confirmation", () => {
  const svcFor = (row: any) => new AuthService(fakeDb(() => (row ? [row] : [])).db);

  it('compte inconnu : réponse générique, aucun e-mail', async () => {
    const res = await svcFor(null).resendVerificationEmail('inconnu-1@x.io');
    expect(res.success).toBe(true);
    expect(mailer).not.toHaveBeenCalled();
  });
  it('point de retrait non confirmé : e-mail « point de retrait » renvoyé', async () => {
    await svcFor({ email: 'pp-1@x.io', name: 'Pharmacie', role: 'super_pickuppoint', is_verified: 0 }).resendVerificationEmail('pp-1@x.io');
    expect(mailer).toHaveBeenCalledTimes(1);
    expect(mailer.mock.calls[0][0].subject).toContain('Point de Retrait');
    expect(mailer.mock.calls[0][0].message).toContain('/verify-email?token=');
  });
  it('déjà confirmé : réponse générique identique, aucun e-mail', async () => {
    const res = await svcFor({ email: 'ok-1@x.io', role: 'customer', is_verified: 1 }).resendVerificationEmail('ok-1@x.io');
    expect(res.message).toContain('Si un compte non confirmé existe');
    expect(mailer).not.toHaveBeenCalled();
  });
  it('anti-abus : second envoi dans la minute refusé', async () => {
    const svc = svcFor({ email: 'pp-2@x.io', role: 'super_pickuppoint', is_verified: 0 });
    await svc.resendVerificationEmail('pp-2@x.io');
    await expect(svc.resendVerificationEmail('PP-2@x.io ')).rejects.toThrow('Patientez');
    expect(mailer).toHaveBeenCalledTimes(1);
  });
  it("échec d'envoi : 500 et nouvelle tentative possible tout de suite", async () => {
    mailer.mockRejectedValueOnce(new Error('down'));
    const svc = svcFor({ email: 'pp-3@x.io', role: 'super_pickuppoint', is_verified: 0 });
    await expect(svc.resendVerificationEmail('pp-3@x.io')).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(svc.resendVerificationEmail('pp-3@x.io')).resolves.toEqual(expect.objectContaining({ success: true }));
  });
});

describe('Point de retrait bloqué', () => {
  let hash: string;
  beforeAll(async () => { hash = await bcrypt.hash('secret', 4); });

  it('connexion refusée', async () => {
    const { db } = fakeDb(() => [{ id: 5, role: 'super_pickuppoint', password: hash, pickup_approved: 1, is_active: 0 }]);
    await expect(new AuthService(db).login('p@x.io', 'secret')).rejects.toThrow('bloqué');
  });
  it('session déjà ouverte : /me renvoie 401 (déconnexion côté front)', async () => {
    const token = jwtLib.sign({ id: 5, permissions: ['super_pickuppoint'] }, process.env.JWT_SECRET_KEY);
    const { db } = fakeDb(() => [{ id: 5, role: 'super_pickuppoint', is_active: 0 }]);
    await expect(new AuthService(db).me(`Bearer ${token}`)).rejects.toThrow('Point de retrait bloqué');
    await expect(new AuthService(db).me(`Bearer ${token}`)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  const ctx = (user: any) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;
  it('ActivePickupGuard : bloqué → 403 (validation de commande ou de kit impossible)', async () => {
    const { db } = fakeDb(() => [{ is_active: 0, pickup_approved: 1 }]);
    await expect(new ActivePickupGuard(db).canActivate(ctx({ id: 5, permissions: ['super_pickuppoint'] }))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('ActivePickupGuard : actif → OK ; client → OK sans requête', async () => {
    const active = fakeDb(() => [{ is_active: 1, pickup_approved: 1 }]);
    await expect(new ActivePickupGuard(active.db).canActivate(ctx({ id: 5, permissions: ['super_pickuppoint'] }))).resolves.toBe(true);
    const none = fakeDb(() => []);
    await expect(new ActivePickupGuard(none.db).canActivate(ctx({ id: 10, permissions: ['customer'] }))).resolves.toBe(true);
    expect(none.calls).toHaveLength(0);
  });
});

describe('Validation admin : notification par e-mail', () => {
  const approveDb = () => fakeDb((sql) => (sql.startsWith('UPDATE')
    ? { affectedRows: 1 }
    : [{ id: 5, name: 'Pharmacie X', email: 'pp@x.io', is_verified: 1, pickup_approved: 0 }]));

  it('e-mail « validé » envoyé au point de retrait', async () => {
    const res: any = await new PickupAdminService(approveDb().db).approve(5);
    expect(res.email_sent).toBe(true);
    expect(mailer).toHaveBeenCalledWith(expect.objectContaining({ email: 'pp@x.io' }));
    expect(mailer.mock.calls[0][0].message).toContain('Pharmacie X');
    expect(mailer.mock.calls[0][0].message).toContain('/login');
  });
  it("échec de l'e-mail : la validation reste acquise, l'admin est averti", async () => {
    mailer.mockRejectedValueOnce(new Error('down'));
    const res: any = await new PickupAdminService(approveDb().db).approve(5);
    expect(res).toEqual(expect.objectContaining({ success: true, email_sent: false }));
  });
  it("renvoi du lien par l'admin : OK si non confirmé, 400 sinon", async () => {
    const pending = fakeDb(() => [{ id: 5, name: 'P', email: 'pp@x.io', role: 'super_pickuppoint', is_verified: 0 }]);
    await expect(new PickupAdminService(pending.db).resendVerification(5)).resolves.toEqual(expect.objectContaining({ success: true }));
    expect(mailer.mock.calls[0][0].message).toContain('/verify-email?token=');
    const verified = fakeDb(() => [{ id: 5, email: 'pp@x.io', role: 'super_pickuppoint', is_verified: 1 }]);
    await expect(new PickupAdminService(verified.db).resendVerification(5)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("Kits de campagne : nouveau code jusqu'au retrait", () => {
  const past = new Date(Date.now() - 3600e3);
  const reg = {
    id: 1, campaign_id: 3, email: 'c@t.io', pickup_center: '20', pickup_center_name: 'Pharmacie X',
    otp_code: '222222', otp_used: 0, otp_expires_at: past, picked_up: 0, order_status: 'order-processing',
  };
  const make = (row: any, affected = 1, userEmail = 'c@t.io') => {
    const { db, calls } = fakeDb((sql) => {
      if (sql.startsWith('SELECT email FROM users')) return [{ email: userEmail }];
      if (sql.includes('FROM campaign_registrations r')) return row ? [row] : [];
      if (sql.trim().startsWith('UPDATE')) return { affectedRows: affected };
      return [];
    });
    return { svc: new CampaignsService(db), calls };
  };

  it('code expiré, kit non retiré : nouveau code envoyé (48 h, tentatives remises à 0)', async () => {
    const { svc, calls } = make({ ...reg });
    const res: any = await svc.regenerateRegistrationOtp(1, 10);
    expect(res.success).toBe(true);
    const upd = calls.find((c) => c.sql.includes('SET otp_code = ?, otp_expires_at = ?, otp_attempts = 0'));
    expect(upd.sql).toContain('otp_used = 0 AND picked_up = 0');
    expect(upd.params[0]).toMatch(/^\d{6}$/);
    expect(upd.params[1].getTime() - Date.now()).toBeGreaterThan(47 * 3600e3);
    expect(mailer.mock.calls[0][0].message).toContain(upd.params[0]);
    expect(mailer.mock.calls[0][0].message).toContain('Pharmacie X');
    expect(res).not.toHaveProperty('otp');
  });
  it.each([
    ['kit retiré', { picked_up: 1 }, 'déjà été retiré'],
    ['statut terminé', { order_status: 'order-completed' }, 'déjà été retiré'],
    ['code déjà validé au point de retrait', { otp_used: 1 }, 'déjà été validé'],
    ['code encore valable', { otp_expires_at: new Date(Date.now() + 3600e3) }, 'encore valable'],
  ])('%s : refus, rien modifié', async (_l, patch, msg) => {
    const { svc, calls } = make({ ...reg, ...(patch as any) });
    await expect(svc.regenerateRegistrationOtp(1, 10)).rejects.toThrow(msg as string);
    expect(calls.some((c) => c.sql.includes('SET otp_code'))).toBe(false);
    expect(mailer).not.toHaveBeenCalled();
  });
  it("inscription d'un autre participant : 403", async () => {
    await expect(make({ ...reg }, 1, 'autre@t.io').svc.regenerateRegistrationOtp(1, 11)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("validation concurrente : rien modifié, pas d'e-mail", async () => {
    await expect(make({ ...reg }, 0).svc.regenerateRegistrationOtp(1, 10)).rejects.toBeInstanceOf(BadRequestException);
    expect(mailer).not.toHaveBeenCalled();
  });
  it("échec de l'e-mail : ancien code restauré", async () => {
    mailer.mockRejectedValueOnce(new Error('down'));
    const { svc, calls } = make({ ...reg });
    await expect(svc.regenerateRegistrationOtp(1, 10)).rejects.toBeInstanceOf(InternalServerErrorException);
    const restore = calls.find((c) => c.sql.startsWith('UPDATE campaign_registrations SET otp_code = ?, otp_expires_at = ? WHERE id = ? AND otp_code = ?'));
    expect(restore.params[0]).toBe('222222');
  });
  it('mes inscriptions : filtrées par e-mail, sans code', async () => {
    const { svc, calls } = make({ ...reg });
    await svc.getMyRegistrations(10);
    const q = calls.find((c) => c.sql.includes('FROM campaign_registrations r'));
    expect(q.sql).toContain('WHERE r.email = ?');
    expect(q.params).toEqual(['c@t.io']);
    expect(q.sql).not.toMatch(/r\.otp_code/);
  });
});
