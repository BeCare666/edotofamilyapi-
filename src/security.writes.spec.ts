/**
 * Phase 0.4 de l'audit sécurité (22/10/2026) : routes d'écriture restées publiques (C5),
 * désormais réservées au super admin. Vrais contrôleurs, vraie stratégie JWT, services simulés.
 */
process.env.JWT_SECRET_KEY = 'test-secret';
// Alias @db inconnu de Jest : les services des sous-catégories l'importent, leur contenu est ici inutile
jest.mock('@db/edotofamily_categories_full.json', () => ({ categories: [], sous_categories: [] }), { virtual: true });

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import * as jwt from 'jsonwebtoken';
import * as supertest from 'supertest';

// Compatible avec ou sans esModuleInterop
const request = ((supertest as any).default ?? supertest) as (app: any) => supertest.SuperTest<supertest.Test>;

import { JwtStrategy } from './auth/jwt.strategy';
import { DatabaseService } from './database/database.services';
import { TagsController } from './tags/tags.controller';
import { TagsService } from './tags/tags.service';
import { TypesController } from './types/types.controller';
import { TypesService } from './types/types.service';
import { TaxesController } from './taxes/taxes.controller';
import { TaxesService } from './taxes/taxes.service';
import { CountriesController } from './countries/countries.controller';
import { CountriesService } from './countries/countries.service';
import { WithdrawsController } from './withdraws/withdraws.controller';
import { WithdrawsService } from './withdraws/withdraws.service';
import { AbusiveReportsController } from './reviews/reports.controller';
import { AbusiveReportService } from './reviews/reports.service';
import { ReviewController } from './reviews/reviews.controller';
import { ReviewService } from './reviews/reviews.service';
import { QuestionController } from './questions/questions.controller';
import { QuestionService } from './questions/questions.service';
import { FeedbackController } from './feedbacks/feedbacks.controller';
import { FeedbackService } from './feedbacks/feedbacks.service';
import {
  ShopsController, DisapproveShop, StaffsController, DisapproveShopController, ApproveShopController,
} from './shops/shops.controller';
import { ShopsService } from './shops/shops.service';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesService } from './categories/categories.service';
import { CategoriesController as SousCategoriesController } from './sous-categories/categories.controller';
import { SousCategoriesService } from './sous-categories/categories.service';
import { ShippingsController } from './shippings/shippings.controller';
import { ShippingsService } from './shippings/shippings.service';
import { AiController } from './ai/ai.controller';
import { AiService } from './ai/ai.service';

const token = (id: number, role: string) =>
  jwt.sign({ id, email: `${role}@t.io`, permissions: [role], tv: 0 }, process.env.JWT_SECRET_KEY);
const T = { admin: token(1, 'super_admin'), customer: token(10, 'customer'), owner: token(30, 'store_owner') };
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// Service simulé : toute méthode répond { ok: true }
// (sauf `then` et les symboles : sinon Nest prend le service pour une promesse et l'attend sans fin)
const fakeService = () => {
  const fns: Record<string, jest.Mock> = {};
  return new Proxy(fns, {
    get: (target, name: string | symbol) => {
      if (typeof name !== 'string' || name === 'then') return undefined;
      return (target[name] = target[name] || jest.fn().mockResolvedValue({ ok: true }));
    },
  });
};

// Routes fermées le 22/10/2026 : [méthode, chemin]
const CLOSED: [string, string][] = [
  ['post', '/api/tags'], ['put', '/api/tags/1'], ['delete', '/api/tags/1'],
  ['post', '/api/types'], ['put', '/api/types/1'], ['delete', '/api/types/1'],
  ['post', '/api/taxes'], ['put', '/api/taxes/1'], ['delete', '/api/taxes/1'],
  ['post', '/api/countries'], ['delete', '/api/countries/1'],
  ['get', '/api/withdraws'], ['get', '/api/withdraws/1'],
  ['post', '/api/abusive_reports'], ['put', '/api/abusive_reports/1'], ['delete', '/api/abusive_reports/1'],
  ['post', '/api/reviews'], ['put', '/api/reviews/1'], ['delete', '/api/reviews/1'],
  ['put', '/api/questions/1'], ['delete', '/api/questions/1'],
  ['get', '/api/feedbacks'], ['get', '/api/feedbacks/1'],
  ['post', '/api/shops'], ['put', '/api/shops/1'], ['delete', '/api/shops/1'], ['post', '/api/shops/approve'],
  ['post', '/api/disapprove-shop/1'], ['post', '/api/disapprove-shop'], ['post', '/api/approve-shop'],
  ['post', '/api/staffs'], ['put', '/api/staffs/1'], ['delete', '/api/staffs/1'],
  ['post', '/api/categories'], ['post', '/api/categories/bulk'], ['patch', '/api/categories/1'], ['delete', '/api/categories/1'],
  ['post', '/api/souscategories'], ['post', '/api/souscategories/batch'], ['put', '/api/souscategories/1'], ['delete', '/api/souscategories/1'],
  ['post', '/api/shippings'], ['put', '/api/shippings/1'], ['delete', '/api/shippings/1'],
  ['post', '/api/generate-descriptions'],
];

