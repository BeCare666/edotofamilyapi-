jest.mock('../auth/mailer', () => ({ sendVerificationEmail: jest.fn().mockResolvedValue(undefined) }));
import { sendVerificationEmail } from '../auth/mailer';
import { InactivityService, NOTICE_DAYS, PURGE_DAYS, inactivityMode, inactivityRoles, touchActivity } from './inactivity';

// Conservation six mois après la fin d'activité (autorisation APDP n° 2026-327/AT/APDP/DST/SC, point a, 30/10/2026)
const mailer = sendVerificationEmail as jest.Mock;

describe('Conservation : comptes inactifs', () => {
  beforeEach(() => mailer.mockClear());

  it('réglages : désactivé par défaut, jeunes seulement par défaut, délais 169 et 183 jours', () => {
    expect(inactivityMode(undefined)).toBe('off');
    expect(inactivityMode('notify')).toBe('notify');
    expect(inactivityMode('ON')).toBe('on');
    expect(inactivityMode('oui')).toBe('off');
    expect(inactivityRoles(undefined)).toEqual(['customer']);
    expect(inactivityRoles('customer,super_pickuppoint')).toEqual(['customer', 'super_pickuppoint']);
    expect([NOTICE_DAYS, PURGE_DAYS]).toEqual([169, 183]);
  });

  it('activité : une écriture par jour au plus, et une nouvelle activité annule la prévenance', async () => {
    const query = jest.fn(async () => [{ affectedRows: 1 }]);
    await touchActivity({ query }, 7);
    const [sql, params] = (query.mock.calls[0] as any);
    expect(sql).toContain('last_activity_at = UTC_TIMESTAMP(), inactivity_notice_at = NULL');
    expect(sql).toContain('INTERVAL 1 DAY');
    expect(params).toEqual([7]);
  });

  it('colonne absente (avant la migration 022) : la connexion n’est jamais bloquée', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(touchActivity({ query: jest.fn(async () => { throw new Error("Unknown column 'last_activity_at'"); }) }, 7)).resolves.toBeUndefined();
    err.mockRestore();
  });

  const service = (notify: any[], purge: any[]) => {
    const conn = { beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(async () => undefined), release: jest.fn(), query: jest.fn(async () => [{}]) };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('inactivity_notice_at IS NULL') && sql.startsWith('SELECT')) return [notify];
      if (sql.includes('inactivity_notice_at IS NOT NULL') && sql.startsWith('SELECT')) return [purge];
      return [{ affectedRows: 1 }];
    });
    const db: any = { getPool: () => ({ query, getConnection: async () => conn }) };
    return { svc: new InactivityService(db), query, conn };
  };

  it('mode « off » : compte seulement, aucun e-mail, aucune modification', async () => {
    const { svc, query, conn } = service([{ id: 1, name: 'A', email: 'a@x.io' }], [{ id: 2 }]);
    const r = await svc.run('off');
    expect(r).toMatchObject({ to_notify: 1, to_purge: 1, notified: 0, anonymized: 0 });
    expect(mailer).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => !String(sql).startsWith('SELECT'))).toBe(false);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it('mode « notify » : e-mail de prévenance et date notée, pas d’anonymisation', async () => {
    const { svc, query, conn } = service([{ id: 1, name: 'Awa', email: 'a@x.io' }], [{ id: 2 }]);
    const r = await svc.run('notify');
    expect(r.notified).toBe(1);
    expect(mailer.mock.calls[0][0].email).toBe('a@x.io');
    expect(mailer.mock.calls[0][0].message).toContain('2026-327/AT/APDP/DST/SC');
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE users SET inactivity_notice_at'))).toBe(true);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it('mode « on » : identité effacée (compte, profil, adresses, double authentification), commandes non touchées', async () => {
    const { svc, conn } = service([], [{ id: 2 }]);
    const r = await svc.run('on');
    expect(r.anonymized).toBe(1);
    const sqls = conn.query.mock.calls.map(([sql]: any) => String(sql));
    expect(sqls[0]).toContain("name = 'Compte supprimé'");
    expect(sqls[0]).toContain('birth_date = NULL');
    expect(sqls[0]).toContain('token_version = token_version + 1');
    expect(sqls.some((q) => q.startsWith('UPDATE profiles SET bio = NULL'))).toBe(true);
    expect(sqls.some((q) => q.startsWith('DELETE FROM addresses'))).toBe(true);
    expect(sqls.some((q) => /orders|payment_intents|invoices/.test(q))).toBe(false);
    expect(conn.commit).toHaveBeenCalled();
  });
});
