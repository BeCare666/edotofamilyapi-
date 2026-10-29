// Nouvel appareil (code par e-mail) testé à part : src/auth/device-check.spec.ts
process.env.NEW_DEVICE_ROLES = 'off';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { base32Decode, base32Encode, hashRecoveryCode, newRecoveryCodes, otpauthUrl, totpCode, totpRequiredRoles, verifyTotp } from './totp';
import { TotpService } from './totp.service';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { sealHealth } from '../common/health-crypto';

// Audit sécurité 3.1 (29/10/2026) : double authentification
describe('TOTP (RFC 6238)', () => {
  const rfcSecret = Buffer.from('12345678901234567890');

  it('vecteurs officiels de la RFC 6238 (SHA-1)', () => {
    expect(totpCode(rfcSecret, 59_000, 8)).toBe('94287082');
    expect(totpCode(rfcSecret, 1111111109_000, 8)).toBe('07081804');
    expect(totpCode(rfcSecret, 1234567890_000, 8)).toBe('89005924');
    expect(totpCode(rfcSecret, 59_000)).toBe('287082');
  });

  it('base32 aller-retour', () => {
    const buf = randomBytes(20);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    expect(base32Encode(rfcSecret)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('code accepté pendant la période courante, la précédente et la suivante ; refusé au-delà', () => {
    const secret = base32Encode(rfcSecret);
    const t = 1_800_000_000_000;
    expect(verifyTotp(secret, totpCode(secret, t), t)).toBe(Math.floor(t / 30000));
    expect(verifyTotp(secret, totpCode(secret, t - 30000), t)).not.toBeNull();
    expect(verifyTotp(secret, totpCode(secret, t + 30000), t)).not.toBeNull();
    expect(verifyTotp(secret, totpCode(secret, t - 90000), t)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', t)).toBeNull();
    expect(verifyTotp(secret, '', t)).toBeNull();
  });

  it('lien otpauth pour les applications, codes de secours XXXX-XXXX', () => {
    expect(otpauthUrl('ABC', 'a@b.com')).toBe(
      'otpauth://totp/E.doto%20family%3Aa%40b.com?secret=ABC&issuer=E.doto%20family&algorithm=SHA1&digits=6&period=30',
    );
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(8);
    codes.forEach((c) => expect(c).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/));
    expect(hashRecoveryCode('abcd-efgh')).toBe(hashRecoveryCode('ABCDEFGH'));
  });

  it('TOTP_ROLES : rôles listés, « all » pour tous les comptes, vide par défaut', () => {
    expect(totpRequiredRoles('')).toEqual([]);
    expect(totpRequiredRoles(undefined)).toEqual([]);
    expect(totpRequiredRoles('super_admin, doctor,inconnu,customer')).toEqual(['super_admin', 'doctor', 'customer']);
    expect(totpRequiredRoles('all')).toEqual(['super_admin', 'doctor', 'health_center', 'sponsor', 'store_owner', 'staff', 'super_pickuppoint', 'customer']);
    expect(totpRequiredRoles('*')).toHaveLength(8);
  });

  it('TOTP_ROLES=all : un jeune (customer) reçoit aussi le défi', async () => {
    process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'cle-de-test';
    process.env.TOTP_ROLES = 'all';
    const svc = new TotpService({ getPool: () => ({ query: jest.fn() }) } as any);
    expect(svc.challengeFor({ id: 9, role: 'customer', token_version: 0 })).toEqual({ totp_required: true, setup_required: true, challenge: expect.any(String) });
    delete process.env.TOTP_ROLES;
    expect(svc.challengeFor({ id: 9, role: 'customer', token_version: 0 })).toBeNull();
  });
});

describe('Connexion avec double authentification', () => {
  const ENV = { ...process.env };
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  let hash: string;

  beforeAll(async () => {
    process.env.JWT_SECRET_KEY = 'cle-de-test';
    hash = await bcrypt.hash('Motdepasse1!', 4);
  });
  afterEach(() => {
    process.env.TOTP_ROLES = ENV.TOTP_ROLES;
  });
  afterAll(() => {
    process.env = ENV;
  });

  const db = (user: any, extra: (sql: string, params: any[]) => any = () => [{ affectedRows: 1 }]) => {
    const query = jest.fn(async (sql: string, params: any[] = []) => {
      if (sql.startsWith('SELECT * FROM users')) return [[user]];
      return extra(sql, params);
    });
    return { db: { query, getPool: () => ({ query }) } as any, query };
  };

  const admin = (over: any = {}) => ({ id: 3, email: 'a@edoto.com', role: 'super_admin', is_active: 1, is_verified: 1, token_version: 2, password: hash, ...over });

  it('par défaut (TOTP_ROLES vide, non activée) : connexion inchangée', async () => {
    delete process.env.TOTP_ROLES;
    const res: any = await new AuthService(db(admin()).db).login('a@edoto.com', 'Motdepasse1!');
    expect(res.token).toEqual(expect.any(String));
    expect(res.permissions).toEqual(['super_admin']);
    expect(res.totp_required).toBeUndefined();
  });

  it('rôle dans TOTP_ROLES, pas encore activée : défi avec activation obligatoire, aucune session', async () => {
    process.env.TOTP_ROLES = 'super_admin';
    const res: any = await new AuthService(db(admin()).db).login('a@edoto.com', 'Motdepasse1!');
    expect(res).toEqual({ totp_required: true, setup_required: true, challenge: expect.any(String) });
    expect(res.token).toBeUndefined();
  });

  it('compte qui l’a activée : défi même si le rôle n’est pas listé ; mauvais mot de passe : refus avant tout défi', async () => {
    delete process.env.TOTP_ROLES;
    const u = admin({ role: 'sponsor', totp_secret: sealHealth(secret), totp_enabled_at: '2026-10-29' });
    const res: any = await new AuthService(db(u).db).login('a@edoto.com', 'Motdepasse1!');
    expect(res.totp_required).toBe(true);
    expect(res.setup_required).toBe(false);
    await expect(new AuthService(db(u).db).login('a@edoto.com', 'faux')).rejects.toThrow('Identifiants invalides');
  });

  it('compte bloqué : refusé avant le défi (pas de double authentification pour un compte bloqué)', async () => {
    process.env.TOTP_ROLES = 'super_admin';
    await expect(new AuthService(db(admin({ is_active: 0 })).db).login('a@edoto.com', 'Motdepasse1!')).rejects.toThrow();
  });

  it('le défi n’est jamais accepté comme session (clé distincte et usage marqué)', async () => {
    process.env.TOTP_ROLES = 'super_admin';
    const { challenge }: any = await new AuthService(db(admin()).db).login('a@edoto.com', 'Motdepasse1!');
    expect(() => jwt.verify(challenge, process.env.JWT_SECRET_KEY as string)).toThrow();
    const strategy = new JwtStrategy({ query: jest.fn() } as any);
    await expect(strategy.validate({ ...(jwt.decode(challenge) as any) })).rejects.toThrow('Session expirée');
  });

  it('étape 2 : bon code → session ; même code une 2e fois → refusé ; mauvais code → refusé', async () => {
    const u = admin({ totp_secret: sealHealth(secret), totp_enabled_at: '2026-10-29', totp_last_step: null });
    let lastStep: number | null = null;
    const { db: d } = db(u, (sql, params) => {
      if (sql.startsWith('UPDATE users SET totp_last_step')) {
        const ok = lastStep === null || lastStep < params[2];
        if (ok) lastStep = params[0];
        return [{ affectedRows: ok ? 1 : 0 }];
      }
      if (sql.startsWith('UPDATE totp_recovery_codes')) return [{ affectedRows: 0 }];
      return [{ affectedRows: 1 }];
    });
    const auth = new AuthService(d);
    const challenge = new TotpService(d).challengeFor(u)!.challenge;
    const code = totpCode(secret);
    const res: any = await auth.loginWithTotp(challenge, code);
    expect(res.token).toEqual(expect.any(String));
    await expect(auth.loginWithTotp(challenge, code)).rejects.toThrow('déjà servi');
    await expect(auth.loginWithTotp(challenge, '000000')).rejects.toThrow('Code incorrect');
  });

  it('code de secours : accepté une seule fois', async () => {
    const u = admin({ totp_secret: sealHealth(secret), totp_enabled_at: '2026-10-29' });
    const used = new Set<string>();
    const { db: d } = db(u, (sql, params) => {
      if (sql.startsWith('UPDATE totp_recovery_codes')) {
        const ok = params[1] === hashRecoveryCode('ABCD-EFGH') && !used.has(params[1]);
        if (ok) used.add(params[1]);
        return [{ affectedRows: ok ? 1 : 0 }];
      }
      return [{ affectedRows: 0 }];
    });
    const svc = new TotpService(d);
    await expect(svc.checkCode(u, 'abcd efgh')).resolves.toBe('recovery');
    await expect(svc.checkCode(u, 'ABCD-EFGH')).rejects.toThrow('Code incorrect');
  });

  it('défi expiré ou session révoquée depuis (version changée) : refusé', async () => {
    const u = admin();
    const svc = new TotpService(db({ ...u, token_version: 3 }).db);
    const challenge = new TotpService(db(u).db).challengeFor({ ...u, totp_enabled_at: 'x', totp_secret: 'y' })!.challenge;
    await expect(svc.userFromChallenge(challenge)).rejects.toThrow('Connexion expirée');
    await expect(svc.userFromChallenge('faux')).rejects.toThrow('Connexion expirée');
  });

  it('activation : clé chiffrée en base, premier code juste → activée, 8 codes de secours', async () => {
    const writes: any[] = [];
    const u: any = admin();
    const { db: d } = db(u, (sql, params) => {
      writes.push([sql, params]);
      if (sql.startsWith('UPDATE users SET totp_secret')) u.totp_secret = params[0];
      return [{ affectedRows: 1 }];
    });
    const svc = new TotpService(d);
    const setup = await svc.startSetup(u);
    expect(setup.qr_image).toMatch(/^data:image\/png;base64,/);
    await expect(svc.activate(u, '000000')).rejects.toThrow('Code incorrect');
    const codes = await svc.activate(u, totpCode(setup.secret));
    expect(codes).toHaveLength(8);
    expect(writes.some(([sql]) => sql.startsWith('UPDATE users SET totp_enabled_at'))).toBe(true);
    const insert = writes.find(([sql]) => sql.startsWith('INSERT INTO totp_recovery_codes'));
    expect(insert[1]).not.toContain(codes[0]);
  });
});
