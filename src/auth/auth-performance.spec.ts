process.env.JWT_SECRET_KEY = 'test-secret';
jest.mock('./mailer', () => ({ sendVerificationEmail: jest.fn().mockResolvedValue(undefined) }));

import * as jwt from 'jsonwebtoken';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { DatabaseSetupService } from '../database/database-setup.service';

type Handler = (sql: string, params: any[]) => any;

// Requêtes simulées avec une latence : permet de vérifier qu'elles partent en parallèle
function slowDb(handler: Handler, latencyMs = 40) {
  const calls: { sql: string; params: any[] }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, latencyMs));
    inFlight--;
    return [handler(sql, params) ?? [], []];
  });
  return { calls, db: { query, getPool: () => ({ query }) } as any, maxInFlight: () => maxInFlight };
}

const USER = { id: 7, name: 'Awa', email: 'a@t.io', password: 'hash', role: 'customer', is_active: 1 };
const token = () => `Bearer ${jwt.sign({ id: 7, email: 'a@t.io', permissions: ['customer'] }, 'test-secret')}`;

describe('B1 — /me', () => {
  // 16/10/2026 : la photo est lue dans la table avatars (clé étrangère de profiles.avatar_id en production)
  it('utilisateur, profil et boutiques en parallèle ; photo lue dans avatars ; même forme de réponse', async () => {
    const { db, calls, maxInFlight } = slowDb((sql) => {
      if (sql.startsWith('SELECT * FROM users')) return [USER];
      if (sql.startsWith('SELECT * FROM profiles')) return [{ id: 3, customer_id: 7, avatar_id: 9, bio: 'x' }];
      if (sql.includes('FROM avatars WHERE id')) return [{ id: 9, original: 'https://img/9.png', thumbnail: null }];
      if (sql.includes('FROM shops s')) return [{ id: 1, name: 'Boutique' }];
      return [];
    });
    const me = await new AuthService(db).me(token());
    expect(maxInFlight()).toBe(3);
    expect(calls.some((c) => c.sql.includes('FROM media'))).toBe(false);
    expect(me).not.toHaveProperty('password');
    expect(me).toEqual(expect.objectContaining({
      id: 7,
      role: 'customer',
      profile: { id: 3, customer_id: 7, avatar_id: 9, bio: 'x', avatar: { id: 9, url: 'https://img/9.png', original: 'https://img/9.png', thumbnail: 'https://img/9.png' } },
      shops: [{ id: 1, name: 'Boutique' }],
    }));
  });

  it('sans profil : profil = { avatar: null }, aucune requête media (comme avant)', async () => {
    const { db, calls } = slowDb((sql) => (sql.startsWith('SELECT * FROM users') ? [USER] : []));
    const me = await new AuthService(db).me(token());
    expect(me.profile).toEqual({ avatar: null });
    expect(me.shops).toEqual([]);
    expect(calls.some((c) => c.sql.includes('FROM media WHERE id'))).toBe(false);
  });

  it('point de retrait bloqué ou utilisateur inconnu : refusé', async () => {
    const blocked = slowDb((sql) => (sql.startsWith('SELECT * FROM users') ? [{ ...USER, role: 'super_pickuppoint', is_active: 0 }] : []));
    await expect(new AuthService(blocked.db).me(token())).rejects.toBeInstanceOf(UnauthorizedException);
    const unknown = slowDb(() => []);
    await expect(new AuthService(unknown.db).me(token())).rejects.toThrow('Utilisateur non trouvé');
  });

  it('jeton invalide : refusé sans requête', async () => {
    const { db, calls } = slowDb(() => []);
    await expect(new AuthService(db).me('Bearer abc')).rejects.toThrow('Token invalide');
    expect(calls).toHaveLength(0);
  });
});

// Inscription valide depuis le 16/10/2026 : nom, mot de passe conforme, date de naissance, sexe
const VALID = { name: 'Awa Houndé', password: 'Edoto2026', birth_date: '2005-02-28', sex: 'female' };

describe('B2 — inscription', () => {
  it('champs contrôlés : mot de passe faible, nom avec chiffres, date de naissance ou sexe absents → refus sans écriture', async () => {
    const { db, calls } = slowDb(() => []);
    const svc = new AuthService(db);
    await expect(svc.register({ ...VALID, email: 'x@t.io', password: 'secret' } as any)).rejects.toThrow('majuscule');
    await expect(svc.register({ ...VALID, email: 'x@t.io', name: 'Awa2' } as any)).rejects.toThrow('lettres');
    await expect(svc.register({ ...VALID, email: 'x@t.io', birth_date: undefined } as any)).rejects.toThrow('date de naissance');
    await expect(svc.register({ ...VALID, email: 'x@t.io', sex: 'x' } as any)).rejects.toThrow('Sexe');
    expect(calls).toHaveLength(0);
  });

  it('adresse existante : refusée, aucun compte créé', async () => {
    const { db, calls } = slowDb((sql) => (sql.startsWith('SELECT id FROM users') ? [{ id: 1 }] : []));
    await expect(new AuthService(db).register({ ...VALID, email: 'a@t.io' } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(calls.some((c) => c.sql.includes('INSERT INTO users'))).toBe(false);
  });

  it('décision (a) : compte enregistré AVANT l’e-mail ; si l’envoi échoue, le compte existe et le message le dit', async () => {
    const mailer = require('./mailer').sendVerificationEmail as jest.Mock;
    const order: string[] = [];
    mailer.mockImplementationOnce(async () => { order.push('email'); throw new Error('Brevo KO'); });
    const { db } = slowDb((sql) => { if (sql.includes('INSERT INTO users')) order.push('insert'); return []; });
    await expect(new AuthService(db).register({ ...VALID, email: 'k@t.io' } as any))
      .rejects.toThrow('Votre compte est créé');
    expect(order).toEqual(['insert', 'email']);
  });

  it('nouvelle adresse : compte créé avec mot de passe haché', async () => {
    const { db, calls } = slowDb(() => []);
    const res = await new AuthService(db).register({ ...VALID, email: 'N@t.io' } as any);
    expect(res.message).toContain('Inscription réussie');
    const ins = calls.find((c) => c.sql.includes('INSERT INTO users'));
    expect(ins.params[1]).toBe('n@t.io');
    expect(ins.params[2]).toMatch(/^\$2[aby]\$10\$/);
    expect(ins.params.slice(-2)).toEqual(['2005-02-28', 'female']);
  });
});

describe('Démarrage de l’API', () => {
  const OLD = process.env.DB_SETUP_ON_BOOT;
  afterEach(() => { process.env.DB_SETUP_ON_BOOT = OLD; });

  it('scripts SQL non exécutés par défaut', async () => {
    delete process.env.DB_SETUP_ON_BOOT;
    const svc = new DatabaseSetupService();
    const run = jest.spyOn(svc, 'run').mockResolvedValue(undefined);
    await svc.onModuleInit();
    expect(run).not.toHaveBeenCalled();
  });

  it('DB_SETUP_ON_BOOT=true : exécutés', async () => {
    process.env.DB_SETUP_ON_BOOT = 'true';
    const svc = new DatabaseSetupService();
    const run = jest.spyOn(svc, 'run').mockResolvedValue(undefined);
    await svc.onModuleInit();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
