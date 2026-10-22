process.env.JWT_SECRET_KEY = 'test-secret';
jest.mock('./mailer', () => ({ sendVerificationEmail: jest.fn().mockResolvedValue(undefined) }));

import { AuthService } from './auth.service';
import { sendVerificationEmail } from './mailer';
import {
  RESET_INVALID_MESSAGE,
  RESET_REQUEST_MESSAGE,
  hashResetCode,
  newResetCode,
  resetCodeMatches,
} from './password-reset-rules';

const sent = sendVerificationEmail as jest.Mock;

// Base simulée : users + password_resets (audit sécurité C4, 22/10/2026)
function fakeDb(users: { id: number; email: string }[]) {
  let nextId = 1;
  let resets: { id: number; email: string; otp: string; attempts: number }[] = [];
  const updates: any[][] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('FROM users WHERE LOWER(email)')) return [users.filter((u) => u.email.toLowerCase() === params[0]), []];
    if (sql.startsWith('DELETE FROM password_resets')) {
      resets = resets.filter((r) => r.email !== params[0]);
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO password_resets')) {
      resets.push({ id: nextId++, email: params[0], otp: params[1], attempts: 0 });
      return [{ insertId: nextId }, []];
    }
    if (sql.includes('FROM password_resets')) return [resets.filter((r) => r.email === params[0]).slice(-1), []];
    if (sql.startsWith('UPDATE password_resets SET attempts')) {
      resets.forEach((r) => r.id === params[0] && r.attempts++);
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('UPDATE users SET password')) {
      updates.push(params);
      return [{ affectedRows: 1 }, []];
    }
    return [[], []];
  });
  return { db: { query, getPool: () => ({ query }) } as any, resets: () => resets, updates };
}

// Code envoyé par e-mail, relu dans le message simulé (seul dans son bloc, pas une couleur #111827)
const lastCode = () => String(sent.mock.calls[sent.mock.calls.length - 1][0].message).match(/>\s*(\d{6})\s*</)[1];

let n = 0;
const uniqueEmail = () => `user${++n}-${Date.now()}@t.io`;

beforeEach(() => sent.mockClear());

describe('règles du code de réinitialisation', () => {
  it('code à 6 chiffres, empreinte SHA-256 de 64 caractères, comparaison exacte', () => {
    for (let i = 0; i < 50; i++) expect(newResetCode()).toMatch(/^[1-9]\d{5}$/);
    const h = hashResetCode('123456');
    expect(h).toHaveLength(64);
    expect(resetCodeMatches('123456', h)).toBe(true);
    expect(resetCodeMatches(' 123456 ', h)).toBe(true);
    expect(resetCodeMatches('123457', h)).toBe(false);
    expect(resetCodeMatches('123456', 'abc')).toBe(false);
  });
});

describe('POST /forget-password', () => {
  it('réponse identique pour une adresse inconnue, aucun e-mail envoyé', async () => {
    const { db } = fakeDb([]);
    const res = await new AuthService(db).forgetPassword({ email: uniqueEmail() });
    expect(res).toEqual({ success: true, message: RESET_REQUEST_MESSAGE });
    expect(sent).not.toHaveBeenCalled();
  });

  it('adresse connue (casse ignorée) : code stocké haché, jamais en clair', async () => {
    const email = uniqueEmail();
    const { db, resets } = fakeDb([{ id: 5, email }]);
    const res = await new AuthService(db).forgetPassword({ email: `  ${email.toUpperCase()} ` });
    expect(res).toEqual({ success: true, message: RESET_REQUEST_MESSAGE });
    const code = lastCode();
    expect(resets()).toHaveLength(1);
    expect(resets()[0].otp).toBe(hashResetCode(code));
    expect(resets()[0].otp).not.toContain(code);
  });

  it('deuxième demande dans la minute : même réponse, pas de nouvel e-mail', async () => {
    const email = uniqueEmail();
    const { db } = fakeDb([{ id: 5, email }]);
    const svc = new AuthService(db);
    await svc.forgetPassword({ email });
    const again = await svc.forgetPassword({ email });
    expect(again).toEqual({ success: true, message: RESET_REQUEST_MESSAGE });
    expect(sent).toHaveBeenCalledTimes(1);
  });
});

describe('vérification et réinitialisation', () => {
  it('bon code accepté, mot de passe changé, code détruit après usage', async () => {
    const email = uniqueEmail();
    const { db, resets, updates } = fakeDb([{ id: 5, email }]);
    const svc = new AuthService(db);
    await svc.forgetPassword({ email });
    const code = lastCode();
    expect(await svc.verifyForgetPasswordToken({ email, token: code })).toEqual({ success: true, message: 'Code valide' });
    const res = await svc.resetPassword({ email, token: code, password: 'Nouveau1!pass' });
    expect(res.success).toBe(true);
    expect(updates).toHaveLength(1);
    expect(resets()).toHaveLength(0);
    expect((await svc.resetPassword({ email, token: code, password: 'Nouveau1!pass' })).success).toBe(false);
  });

  it('5 mauvais essais : le code est détruit, même le bon code est ensuite refusé', async () => {
    const email = uniqueEmail();
    const { db, resets, updates } = fakeDb([{ id: 5, email }]);
    const svc = new AuthService(db);
    await svc.forgetPassword({ email });
    const code = lastCode();
    const wrong = code === '111111' ? '222222' : '111111';
    for (let i = 0; i < 5; i++) {
      expect(await svc.verifyForgetPasswordToken({ email, token: wrong })).toEqual({ success: false, message: RESET_INVALID_MESSAGE });
    }
    expect(resets()).toHaveLength(0);
    expect((await svc.verifyForgetPasswordToken({ email, token: code })).success).toBe(false);
    expect((await svc.resetPassword({ email, token: code, password: 'Nouveau1!pass' })).success).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('la route de vérification ne répond plus « Token verified » sans contrôle', async () => {
    const { db } = fakeDb([]);
    const res = await new AuthService(db).verifyForgetPasswordToken({ email: uniqueEmail(), token: '123456' });
    expect(res).toEqual({ success: false, message: RESET_INVALID_MESSAGE });
  });
});
