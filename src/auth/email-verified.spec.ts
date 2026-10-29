// Nouvel appareil (code par e-mail) testé à part : src/auth/device-check.spec.ts
process.env.NEW_DEVICE_ROLES = 'off';
import * as bcrypt from 'bcrypt';
import { AuthService, EMAIL_NOT_VERIFIED, EMAIL_VERIFIED_ROLES } from './auth.service';

// Audit sécurité 3.8 (29/10/2026) : e-mail confirmé obligatoire pour les rôles sensibles
describe('Connexion : e-mail confirmé obligatoire pour les rôles sensibles', () => {
  let hash: string;
  const ENV = { ...process.env };
  beforeAll(async () => {
    process.env.JWT_SECRET_KEY = 'cle-de-test';
    delete process.env.TOTP_ROLES;
    hash = await bcrypt.hash('Motdepasse1!', 4);
  });
  afterAll(() => {
    process.env = ENV;
  });
  const login = (user: any) => {
    const query = jest.fn(async () => [[user]]);
    return new AuthService({ query, getPool: () => ({ query }) } as any).login(user.email, 'Motdepasse1!');
  };
  const base = (over: any) => ({ id: 2, email: 'x@y.org', password: hash, is_active: 1, token_version: 0, ...over });

  it('rôles concernés : super admin, médecin, centre, sponsor', () => {
    expect(EMAIL_VERIFIED_ROLES).toEqual(['super_admin', 'doctor', 'health_center', 'sponsor']);
  });

  it.each(['super_admin', 'doctor', 'health_center', 'sponsor'])('%s non confirmé : refusé avec un message clair', async (role) => {
    await expect(login(base({ role, is_verified: 0 }))).rejects.toThrow(EMAIL_NOT_VERIFIED);
  });

  it('sponsor confirmé : connecté', async () => {
    const res: any = await login(base({ role: 'sponsor', is_verified: 1 }));
    expect(res.permissions).toEqual(['sponsor']);
  });

  it('jeune (customer) non confirmé : inchangé (pas de rôle sensible)', async () => {
    const res: any = await login(base({ role: 'customer', is_verified: 0 }));
    expect(res.permissions).toEqual(['customer']);
  });

  it('compte bloqué : son propre message reste prioritaire', async () => {
    await expect(login(base({ role: 'sponsor', is_verified: 0, is_active: 0 }))).rejects.not.toThrow(EMAIL_NOT_VERIFIED);
  });
});
