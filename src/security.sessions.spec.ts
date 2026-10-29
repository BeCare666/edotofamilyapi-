/**
 * Audit sécurité 1.5 (H3, 24/10/2026) : sessions.
 * - JwtStrategy relit le compte : sans version, version changée, bloqué ou supprimé → 401 ; cache 30 s.
 * - Durée : 12 h pour super admin, médecin, centre ; 7 jours sinon.
 * - login() : « Identifiants invalides » pour e-mail inconnu ou mauvais mot de passe ; compte bloqué refusé.
 * - Changement et réinitialisation du mot de passe : token_version incrémentée.
 * - Lien de vérification d'e-mail : purpose 'verify-email' exigé.
 */
process.env.JWT_SECRET_KEY = 'test-secret';
jest.mock('./auth/mailer', () => ({ sendVerificationEmail: jest.fn().mockResolvedValue(undefined) }));

// Nouvel appareil (code par e-mail) testé à part : src/auth/device-check.spec.ts
process.env.NEW_DEVICE_ROLES = 'off';
import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import * as supertest from 'supertest';

// Compatible avec ou sans esModuleInterop
const request = ((supertest as any).default ?? supertest) as (app: any) => supertest.SuperTest<supertest.Test>;

import { JwtStrategy } from './auth/jwt.strategy';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { DatabaseService } from './database/database.services';
import { AuthService, ACCOUNT_DISABLED, INVALID_CREDENTIALS } from './auth/auth.service';
import { hashResetCode } from './auth/password-reset-rules';
import {
  SESSION_CACHE_MS, bumpTokenVersion, clearSessionCache, isBlocked, readEmailVerification,
  sessionTtl, signEmailVerification, signSession,
} from './auth/session';

@Controller('private')
class PrivateController {
  @UseGuards(JwtAuthGuard)
  @Get()
  get() {
    return { ok: true };
  }
}

const sign = (payload: object, secret = process.env.JWT_SECRET_KEY) => `Bearer ${jwt.sign(payload, secret)}`;

