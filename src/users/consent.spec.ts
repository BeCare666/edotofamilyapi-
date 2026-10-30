process.env.JWT_SECRET_KEY = 'test-secret';
jest.mock('../auth/mailer', () => ({ sendVerificationEmail: jest.fn().mockResolvedValue(undefined) }));
import { BadRequestException } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { SponsorAccountService } from '../sponsors/sponsor-account.service';
import { CONSENT_DOCUMENT, CONSENT_VERSION, recordConsent, requireConsent } from './consent';

// Consentement à la collecte et au transfert (autorisation APDP n° 2026-327/AT/APDP/DST/SC, point b, 30/10/2026)
function fakeDb(insertId = 41) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT')) return [[], []];
    return [{ insertId }, []];
  });
  const conn = { beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(), query };
  const pool = { query, getConnection: jest.fn(async () => conn) };
  return { calls, db: { getPool: () => pool, query } as any };
}

const consentRow = (calls: { sql: string; params: any[] }[]) => calls.find((c) => c.sql.includes('INSERT INTO user_consents'));

describe('Consentement à l’inscription', () => {
  it('refuse toute valeur autre que true', () => {
    for (const v of [undefined, false, 'true', 1, null]) {
      expect(() => requireConsent({ consent: v })).toThrow(BadRequestException);
    }
    expect(() => requireConsent({ consent: true })).not.toThrow();
  });

  it('jeune : sans consentement, rien n’est écrit ; avec, la preuve est enregistrée (compte, document, version, IP)', async () => {
    const body = { name: 'Awa Houndé', email: 'awa@t.io', password: 'Edoto2026', birth_date: '2005-02-28', sex: 'female' };
    const a = fakeDb();
    await expect(new AuthService(a.db).register(body as any, '1.2.3.4')).rejects.toThrow('consentement');
    expect(a.calls).toHaveLength(0);

    const b = fakeDb();
    await new AuthService(b.db).register({ ...body, consent: true } as any, '1.2.3.4');
    expect(consentRow(b.calls)?.params).toEqual([41, CONSENT_DOCUMENT, CONSENT_VERSION, '1.2.3.4']);
  });

  it('point de retrait : même règle', async () => {
    const body = { name: 'Pharmacie X', email: 'p@x.io', password: 'Secret2026' };
    const a = fakeDb();
    await expect(new AuthService(a.db).registerPickUpPoint(body as any)).rejects.toThrow('consentement');
    expect(a.calls).toHaveLength(0);

    const b = fakeDb(52);
    await new AuthService(b.db).registerPickUpPoint({ ...body, consent: true } as any, '5.6.7.8');
    expect(consentRow(b.calls)?.params).toEqual([52, CONSENT_DOCUMENT, CONSENT_VERSION, '5.6.7.8']);
  });

  it('sponsor : même règle', async () => {
    const body = { organization: 'Fondation Test', contact_name: 'Awa Test', phone: '+229 01 97 00 00 00', email: 'c@f.test', password: 'Motdepasse1' };
    const a = fakeDb();
    await expect(new SponsorAccountService(a.db).signup(body)).rejects.toThrow('consentement');
    expect(a.calls).toHaveLength(0);

    const b = fakeDb(63);
    await new SponsorAccountService(b.db).signup({ ...body, consent: true }, null);
    expect(consentRow(b.calls)?.params).toEqual([63, CONSENT_DOCUMENT, CONSENT_VERSION, null]);
  });

  it('table absente (avant la migration 023) : l’inscription n’est pas bloquée', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(recordConsent({ query: jest.fn(async () => { throw new Error("Table 'user_consents' doesn't exist"); }) }, 7, null)).resolves.toBeUndefined();
    err.mockRestore();
  });
});
