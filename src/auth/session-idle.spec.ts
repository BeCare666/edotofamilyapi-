import * as jwt from 'jsonwebtoken';
import { sessionIdleSeconds, sessionMaxSeconds, sessionStart, signSession } from './session';
import { AuthService } from './auth.service';

// Inactivité 5 min (décision du 29/10/2026) : jeton court renouvelé tant que la personne agit,
// durée maximale depuis la connexion inchangée (12 h / 7 jours)
describe('Sessions : 5 min d’inactivité, durée maximale gardée', () => {
  const ENV = { ...process.env };
  beforeAll(() => {
    process.env.JWT_SECRET_KEY = 'cle-de-test';
    delete process.env.SESSION_IDLE_MINUTES;
  });
  afterAll(() => {
    process.env = ENV;
  });
  const user = { id: 4, email: 'a@b.com', role: 'customer', token_version: 1 };
  const read = (t: string) => jwt.verify(t, 'cle-de-test') as any;

  it('jeton valable 5 min (réglable par SESSION_IDLE_MINUTES), heure de connexion st incluse', () => {
    expect(sessionIdleSeconds()).toBe(300);
    expect(sessionIdleSeconds('15')).toBe(900);
    expect(sessionIdleSeconds('abc')).toBe(300);
    const p = read(signSession(user, 'customer'));
    expect(p.exp - p.iat).toBe(300);
    expect(p.st).toBe(p.iat);
    expect(p.tv).toBe(1);
  });

  it('durées maximales inchangées : 12 h (super admin, médecin, centre), 7 jours (autres)', () => {
    expect(sessionMaxSeconds('super_admin')).toBe(43200);
    expect(sessionMaxSeconds('doctor')).toBe(43200);
    expect(sessionMaxSeconds('customer')).toBe(604800);
  });

  it('renouvellement : même heure de connexion ; près de la limite, le jeton s’arrête à la limite ; au-delà, refus', () => {
    const now = Math.floor(Date.now() / 1000);
    const nearEnd = read(signSession(user, 'super_admin', now - 43200 + 60));
    expect(nearEnd.exp - nearEnd.iat).toBeLessThanOrEqual(60);
    expect(() => signSession(user, 'super_admin', now - 43201)).toThrow('Durée maximale');
    expect(sessionStart({ st: 123, iat: 456 })).toBe(123);
    expect(sessionStart({ iat: 456 })).toBe(456);
  });

  it('POST /token/refresh : nouveau jeton de 5 min, rôle relu en base, durée maximale dépassée → 401', async () => {
    const query = jest.fn(async () => [[{ ...user }]]);
    const auth = new AuthService({ query, getPool: () => ({ query }) } as any);
    const now = Math.floor(Date.now() / 1000);
    const res: any = await auth.refreshSession({ id: 4, st: now - 100 });
    expect(read(res.token).st).toBe(now - 100);
    expect(res.permissions).toEqual(['customer']);
    await expect(auth.refreshSession({ id: 4, st: now - 8 * 86400 })).rejects.toThrow('reconnectez-vous');
  });
});