describe('JwtStrategy relit le compte (audit 1.5)', () => {
  let app: INestApplication;
  // Comptes simulés : 1 actif v0, 2 actif v3, 3 bloqué, 4 is_active NULL ; 99 absent
  const accounts: Record<number, any> = {
    1: { id: 1, role: 'customer', is_active: 1, token_version: 0 },
    2: { id: 2, role: 'customer', is_active: 1, token_version: 3 },
    3: { id: 3, role: 'customer', is_active: 0, token_version: 0 },
    4: { id: 4, role: 'customer', is_active: null, token_version: 0 },
  };
  const query = jest.fn(async (sql: string, p: any[]) => {
    if (sql.startsWith('UPDATE users SET token_version')) {
      accounts[p[0]].token_version += 1;
      return [{ affectedRows: 1 }, []];
    }
    return [accounts[p[0]] ? [{ ...accounts[p[0]] }] : [], []];
  });
  const get = (auth?: string) => {
    const r = request(app.getHttpServer()).get('/private');
    return auth ? r.set('Authorization', auth) : r;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [PrivateController],
      providers: [JwtStrategy, { provide: DatabaseService, useValue: { query } }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    clearSessionCache();
    query.mockClear();
  });

  it('jeton valide, version identique : 200', () => get(sign({ id: 1, permissions: ['customer'], tv: 0 })).expect(200));
  it('jeton sans tv (émis avant le 24/10) : 401', () => get(sign({ id: 1, permissions: ['customer'] })).expect(401));
  it('version différente : 401', () => get(sign({ id: 2, permissions: ['customer'], tv: 2 })).expect(401));
  it('compte bloqué : 401', () => get(sign({ id: 3, permissions: ['customer'], tv: 0 })).expect(401));
  it('compte supprimé : 401', () => get(sign({ id: 99, permissions: ['customer'], tv: 0 })).expect(401));
  it('is_active NULL compte comme actif (DEFAULT 1) : 200', () =>
    get(sign({ id: 4, permissions: ['customer'], tv: 0 })).expect(200));
  it('jeton de vérification d\'e-mail utilisé comme session : 401', () =>
    get(`Bearer ${signEmailVerification('a@t.io')}`).expect(401));

  it('cache 30 s : une seule lecture pour deux requêtes', async () => {
    const t = sign({ id: 1, permissions: ['customer'], tv: 0 });
    await get(t).expect(200);
    await get(t).expect(200);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('bumpTokenVersion : le jeton précédent est refusé aussitôt (cache vidé)', async () => {
    const t = sign({ id: 2, permissions: ['customer'], tv: 3 });
    await get(t).expect(200);
    await bumpTokenVersion({ query }, 'id = ?', [2]);
    await get(t).expect(401);
    await get(sign({ id: 2, permissions: ['customer'], tv: 4 })).expect(200);
  });
});

describe('Durée et contenu des jetons (audit 1.5)', () => {
  const ttl = (token: string) => {
    const d: any = jwt.decode(token);
    return d.exp - d.iat;
  };
  it('durée maximale 12 h (super admin, médecin, centre) / 7 jours (autres) ; chaque jeton 5 min (inactivité, 29/10)', () => {
    for (const r of ['super_admin', 'doctor', 'health_center']) expect(sessionTtl(r)).toBe('12h');
    for (const r of ['customer', 'store_owner', 'sponsor', 'super_pickuppoint']) expect(sessionTtl(r)).toBe('7d');
    expect(ttl(signSession({ id: 1, email: 'a@t.io', token_version: 2 }, 'super_admin'))).toBe(5 * 60);
    expect(ttl(signSession({ id: 1, email: 'a@t.io', token_version: 2 }, 'customer'))).toBe(5 * 60);
  });
  it('tv = token_version, permissions = [rôle]', () => {
    const d: any = jwt.decode(signSession({ id: 5, email: 'a@t.io', token_version: 4 }, 'sponsor'));
    expect(d).toEqual(expect.objectContaining({ id: 5, email: 'a@t.io', permissions: ['sponsor'], tv: 4 }));
  });
  it('isBlocked : seul 0 bloque', () => {
    expect([0, '0', false].map(isBlocked)).toEqual([true, true, true]);
    expect([1, '1', true, null, undefined].map(isBlocked)).toEqual([false, false, false, false, false]);
  });
});

describe('login() (audit 1.5)', () => {
  let hash: string;
  beforeAll(async () => {
    hash = await bcrypt.hash('Bon-mot2passe', 4);
  });
  const service = (user: any) =>
    new AuthService({
      query: jest.fn(async (sql: string) => [sql.startsWith('SELECT * FROM users') && user ? [user] : [], []]),
    } as any);

  it('e-mail inconnu et mauvais mot de passe : même message « Identifiants invalides »', async () => {
    await expect(service(null).login('x@t.io', 'Bon-mot2passe')).rejects.toThrow(INVALID_CREDENTIALS);
    const user = { id: 1, email: 'a@t.io', password: hash, role: 'customer', is_active: 1, token_version: 0 };
    await expect(service(user).login('a@t.io', 'faux')).rejects.toThrow(INVALID_CREDENTIALS);
  });

  it('compte bloqué refusé pour client, propriétaire de boutique et super admin', async () => {
    for (const role of ['customer', 'store_owner', 'super_admin']) {
      const user = { id: 1, email: 'a@t.io', password: hash, role, is_active: 0, token_version: 0 };
      await expect(service(user).login('a@t.io', 'Bon-mot2passe')).rejects.toThrow(ACCOUNT_DISABLED);
    }
  });

  it('super admin : jeton de 5 min (renouvelable jusqu’à 12 h) portant la version du compte', async () => {
    const user = { id: 1, email: 'a@t.io', password: hash, role: 'super_admin', is_active: 1, is_verified: 1, token_version: 6 };
    const res: any = await service(user).login('a@t.io', 'Bon-mot2passe');
    const d: any = jwt.verify(res.token, process.env.JWT_SECRET_KEY);
    expect(d.tv).toBe(6);
    expect(d.exp - d.iat).toBe(5 * 60);
    expect(d.st).toBe(d.iat);
    expect(res.permissions).toEqual(['super_admin']);
  });
});

describe('Mot de passe changé ou réinitialisé : sessions fermées (audit 1.5)', () => {
  it('changePassword incrémente token_version du compte', async () => {
    const old = await bcrypt.hash('Ancien-mot2passe', 4);
    const query = jest.fn(async (sql: string) => [sql.startsWith('SELECT id, password') ? [{ id: 7, password: old }] : { affectedRows: 1 }, []]);
    await new AuthService({ query } as any).changePassword({ oldPassword: 'Ancien-mot2passe', newPassword: 'Nouveau-mot2passe' } as any, 7);
    expect(query).toHaveBeenCalledWith('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [7]);
  });

  it('resetPassword incrémente token_version du compte visé par l\'e-mail', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM password_resets')) return [[{ id: 1, otp: hashResetCode('123456'), attempts: 0 }], []];
      return [{ affectedRows: 1 }, []];
    });
    const res = await new AuthService({ query } as any).resetPassword({ email: 'A@t.io', token: '123456', password: 'Nouveau-mot2passe' } as any);
    expect(res.success).toBe(true);
    expect(query).toHaveBeenCalledWith('UPDATE users SET token_version = token_version + 1 WHERE LOWER(email) = ?', ['a@t.io']);
  });
});

describe('Lien de vérification d\'e-mail (audit 1.5)', () => {
  it('accepte un jeton émis pour le lien', () => {
    expect(readEmailVerification(signEmailVerification('a@t.io'))).toBe('a@t.io');
  });
  it('refuse un jeton de session ou un ancien jeton sans purpose', () => {
    expect(() => readEmailVerification(signSession({ id: 1, email: 'a@t.io', token_version: 0 }, 'customer'))).toThrow();
    expect(() => readEmailVerification(jwt.sign({ email: 'a@t.io' }, process.env.JWT_SECRET_KEY))).toThrow();
  });
  it('durée de vie du cache documentée : 30 s', () => expect(SESSION_CACHE_MS).toBe(30000));
});
