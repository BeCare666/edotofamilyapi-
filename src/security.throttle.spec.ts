/**
 * Phase 1.2 de l'audit sécurité (22/10/2026) : limitation de débit (H2).
 * Vrai contrôleur d'authentification, vrai garde global, service simulé.
 * Vérifie que la limite suit l'adresse posée par Cloudflare et ne se contourne pas en changeant X-Forwarded-For.
 */
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import * as supertest from 'supertest';

// Compatible avec ou sans esModuleInterop
const request = ((supertest as any).default ?? supertest) as (app: any) => supertest.SuperTest<supertest.Test>;

import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { ClientThrottlerGuard, MINUTE } from './common/client-throttler.guard';
import { realClientIp } from './common/client-ip';

jest.setTimeout(60000);

const auth = {
  forgetPassword: jest.fn().mockResolvedValue({ success: true }),
  login: jest.fn().mockResolvedValue({ token: 't' }),
  register: jest.fn().mockResolvedValue({ ok: true }),
};

describe('Limitation de débit (audit 1.2)', () => {
  let app: INestApplication;
  let http: any;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ name: 'default', limit: 100, ttl: MINUTE }] })],
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: auth }, { provide: APP_GUARD, useClass: ClientThrottlerGuard }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    http = app.getHttpServer();
  });

  afterEach(async () => app && app.close());

  it('adresse réelle : CF-Connecting-IP, jamais X-Forwarded-For', () => {
    expect(realClientIp({ headers: { 'cf-connecting-ip': '197.1.1.1', 'x-forwarded-for': '9.9.9.9' } })).toBe('197.1.1.1');
    expect(realClientIp({ headers: { 'x-forwarded-for': '9.9.9.9' }, ip: '10.0.0.1' })).toBe('10.0.0.1');
    expect(realClientIp({ headers: {}, ip: '::ffff:127.0.0.1' })).toBe('127.0.0.1');
    expect(realClientIp({ headers: {} })).toBeNull();
  });

  it('forget-password : 5 par heure, le 6e refusé même en changeant X-Forwarded-For', async () => {
    for (let i = 0; i < 5; i++) {
      await request(http).post('/api/forget-password').set('cf-connecting-ip', '41.1.1.1')
        .set('x-forwarded-for', `1.2.3.${i}`).send({ email: 'a@t.io' }).expect(201);
    }
    await request(http).post('/api/forget-password').set('cf-connecting-ip', '41.1.1.1')
      .set('x-forwarded-for', '1.2.3.99').send({ email: 'a@t.io' }).expect(429);
    // Un autre visiteur n'est pas touché
    await request(http).post('/api/forget-password').set('cf-connecting-ip', '41.2.2.2').send({ email: 'a@t.io' }).expect(201);
  });

  it('token : 5 par minute et par IP', async () => {
    for (let i = 0; i < 5; i++) {
      await request(http).post('/api/token').set('cf-connecting-ip', '41.3.3.3').send({ email: `u${i}@t.io`, password: 'x' }).expect(201);
    }
    await request(http).post('/api/token').set('cf-connecting-ip', '41.3.3.3').send({ email: 'u9@t.io', password: 'x' }).expect(429);
  });

  it('token : 5 par minute et par adresse e-mail, même depuis des IP différentes', async () => {
    for (let i = 0; i < 5; i++) {
      await request(http).post('/api/token').set('cf-connecting-ip', `41.4.4.${i}`).send({ email: 'Cible@T.io', password: 'x' }).expect(201);
    }
    await request(http).post('/api/token').set('cf-connecting-ip', '41.4.4.99').send({ email: 'cible@t.io', password: 'x' }).expect(429);
  });

  it('limite globale : 100 requêtes par minute et par IP', async () => {
    for (let i = 0; i < 100; i++) {
      await request(http).post('/api/logout').set('cf-connecting-ip', '41.5.5.5').expect(201);
    }
    await request(http).post('/api/logout').set('cf-connecting-ip', '41.5.5.5').expect(429);
  });
});
