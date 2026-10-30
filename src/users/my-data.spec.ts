import * as bcrypt from 'bcrypt';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { MyDataService, cleanRow } from './my-data';

// Droits des personnes (autorisation APDP n° 2026-327/AT/APDP/DST/SC, point f, 30/10/2026)
function setup(user: any, tables: Record<string, any[]> = {}) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT id, name, email') || sql.startsWith('SELECT id, role, password')) return [user ? [user] : []];
    const t = Object.keys(tables).find((name) => sql.includes(`FROM ${name} `));
    if (t) return [tables[t]];
    if (sql.startsWith('SELECT')) return [[]];
    return [{ affectedRows: 1 }];
  });
  const inactivity = { anonymize: jest.fn(async () => undefined) };
  const svc = new MyDataService({ getPool: () => ({ query }) } as any, inactivity as any);
  return { svc, calls, inactivity };
}

describe('Mes données : téléchargement', () => {
  it('retire secrets, codes de retrait et salles de visio', () => {
    expect(cleanRow({ id: 1, otp_code: '123456', password: 'x', totp_secret: 's', room: 'r', total: 5 })).toEqual({ id: 1, total: 5 });
  });

  it('rassemble les parties du compte, note la demande', async () => {
    const { svc, calls } = setup(
      { id: 7, name: 'Awa', email: 'awa@t.io', role: 'customer' },
      { orders: [{ id: 3, total: 1500, otp_code: '999999' }], campaign_registrations: [{ id: 9, email: 'awa@t.io' }], contraception_requests: [] },
    );
    const data = await svc.exportData(7, '1.2.3.4');
    expect(data.account).toMatchObject({ id: 7, email: 'awa@t.io' });
    expect(data.orders).toEqual([{ id: 3, total: 1500 }]);
    expect(data.kit_requests).toEqual([{ id: 9, email: 'awa@t.io' }]);
    expect(data.contraception_followups).toEqual([]);
    expect(calls.find((c) => c.sql.includes('FROM campaign_registrations'))?.params).toEqual(['awa@t.io']);
    expect(calls.find((c) => c.sql.startsWith('INSERT INTO data_rights_log'))?.params).toEqual([7, 'export', '1.2.3.4']);
  });

  it('une table illisible est signalée dans le fichier', async () => {
    const { svc } = setup({ id: 7, name: 'Awa', email: 'awa@t.io', role: 'customer' });
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (svc as any).db.getPool().query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT id, name, email')) return [[{ id: 7, email: 'awa@t.io' }]];
      if (sql.includes('FROM tc_reports')) throw new Error("Table 'tc_reports' doesn't exist");
      return [[]];
    });
    const data: any = await svc.exportData(7, null);
    expect(data.consultation_reports).toHaveProperty('indisponible');
    err.mockRestore();
  });
});

describe('Mes données : suppression du compte', () => {
  it('jeune : mot de passe exigé, puis identité effacée et demande notée', async () => {
    const hash = await bcrypt.hash('Edoto2026', 4);
    const { svc, calls, inactivity } = setup({ id: 7, role: 'customer', password: hash });
    await expect(svc.deleteAccount(7, 'mauvais', null)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.deleteAccount(7, undefined, null)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(inactivity.anonymize).not.toHaveBeenCalled();

    const res = await svc.deleteAccount(7, 'Edoto2026', '1.2.3.4');
    expect(res.success).toBe(true);
    expect(inactivity.anonymize).toHaveBeenCalledWith(7);
    expect(calls.find((c) => c.sql.startsWith('INSERT INTO data_rights_log'))?.params).toEqual([7, 'delete', '1.2.3.4']);
  });

  it('autres comptes (point de retrait, sponsor, médecin…) : renvoyés vers l’équipe, rien n’est effacé', async () => {
    const { svc, inactivity } = setup({ id: 8, role: 'super_pickuppoint', password: 'x' });
    await expect(svc.deleteAccount(8, 'x', null)).rejects.toBeInstanceOf(ForbiddenException);
    expect(inactivity.anonymize).not.toHaveBeenCalled();
  });
});
