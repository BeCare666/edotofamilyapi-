import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as supertest from 'supertest';
import { applySecurity, isAllowedOrigin } from './cors';

// Compatible avec ou sans esModuleInterop
const request = ((supertest as any).default ?? supertest) as (app: any) => supertest.SuperTest<supertest.Test>;

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

describe('applySecurity sur un vrai serveur HTTP (audit 1.3)', () => {
  let app: INestApplication;
  const env = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    const moduleRef = await Test.createTestingModule({ controllers: [PingController] }).compile();
    app = moduleRef.createNestApplication();
    applySecurity(app);
    await app.init();
  }, 60000);

  afterAll(async () => {
    process.env.NODE_ENV = env;
    await app?.close();
  });

  it('pose les en-têtes de sécurité', async () => {
    const res = await request(app.getHttpServer()).get('/ping').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('CORS : le site est autorisé, un autre domaine non', async () => {
    const ok = await request(app.getHttpServer()).options('/ping')
      .set('Origin', 'https://www.edotofamily.com').set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe('https://www.edotofamily.com');
    const ko = await request(app.getHttpServer()).options('/ping')
      .set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(ko.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS limité (audit 1.3)', () => {
  it('accepte le site et l\'admin en production', () => {
    for (const o of ['https://www.edotofamily.com', 'https://edotofamily.com', 'https://edotofamily.vercel.app', 'https://edotofamilyadmin.vercel.app']) {
      expect(isAllowedOrigin(o, 'production')).toBe(true);
    }
  });

  it('refuse tout autre site, et localhost en production', () => {
    expect(isAllowedOrigin('https://evil.example', 'production')).toBe(false);
    expect(isAllowedOrigin('https://www.edotofamily.com.evil.example', 'production')).toBe(false);
    expect(isAllowedOrigin('http://www.edotofamily.com', 'production')).toBe(false);
    expect(isAllowedOrigin('http://localhost:3000', 'production')).toBe(false);
  });

  it('accepte localhost hors production', () => {
    expect(isAllowedOrigin('http://localhost:3000', 'development')).toBe(true);
    expect(isAllowedOrigin('http://localhost:3001', undefined)).toBe(true);
  });

  it('laisse passer les appels sans Origin (serveur à serveur)', () => {
    expect(isAllowedOrigin(undefined, 'production')).toBe(true);
  });
});
