/**
 * Matrice d'accès HTTP : vrais contrôleurs + vraie stratégie JWT + vrais guards,
 * services simulés (aucune base de données).
 */
process.env.JWT_SECRET_KEY = 'test-secret';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import * as jwt from 'jsonwebtoken';
import * as supertest from 'supertest';

// Compatible avec ou sans esModuleInterop
const request = ((supertest as any).default ?? supertest) as (app: any) => supertest.SuperTest<supertest.Test>;

import { JwtStrategy } from './auth/jwt.strategy';
import { UsersController, AdminController, ProfilesController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';
import { OrdersController, OrderStatusController, OrderFilesController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { CampaignsController } from './campaigns/campaigns.controller';
import { CampaignsService } from './campaigns/campaigns.service';
import { CampaignsAdminController } from './campaigns/campaigns-admin.controller';
import { CampaignsAdminService } from './campaigns/campaigns-admin.service';
import { PaymentIntentController } from './payment-intent/payment-intent.controller';
import { PaymentIntentService } from './payment-intent/payment-intent.service';
import { UploadsController } from './uploads/uploads.controller';
import { DatabaseService } from './database/database.services';
import { PickupAdminController } from './pickup/pickup-admin.controller';
import { PickupAdminService } from './pickup/pickup-admin.service';

const token = (id: number, role: string) =>
  jwt.sign({ id, email: `${role}@t.io`, permissions: [role] }, process.env.JWT_SECRET_KEY);

const T = {
  admin: token(1, 'super_admin'),
  customer: token(10, 'customer'),
  pickup: token(20, 'super_pickuppoint'),
  blockedPickup: token(21, 'super_pickuppoint'),
  owner: token(30, 'store_owner'),
};

const users = {
  getUsers: jest.fn().mockResolvedValue({ data: [{ id: 1, name: 'A', password: '$2b$hash' }], total: 1 }),
  getPublicUsersByRole: jest.fn().mockResolvedValue({ data: [{ id: 20, name: 'Point' }], total: 1 }),
  findOne: jest.fn().mockResolvedValue({ id: 10, name: 'C', password: '$2b$hash' }),
  update: jest.fn().mockResolvedValue({ id: 10, password: '$2b$hash' }),
  remove: jest.fn().mockResolvedValue('ok'),
  create: jest.fn().mockResolvedValue({ id: 99, password: '$2b$hash' }),
  banUser: jest.fn().mockResolvedValue({ id: 2 }),
  activeUser: jest.fn().mockResolvedValue({ id: 2 }),
  getAdmin: jest.fn().mockResolvedValue({ data: [] }),
};
const products = {
  getProductsByCorridor: jest.fn().mockResolvedValue({ data: [] }),
  update: jest.fn().mockResolvedValue({ id: 3 }),
  remove: jest.fn().mockResolvedValue('ok'),
  create: jest.fn().mockResolvedValue({ id: 3 }),
};
// products.shop_id = 7 ; shop 7 appartient à l'owner 30
const db = {
  query: jest.fn(async (sql: string, params: any[]) => {
    // ActivePickupGuard : le point 21 est bloqué
    if (sql.includes('SELECT is_active, pickup_approved FROM users')) {
      return [[{ is_active: params[0] === 21 ? 0 : 1, pickup_approved: 1 }], []];
    }
    if (sql.includes('FROM products WHERE id')) return [[{ shop_id: 7 }], []];
    if (sql.includes('FROM shops WHERE id = ? AND owner_id')) {
      return [params[0] === 7 && params[1] === 30 ? [{ id: 7 }] : [], []];
    }
    if (sql.includes('owner_id FROM shops')) return [[{ owner_id: 30 }], []];
    return [[], []];
  }),
};
const orders = {
  create: jest.fn().mockResolvedValue({ id: 1 }),
  getOrders: jest.fn().mockResolvedValue({ data: [] }),
  getOrderForUser: jest.fn().mockResolvedValue({ id: 1 }),
  updateForUser: jest.fn().mockResolvedValue({ id: 1 }),
  remove: jest.fn().mockResolvedValue('ok'),
  verifyOtp: jest.fn().mockResolvedValue({ success: true }),
  archiveOrder: jest.fn().mockResolvedValue({}),
  unarchiveOrder: jest.fn().mockResolvedValue({}),
  getNewOrders: jest.fn().mockResolvedValue([]),
  getPickupStats: jest.fn().mockResolvedValue({}),
  getOrderStatuses: jest.fn().mockResolvedValue({ data: [] }),
  createOrderStatus: jest.fn().mockResolvedValue({}),
  getOrderFileItems: jest.fn().mockResolvedValue({ data: [] }),
  regenerateOtp: jest.fn().mockResolvedValue({ success: true }),
};
const campaigns = {
  getActiveCampaign: jest.fn().mockResolvedValue([]),
  createCampaign: jest.fn().mockResolvedValue({ id: 1 }),
  updateStatus: jest.fn().mockResolvedValue({}),
  getRegistrationsForCampaign: jest.fn().mockResolvedValue([]),
  getRegistrationsByPickupCenter: jest.fn().mockResolvedValue([]),
  verifyCampaignOtp: jest.fn().mockResolvedValue({}),
  markPickup: jest.fn().mockResolvedValue({}),
  register: jest.fn().mockResolvedValue({}),
  getMyRegistrations: jest.fn().mockResolvedValue([]),
  regenerateRegistrationOtp: jest.fn().mockResolvedValue({ success: true }),
  getPublicStats: jest.fn().mockResolvedValue({}),
  checkEligibility: jest.fn().mockResolvedValue({ eligible: true }),
};
const campaignsAdmin = {
  list: jest.fn().mockResolvedValue({ data: [] }),
  detail: jest.fn().mockResolvedValue({}),
  create: jest.fn().mockResolvedValue({ id: 1 }),
  update: jest.fn().mockResolvedValue({ id: 1 }),
  remove: jest.fn().mockResolvedValue({}),
  listSponsors: jest.fn().mockResolvedValue([]),
  createSponsor: jest.fn().mockResolvedValue({ id: 1 }),
  exportAll: jest.fn().mockResolvedValue({ filename: 'c.xlsx', buffer: Buffer.from('x') }),
  exportCampaign: jest.fn().mockResolvedValue({ filename: 'c.xlsx', buffer: Buffer.from('x') }),
};
const pickupAdmin = {
  list: jest.fn().mockResolvedValue({ data: [] }),
  approve: jest.fn().mockResolvedValue({ success: true }),
  resendVerification: jest.fn().mockResolvedValue({ success: true }),
};
const payments = {
  completeFeexPayForUser: jest.fn().mockResolvedValue({ success: true, processed: true }),
};

jest.setTimeout(60000);

describe("Matrice d'accès HTTP", () => {
  let app: INestApplication;
  let http: any;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [
        UsersController, AdminController, ProfilesController,
        ProductsController,
        OrdersController, OrderStatusController, OrderFilesController,
        CampaignsController, CampaignsAdminController,
        PaymentIntentController,
        UploadsController,
        PickupAdminController,
      ],
      providers: [
        JwtStrategy,
        { provide: UsersService, useValue: users },
        { provide: ProductsService, useValue: products },
        { provide: DatabaseService, useValue: db },
        { provide: OrdersService, useValue: orders },
        { provide: CampaignsService, useValue: campaigns },
        { provide: CampaignsAdminService, useValue: campaignsAdmin },
        { provide: PaymentIntentService, useValue: payments },
        { provide: PickupAdminService, useValue: pickupAdmin },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => app && app.close());
  beforeEach(() => jest.clearAllMocks());

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  describe('users (S1, S2)', () => {
    it('GET /users anonyme sans rôle public → 403', async () => {
      await request(http).get('/api/users').expect(403);
      expect(users.getUsers).not.toHaveBeenCalled();
    });
    it('GET /users?role=super_pickuppoint anonyme → liste publique restreinte', async () => {
      const res = await request(http).get('/api/users?role=super_pickuppoint').expect(200);
      expect(users.getPublicUsersByRole).toHaveBeenCalled();
      expect(JSON.stringify(res.body)).not.toContain('password');
    });
    it('GET /users?role=customer par un client → 403', async () => {
      await request(http).get('/api/users?role=customer').set(auth(T.customer)).expect(403);
    });
    it('GET /users admin → liste complète sans hash de mot de passe', async () => {
      const res = await request(http).get('/api/users').set(auth(T.admin)).expect(200);
      expect(res.body.data[0]).not.toHaveProperty('password');
    });
    it('DELETE /users/:id anonyme → 401, autre compte → 403, soi-même → 200', async () => {
      await request(http).delete('/api/users/10').expect(401);
      await request(http).delete('/api/users/11').set(auth(T.customer)).expect(403);
      await request(http).delete('/api/users/10').set(auth(T.customer)).expect(200);
    });
    it('GET /users/:id propre compte sans hash', async () => {
      const res = await request(http).get('/api/users/10').set(auth(T.customer)).expect(200);
      expect(res.body).not.toHaveProperty('password');
    });
    it('PUT /users/:id sur un autre compte → 403', async () => {
      await request(http).put('/api/users/11').set(auth(T.customer)).send({ name: 'x' }).expect(403);
    });
    it('block-user / POST /users / admin/list / profiles réservés à super_admin', async () => {
      await request(http).post('/api/users/block-user').set(auth(T.customer)).send({ id: 2 }).expect(403);
      await request(http).post('/api/users/block-user').set(auth(T.admin)).send({ id: 2 }).expect(201);
      await request(http).post('/api/users').set(auth(T.owner)).send({}).expect(403);
      await request(http).get('/api/admin/list').expect(401);
      await request(http).delete('/api/profiles/3').set(auth(T.customer)).expect(403);
    });
  });

  describe('products (S3)', () => {
    it('lecture publique conservée', async () => {
      await request(http).get('/api/products/corridor').expect(200);
    });
    it('PUT/DELETE anonyme → 401, client → 403', async () => {
      await request(http).put('/api/products/3').send({ name: 'x' }).expect(401);
      await request(http).delete('/api/products/3').set(auth(T.customer)).expect(403);
      expect(products.update).not.toHaveBeenCalled();
      expect(products.remove).not.toHaveBeenCalled();
    });
    it("store_owner : sa boutique OK, déplacement vers une autre boutique refusé", async () => {
      const ok = await request(http).put('/api/products/3').set(auth(T.owner)).send({ name: 'x', is_origin: false });
      expect({ status: ok.status, body: ok.body }).toEqual({ status: 200, body: { id: 3 } });
      const moved = await request(http).put('/api/products/3').set(auth(T.owner)).send({ name: 'x', is_origin: false, shop_id: 8 });
      expect({ status: moved.status, message: moved.body.message }).toEqual({ status: 403, message: 'Accès refusé.' });
    });
    it('admin : toutes boutiques', async () => {
      await request(http).delete('/api/products/3').set(auth(T.admin)).expect(200);
    });
  });

  describe('orders (S5–S10)', () => {
    it('toutes les routes /orders exigent un token', async () => {
      await request(http).get('/api/orders').expect(401);
      await request(http).get('/api/orders/1').expect(401);
    });
    it("lecture et mise à jour passent par le contrôle d'accès du service", async () => {
      await request(http).get('/api/orders/1').set(auth(T.customer)).expect(200);
      expect(orders.getOrderForUser).toHaveBeenCalledWith(1, expect.objectContaining({ id: 10 }));
      await request(http).get('/api/orders/tracking-number/ORD-1').set(auth(T.customer)).expect(200);
      expect(orders.getOrderForUser).toHaveBeenCalledWith('ORD-1', expect.objectContaining({ id: 10 }));
      await request(http).put('/api/orders/1').set(auth(T.customer)).send({ pickup_point_id: 20 }).expect(200);
      expect(orders.updateForUser).toHaveBeenCalledWith(1, { pickup_point_id: 20 }, expect.objectContaining({ id: 10 }));
    });
    it('DELETE réservé à super_admin', async () => {
      await request(http).delete('/api/orders/1').set(auth(T.customer)).expect(403);
      await request(http).delete('/api/orders/1').set(auth(T.pickup)).expect(403);
      await request(http).delete('/api/orders/1').set(auth(T.admin)).expect(200);
    });
    it('verify-otp réservé aux points de retrait', async () => {
      await request(http).post('/api/orders/verify-otp').set(auth(T.customer)).send({ order_id: 1, otp_code: '1' }).expect(403);
      await request(http).post('/api/orders/verify-otp').set(auth(T.pickup)).send({ order_id: 1, otp_code: '1' }).expect(201);
    });
    it('archive / unarchive / new : client refusé', async () => {
      await request(http).patch('/api/orders/1/archive').set(auth(T.customer)).expect(403);
      await request(http).patch('/api/orders/1/unarchive').set(auth(T.customer)).expect(403);
      await request(http).get('/api/orders/new').set(auth(T.customer)).expect(403);
      await request(http).patch('/api/orders/1/unarchive').set(auth(T.pickup)).expect(200);
      expect(orders.unarchiveOrder).toHaveBeenCalledWith(1, expect.objectContaining({ id: 20 }));
    });
    it('POST /orders transmet l’utilisateur authentifié au service', async () => {
      await request(http).post('/api/orders').set(auth(T.customer)).send({ products: [] }).expect(201);
      expect(orders.create).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.objectContaining({ id: 10 }));
    });
    it('order-status : lecture publique, écriture admin', async () => {
      await request(http).get('/api/order-status').expect(200);
      await request(http).post('/api/order-status').send({}).expect(401);
      await request(http).delete('/api/order-status/1').set(auth(T.customer)).expect(403);
    });
    it('downloads : admin uniquement', async () => {
      await request(http).get('/api/downloads').expect(401);
      await request(http).get('/api/downloads').set(auth(T.customer)).expect(403);
    });
  });

  describe('campaigns (S11, S12)', () => {
    it('lecture publique conservée', async () => {
      await request(http).get('/api/campaigns/active').expect(200);
    });
    it('demande de kit : connexion requise, adresse du client transmise ; chiffres publics ; éligibilité connectée', async () => {
      await request(http).post('/api/campaigns/register').send({ campaign_id: 1, pickup_center: '2' }).expect(401);
      await request(http).post('/api/campaigns/register').set(auth(T.customer)).set('X-Forwarded-For', '41.85.1.2, 10.0.0.1')
        .send({ campaign_id: 1, pickup_center: '2', city: 'Cotonou', device_id: 'abcdef0123456789abcd' }).expect(201);
      expect(campaigns.register).toHaveBeenLastCalledWith(expect.objectContaining({ device_id: 'abcdef0123456789abcd' }), expect.anything(), '41.85.1.2');
      await request(http).get('/api/campaigns/1/stats').expect(200);
      await request(http).post('/api/campaigns/1/eligibility').send({}).expect(401);
      await request(http).post('/api/campaigns/1/eligibility').set(auth(T.customer)).send({}).expect(201);
      expect(campaigns.checkEligibility).toHaveBeenCalled();
    });
    it('routes admin/campaigns réservées à super_admin', async () => {
      await request(http).post('/api/admin/campaigns').send({}).expect(401);
      await request(http).post('/api/admin/campaigns').set(auth(T.customer)).send({}).expect(403);
      // Statut calculé à partir des dates : plus de route de changement de statut
      await request(http).patch('/api/admin/campaigns/1/status').set(auth(T.admin)).send({}).expect(404);
      await request(http).get('/api/admin/campaigns').set(auth(T.pickup)).expect(403);
      await request(http).put('/api/admin/campaigns/1').set(auth(T.customer)).send({}).expect(403);
      await request(http).delete('/api/admin/campaigns/1').set(auth(T.pickup)).expect(403);
      await request(http).get('/api/admin/campaigns/export').set(auth(T.customer)).expect(403);
      await request(http).get('/api/admin/campaigns/1/export').expect(401);
      await request(http).get('/api/admin/sponsors').set(auth(T.pickup)).expect(403);
      await request(http).get('/api/admin/campaigns').set(auth(T.admin)).expect(200);
      await request(http).get('/api/admin/campaigns/export').set(auth(T.admin)).expect(200)
        .expect('Content-Type', /spreadsheetml/);
      expect(campaignsAdmin.exportAll).toHaveBeenCalled();
      expect(campaignsAdmin.detail).not.toHaveBeenCalled(); // « export » n'est pas pris pour un id
      await request(http).get('/api/admin/campaigns/1/registrations').set(auth(T.customer)).expect(403);
      await request(http).get('/api/admin/campaigns/1/registrations').set(auth(T.admin)).expect(200);
    });
    it('verify-otp / mark-pickup : point de retrait, id transmis au service', async () => {
      await request(http).post('/api/campaigns/verify-otp').send({ registration_id: 1, otp: '1' }).expect(401);
      await request(http).post('/api/campaigns/mark-pickup').set(auth(T.customer)).send({ registration_id: 1 }).expect(403);
      await request(http).post('/api/campaigns/verify-otp').set(auth(T.pickup)).send({ registration_id: 1, otp: '1' }).expect(201);
      expect(campaigns.verifyCampaignOtp).toHaveBeenCalledWith({ registration_id: 1, otp: '1' }, 20);
    });
  });

  describe('points de retrait (validation admin) et OTP', () => {
    it('admin/pickup-points : anonyme 401, point de retrait 403, admin 200', async () => {
      await request(http).get('/api/admin/pickup-points').expect(401);
      await request(http).get('/api/admin/pickup-points?status=pending').set(auth(T.pickup)).expect(403);
      await request(http).patch('/api/admin/pickup-points/5/approve').set(auth(T.customer)).expect(403);
      await request(http).get('/api/admin/pickup-points?status=pending').set(auth(T.admin)).expect(200);
      expect(pickupAdmin.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
      await request(http).patch('/api/admin/pickup-points/5/approve').set(auth(T.admin)).expect(200);
      expect(pickupAdmin.approve).toHaveBeenCalledWith(5);
    });
    it('point de retrait bloqué (JWT encore valide) : toutes les actions commandes et kits refusées', async () => {
      await request(http).post('/api/orders/verify-otp').set(auth(T.blockedPickup)).send({ order_id: 1, otp_code: '1' }).expect(403);
      await request(http).get('/api/orders?pickup_point_id=21').set(auth(T.blockedPickup)).expect(403);
      await request(http).post('/api/campaigns/verify-otp').set(auth(T.blockedPickup)).send({ registration_id: 1, otp: '1' }).expect(403);
      await request(http).post('/api/campaigns/mark-pickup').set(auth(T.blockedPickup)).send({ registration_id: 1 }).expect(403);
      await request(http).get('/api/campaign-registrations/my').set(auth(T.blockedPickup)).expect(403);
      expect(orders.verifyOtp).not.toHaveBeenCalled();
      expect(campaigns.verifyCampaignOtp).not.toHaveBeenCalled();
    });
    it('kits : mes inscriptions et nouveau code réservés à un utilisateur connecté', async () => {
      await request(http).get('/api/campaign-registrations/mine').expect(401);
      await request(http).get('/api/campaign-registrations/mine').set(auth(T.customer)).expect(200);
      expect(campaigns.getMyRegistrations).toHaveBeenCalledWith(10);
      await request(http).post('/api/campaign-registrations/4/regenerate-otp').expect(401);
      await request(http).post('/api/campaign-registrations/4/regenerate-otp').set(auth(T.customer)).expect(201);
      expect(campaigns.regenerateRegistrationOtp).toHaveBeenCalledWith(4, 10);
    });
    it('admin : renvoi du lien de confirmation réservé à super_admin', async () => {
      await request(http).post('/api/admin/pickup-points/5/resend-verification').set(auth(T.pickup)).expect(403);
      await request(http).post('/api/admin/pickup-points/5/resend-verification').set(auth(T.admin)).expect(201);
      expect(pickupAdmin.resendVerification).toHaveBeenCalledWith(5);
    });
    it('regenerate-otp : token requis, utilisateur transmis au service', async () => {
      await request(http).post('/api/orders/5/regenerate-otp').expect(401);
      await request(http).post('/api/orders/5/regenerate-otp').set(auth(T.customer)).expect(201);
      expect(orders.regenerateOtp).toHaveBeenCalledWith(5, expect.objectContaining({ id: 10 }));
    });
  });

  describe('paiement et upload (S4, S14)', () => {
    it('feexpay/complete exige un token et passe l’utilisateur', async () => {
      await request(http).post('/api/payments/feexpay/complete').send({ transaction_id: 't', custom_id: 'ORD-1' }).expect(401);
      await request(http).post('/api/payments/feexpay/complete').set(auth(T.customer))
        .send({ transaction_id: 't', custom_id: 'ORD-1' }).expect(201);
      expect(payments.completeFeexPayForUser).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 10 }));
    });
    it('upload : anonyme 401, client 403', async () => {
      await request(http).post('/api/attachments').expect(401);
      await request(http).post('/api/attachments').set(auth(T.customer)).expect(403);
    });
    it('token signé avec un autre secret → 401', async () => {
      const forged = jwt.sign({ id: 1, permissions: ['super_admin'] }, 'wrong');
      await request(http).get('/api/admin/list').set(auth(forged)).expect(401);
    });
  });
});
