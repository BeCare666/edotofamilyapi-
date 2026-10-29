jest.mock('./mailer', () => ({ sendVerificationEmail: jest.fn().mockResolvedValue(undefined) }));
import * as bcrypt from 'bcrypt';
import { sendVerificationEmail } from './mailer';
import { AuthService } from './auth.service';
import { codeMatches, consumeChallenge, emailHint, isTrustedDevice, newDeviceChallenge, newDeviceRoles, readDeviceChallenge, signTrustedDevice } from './device-check';

// Nouvel appareil (décision du 29/10/2026) : jeunes et points de retrait reçoivent un code par e-mail
const mailer = sendVerificationEmail as jest.Mock;

describe('Nouvel appareil : code par e-mail', () => {
  const ENV = { ...process.env };
  let hash: string;
  beforeAll(async () => {
    process.env.JWT_SECRET_KEY = 'cle-de-test';
    delete process.env.TOTP_ROLES;
    delete process.env.NEW_DEVICE_ROLES;
    hash = await bcrypt.hash('Motdepasse1!', 4);
  });
  afterAll(() => {
    process.env = ENV;
  });
  beforeEach(() => mailer.mockClear());

  const youth = { id: 7, email: 'jeune@gmail.com', role: 'customer', is_active: 1, token_version: 1 };
  const auth = (user: any) => {
    const query = jest.fn(async () => [[{ ...user, password: hash }]]);
    return new AuthService({ query, getPool: () => ({ query }) } as any);
  };
  const codeFromMail = () => String(mailer.mock.calls[mailer.mock.calls.length - 1][0].message.match(/>(\d{6})</)[1]);

  it('rôles : jeunes et points de retrait par défaut ; « off » désactive ; liste réglable', () => {
    expect(newDeviceRoles(undefined)).toEqual(['customer', 'super_pickuppoint']);
    expect(newDeviceRoles('off')).toEqual([]);
    expect(newDeviceRoles('customer')).toEqual(['customer']);
  });

  it('appareil inconnu : pas de session, code envoyé par e-mail, adresse masquée', async () => {
    const res: any = await auth(youth).login('jeune@gmail.com', 'Motdepasse1!');
    expect(res).toEqual({ device_check_required: true, challenge: expect.any(String), email_hint: 'j***@gmail.com' });
    expect(res.token).toBeUndefined();
    expect(mailer).toHaveBeenCalledTimes(1);
    expect(mailer.mock.calls[0][0].email).toBe('jeune@gmail.com');
    expect(res.challenge).not.toContain(codeFromMail());
  });

  it('bon code → session et appareil reconnu ; ensuite plus de code pendant 30 jours ; code réutilisé refusé', async () => {
    const a = auth(youth);
    const { challenge }: any = await a.login('jeune@gmail.com', 'Motdepasse1!');
    const res: any = await a.loginWithDeviceCode(challenge, codeFromMail());
    expect(res.token).toEqual(expect.any(String));
    expect(res.device_token).toEqual(expect.any(String));
    await expect(a.loginWithDeviceCode(challenge, codeFromMail())).rejects.toThrow('déjà servi');
    mailer.mockClear();
    const again: any = await a.login('jeune@gmail.com', 'Motdepasse1!', res.device_token);
    expect(again.token).toEqual(expect.any(String));
    expect(mailer).not.toHaveBeenCalled();
  });

  it('mauvais code, défi falsifié : refusé', async () => {
    const a = auth(youth);
    const { challenge }: any = await a.login('jeune@gmail.com', 'Motdepasse1!');
    const wrong = codeFromMail() === '000000' ? '111111' : '000000';
    await expect(a.loginWithDeviceCode(challenge, wrong)).rejects.toThrow('Code incorrect');
    await expect(a.loginWithDeviceCode('faux', codeFromMail())).rejects.toThrow('Code expiré');
  });

  it('appareil d’un autre compte ou d’avant un changement de mot de passe (version) : refusé', () => {
    const t = signTrustedDevice(youth);
    expect(isTrustedDevice(t, youth)).toBe(true);
    expect(isTrustedDevice(t, { ...youth, id: 8 })).toBe(false);
    expect(isTrustedDevice(t, { ...youth, token_version: 2 })).toBe(false);
    expect(isTrustedDevice('faux', youth)).toBe(false);
  });

  it('professionnel (sponsor confirmé) : pas de code par e-mail (il relève de TOTP_ROLES)', async () => {
    const res: any = await auth({ ...youth, role: 'sponsor', is_verified: 1 }).login('jeune@gmail.com', 'Motdepasse1!');
    expect(res.token).toEqual(expect.any(String));
    expect(mailer).not.toHaveBeenCalled();
  });

  it('envoi impossible : connexion refusée (jamais de session sans code)', async () => {
    mailer.mockRejectedValueOnce(new Error('Brevo 401'));
    await expect(auth(youth).login('jeune@gmail.com', 'Motdepasse1!')).rejects.toThrow("n'a pas pu être envoyé");
  });

  it('outils : code de 6 chiffres comparé à son empreinte, défi à usage unique, adresse masquée', () => {
    const { code, challenge } = newDeviceChallenge(youth);
    const c = readDeviceChallenge(challenge)!;
    expect(codeMatches(c, code)).toBe(true);
    expect(codeMatches(c, 'abcdef')).toBe(false);
    expect(consumeChallenge(c.jti)).toBe(true);
    expect(consumeChallenge(c.jti)).toBe(false);
    expect(emailHint('ab@c.org')).toBe('a***@c.org');
  });
});