// Routes supprimées par le nettoyage N5 (27/10/2026) : plus aucune réponse, même pour le super admin
const REMOVED: [string, string][] = [
  ['get', '/api/faqs'], ['post', '/api/faqs'], ['get', '/api/terms-and-conditions'],
  ['post', '/api/approve-terms-and-conditions'], ['post', '/api/disapprove-terms-and-conditions'],
  ['get', '/api/corridors'], ['post', '/api/corridors'], ['post', '/api/product-corridors/link'],
  ['get', '/api/sub_categories'], ['post', '/api/sub_categories'], ['post', '/api/countries/bulk'],
  ['post', '/api/withdraws'], ['post', '/api/withdraws/1/approve'], ['delete', '/api/withdraws/1'],
  ['post', '/api/feedbacks'], ['put', '/api/feedbacks/1'], ['delete', '/api/feedbacks/1'],
];

// Lectures utilisées par le site et le formulaire produit : restent publiques
const STILL_PUBLIC: string[] = ['/api/types', '/api/tags', '/api/countries', '/api/categories', '/api/shops'];

jest.setTimeout(60000);

describe('Écritures réservées au super admin (audit C5)', () => {
  let app: INestApplication;
  let http: any;

  beforeAll(async () => {
    const services = [
      TagsService, TypesService, TaxesService,
      CountriesService, WithdrawsService, AbusiveReportService, ReviewService,
      QuestionService, FeedbackService, ShopsService, CategoriesService, SousCategoriesService,
      ShippingsService, AiService,
    ];
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [
        TagsController, TypesController, TaxesController, CountriesController,
        WithdrawsController, AbusiveReportsController, ReviewController, QuestionController, FeedbackController,
        ShopsController, DisapproveShop, StaffsController, DisapproveShopController, ApproveShopController,
        CategoriesController, SousCategoriesController, ShippingsController, AiController,
      ],
      providers: [
        JwtStrategy,
        // Audit 1.5 : JwtStrategy relit le compte ; ici tous les comptes sont actifs, version 0
        { provide: DatabaseService, useValue: { query: async (_sql: string, p: any[]) => [[{ id: p[0], role: 'x', is_active: 1, token_version: 0 }], []] } },
        ...services.map((s) => ({ provide: s, useValue: fakeService() })),
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => app && app.close());

  it.each(CLOSED)('%s %s : 401 sans jeton', async (method, path) => {
    await (request(http) as any)[method](path).send({}).expect(401);
  });

  it.each(CLOSED)('%s %s : 403 pour un client', async (method, path) => {
    await (request(http) as any)[method](path).set(auth(T.customer)).send({}).expect(403);
  });

  it.each(CLOSED)('%s %s : 403 pour un propriétaire de boutique', async (method, path) => {
    await (request(http) as any)[method](path).set(auth(T.owner)).send({}).expect(403);
  });

  it.each(CLOSED)('%s %s : le super admin passe les guards', async (method, path) => {
    const res = await (request(http) as any)[method](path).set(auth(T.admin)).send({});
    expect([401, 403]).not.toContain(res.status);
  });

  it.each(REMOVED)('%s %s : supprimée (N5) → 404', async (method, path) => {
    await (request(http) as any)[method](path).set(auth(T.admin)).send({}).expect(404);
  });

  it.each(STILL_PUBLIC)('GET %s reste public', async (path) => {
    const res = await request(http).get(path);
    expect([401, 403]).not.toContain(res.status);
  });
});
