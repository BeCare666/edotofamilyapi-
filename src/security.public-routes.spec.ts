/**
 * Audit sécurité 1.4 (C5, 24/10/2026) : guard JWT global, seules les routes marquées @Public()
 * sur la méthode restent accessibles sans connexion.
 * 1) Comportement du guard sur un petit contrôleur de test (vraie stratégie JWT).
 * 2) Inventaire des contrôleurs : la liste des routes publiques doit être exactement PUBLIC_ROUTES.
 */
process.env.JWT_SECRET_KEY = 'test-secret';

import { Controller, Get, INestApplication, SetMetadata } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as jwt from 'jsonwebtoken';
import * as supertest from 'supertest';

// Compatible avec ou sans esModuleInterop
const request = ((supertest as any).default ?? supertest) as (app: any) => supertest.SuperTest<supertest.Test>;

import { JwtStrategy } from './auth/jwt.strategy';
import { GlobalJwtAuthGuard } from './auth/global-jwt-auth.guard';
import { IS_PUBLIC_KEY, Public } from './auth/public.decorator';

// Routes accessibles sans connexion : liste du plan (rapport_security.md §1.4) et routes appelées
// par le site sans jeton (register-pick-up-point, resend-verification-email, delivery/quote, logout).
// GET /users garde son propre contrôle (rôles publics seulement sans jeton super admin).
const PUBLIC_ROUTES = [
  'POST /register', 'POST /register-pick-up-point', 'POST /token', 'POST /forget-password',
  'POST /verify-forget-password-token', 'POST /reset-password', 'POST /resend-verification-email',
  'GET /verify-email', 'POST /logout',
  'POST /ai/chat',
  'GET /products', 'GET /products/:slug', 'GET /products/corridor', 'GET /products/search',
  'GET /popular-products', 'GET /best-selling-products', 'GET /top-rate-product', 'GET /category-wise-product',
  'GET /campaigns/active', 'GET /campaigns/upcoming', 'GET /campaigns/:id', 'GET /campaigns/:id/stats',
  'GET /campaigns/active/city/:city', 'GET /campaigns/active/count',
  'GET /categories', 'GET /categories/:param',
  'GET /souscategories', 'GET /souscategories/:param', 'GET /souscategories/bycategory',
  'GET /sub_categories', 'GET /sub_categories/:param',
  'GET /types', 'GET /types/:slug', 'GET /tags', 'GET /tags/:param',
  'GET /contraception/methods', 'GET /contraception/methods/:slug',
  'GET /corridors', 'GET /corridors/:id', 'GET /countries', 'GET /countries/:id',
  'GET /shippings', 'GET /shippings/:id', 'GET /taxes', 'GET /taxes/:id',
  'GET /settings', 'GET /site-appearance',
  'GET /faqs', 'GET /faqs/:param', 'GET /terms-and-conditions', 'GET /terms-and-conditions/:param',
  'GET /reviews', 'GET /reviews/:id', 'GET /questions', 'GET /questions/:id',
  'GET /shops', 'GET /shops/:slug', 'GET /top-shops', 'GET /new-shops', 'GET /near-by-shop/:lat/:lng',
  'GET /pickup', 'GET /pickup/:id', 'GET /delivery/quote',
  'POST /courier-links/:token/open', 'POST /courier-links/:token/unlock', 'POST /courier-links/:token/deliver',
  'GET /sponsor-invitations/:token', 'POST /sponsor-invitations/accept', 'POST /sponsor-signup',
  'GET /teleconsultation/availability', 'GET /teleconsultation/qr/:file', 'GET /teleconsultation/qr-info/:token',
  'GET /teleconsultation/invitations/:token', 'POST /teleconsultation/invitations/accept',
  'GET /users',
];

@Controller('demo')
class DemoController {
  @Public()
  @Get('open')
  open() {
    return { ok: true };
  }

  @Get('closed')
  closed() {
    return { ok: true };
  }
}

// @Public() posé sur la classe : volontairement sans effet
@SetMetadata(IS_PUBLIC_KEY, true)
@Controller('demo-class')
class DemoClassController {
  @Get()
  closed() {
    return { ok: true };
  }
}

describe('Guard JWT global (audit 1.4)', () => {
  let app: INestApplication;
  const token = jwt.sign({ id: 10, permissions: ['customer'] }, process.env.JWT_SECRET_KEY);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [DemoController, DemoClassController],
      providers: [JwtStrategy, { provide: APP_GUARD, useClass: GlobalJwtAuthGuard }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it('route @Public() : accessible sans jeton', () => request(app.getHttpServer()).get('/demo/open').expect(200));
  it('route sans @Public() : 401 sans jeton', () => request(app.getHttpServer()).get('/demo/closed').expect(401));
  it('route sans @Public() : 401 avec un jeton signé par une autre clé', () =>
    request(app.getHttpServer())
      .get('/demo/closed')
      .set('Authorization', `Bearer ${jwt.sign({ id: 1, permissions: ['super_admin'] }, 'autre-cle')}`)
      .expect(401));
  it('route sans @Public() : 200 avec un jeton valide', () =>
    request(app.getHttpServer()).get('/demo/closed').set('Authorization', `Bearer ${token}`).expect(200));
  it('@Public() sur la classe ne rend pas ses routes publiques', () =>
    request(app.getHttpServer()).get('/demo-class').expect(401));
});

describe('Inventaire des routes publiques (audit 1.4)', () => {
  const HTTP = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'All'];
  const decos = (n: ts.Node) => (ts.canHaveDecorators(n) ? ts.getDecorators(n) : undefined) || [];
  const name = (d: ts.Decorator) =>
    ts.isCallExpression(d.expression) ? d.expression.expression.getText() : d.expression.getText();
  const arg = (d: ts.Decorator) =>
    ts.isCallExpression(d.expression) && d.expression.arguments[0]
      ? d.expression.arguments[0].getText().replace(/^['"`]|['"`]$/g, '')
      : '';
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
    }
    return out;
  };

  const publicRoutes: string[] = [];
  const publicClasses: string[] = [];
  for (const file of walk(__dirname)) {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes('@Controller')) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    sf.forEachChild((n) => {
      if (!ts.isClassDeclaration(n)) return;
      const ctl = decos(n).find((d) => name(d) === 'Controller');
      if (!ctl) return;
      if (decos(n).some((d) => name(d) === 'Public')) publicClasses.push(n.name?.getText() || file);
      for (const m of n.members) {
        const h = decos(m).find((d) => HTTP.includes(name(d)));
        if (!h || !decos(m).some((d) => name(d) === 'Public')) continue;
        const route = '/' + [arg(ctl), arg(h)].filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\//, '');
        publicRoutes.push(`${name(h).toUpperCase()} ${route}`);
      }
    });
  }

  it('aucun @Public() posé sur une classe de contrôleur', () => expect(publicClasses).toEqual([]));
  it('les routes publiques sont exactement la liste autorisée', () =>
    expect([...publicRoutes].sort()).toEqual([...PUBLIC_ROUTES].sort()));
  it('aucune route fermée le 24/10 ne réapparaît en public', () => {
    for (const r of ['GET /me', 'POST /follow-shop', 'POST /my-questions', 'GET /order-status', 'POST /payments/webhook',
      'POST /webhook/flutterwave', 'GET /staffs', 'GET /feedbacks', 'POST /otp-login', 'POST /social-login-token'])
      expect(publicRoutes).not.toContain(r);
  });
});
