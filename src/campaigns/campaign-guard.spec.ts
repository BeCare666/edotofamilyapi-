jest.mock('../auth/mailer', () => ({ sendVerificationEmail: jest.fn().mockResolvedValue(undefined) }));

import { sendVerificationEmail } from '../auth/mailer';
import { CampaignsService } from './campaigns.service';
import { ALREADY_REGISTERED_MESSAGE, SAME_DEVICE_MESSAGE, buildGuardKeys, clientIpFrom, guardHash } from './campaign-guard';

type Handler = (sql: string, params: any[]) => any;

function fakeDb(handler: Handler) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    const out = handler(sql, params);
    if (out instanceof Error) throw out;
    return [out ?? [], []];
  });
  const conn = { query, beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(async () => undefined), release: jest.fn() };
  const pool = { query, getConnection: jest.fn(async () => conn) };
  return { calls, conn, db: { getPool: () => pool, query } as any };
}

const mailer = sendVerificationEmail as jest.Mock;
const DEVICE = 'b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const FP = 'a'.repeat(64);
const DTO = { campaign_id: 1, pickup_center: '20', city: 'Cotonou', device_id: DEVICE, device_fingerprint: FP };

// Base « demande valide » ; overrides : réponses particulières par fragment de requête
function scenario(over: { status?: string; center?: any; existingEmail?: boolean; usedKinds?: string[]; guardInsert?: any } = {}) {
  return fakeDb((sql) => {
    if (sql.includes('FROM campaigns c WHERE c.id')) return [{ id: 1, status: over.status ?? 'en_cours' }];
    if (sql.includes('FROM campaign_locations WHERE campaign_id')) return [{ city: 'Cotonou' }];
    if (sql.includes('SELECT name, role, is_active')) return over.center ?? [{ name: 'Point A', role: 'super_pickuppoint', is_active: 1, pickup_approved: 1 }];
    if (sql.includes('SELECT name, email FROM users')) return [{ name: 'Awa', email: 'Awa@T.io' }];
    if (sql.includes('SELECT email FROM users')) return [{ email: 'awa@t.io' }];
    if (sql.includes('FROM campaign_registrations WHERE campaign_id = ? AND LOWER(email)')) return over.existingEmail ? [{ id: 9 }] : [];
    if (sql.includes('SELECT DISTINCT kind FROM campaign_registration_guards')) return (over.usedKinds ?? []).map((kind) => ({ kind }));
    if (sql.startsWith('INSERT INTO campaign_registrations')) return { insertId: 40 };
    if (sql.startsWith('INSERT INTO campaign_registration_guards')) return over.guardInsert ?? { affectedRows: 5 };
    return [];
  });
}

beforeEach(() => {
  mailer.mockReset();
  mailer.mockResolvedValue(undefined);
  delete process.env.CAMPAIGN_GUARD_IP;
  delete process.env.CAMPAIGN_GUARD_FINGERPRINT;
});

describe('Marques anti-doublon', () => {
  it('compte, e-mail (minuscules), appareil, navigateur, IP ; empreintes SHA-256 seulement', () => {
    const keys = buildGuardKeys({ userId: 5, email: ' Awa@T.io ', deviceId: DEVICE, fingerprint: FP, ip: '41.85.1.2' });
    expect(keys.map((k) => k.kind)).toEqual(['user', 'email', 'device', 'fingerprint', 'ip']);
    expect(keys.find((k) => k.kind === 'email').hash).toBe(guardHash('email', 'awa@t.io'));
    for (const k of keys) expect(k.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(keys)).not.toContain('41.85.1.2');
  });

  it('identifiant d’appareil ou empreinte invalides : ignorés ; interrupteurs IP / empreinte', () => {
    expect(buildGuardKeys({ userId: 5, email: 'a@t.io', deviceId: 'court', fingerprint: 'xyz', ip: null }).map((k) => k.kind)).toEqual(['user', 'email']);
    process.env.CAMPAIGN_GUARD_IP = 'off';
    process.env.CAMPAIGN_GUARD_FINGERPRINT = 'OFF';
    expect(buildGuardKeys({ userId: 5, email: 'a@t.io', deviceId: DEVICE, fingerprint: FP, ip: '1.2.3.4' }).map((k) => k.kind)).toEqual(['user', 'email', 'device']);
  });

  it('adresse du client : en-têtes du proxy, sinon connexion', () => {
    expect(clientIpFrom({ headers: { 'x-forwarded-for': '41.85.1.2, 10.0.0.1' } })).toBe('41.85.1.2');
    expect(clientIpFrom({ headers: { 'cf-connecting-ip': '197.1.1.1', 'x-forwarded-for': '9.9.9.9' } })).toBe('197.1.1.1');
    expect(clientIpFrom({ headers: {}, ip: '::ffff:127.0.0.1' })).toBe('127.0.0.1');
    expect(clientIpFrom({ headers: {} })).toBeNull();
  });
});

describe('Demande de kit', () => {
  it('demande valide : demande + 5 marques dans une transaction ; code envoyé par e-mail, jamais renvoyé', async () => {
    const s = scenario();
    const res: any = await new CampaignsService(s.db).register(DTO as any, 5, '41.85.1.2');
    expect(s.conn.beginTransaction).toHaveBeenCalled();
    expect(s.conn.commit).toHaveBeenCalled();
    const g = s.calls.find((c) => c.sql.startsWith('INSERT INTO campaign_registration_guards'));
    expect(g.params[0].map((row: any[]) => row[1])).toEqual(['user', 'email', 'device', 'fingerprint', 'ip']);
    expect(g.params[0].every((row: any[]) => row[0] === 1 && row[3] === 40)).toBe(true);
    expect(mailer).toHaveBeenCalledTimes(1);
    expect(res.otp).toBeUndefined();
    expect(JSON.stringify(res)).not.toMatch(/"\d{6}"/);
    expect(res).toMatchObject({ id: 40, city: 'Cotonou', pickup_center_name: 'Point A' });
  });

  it('campagne à venir ou terminée : refusée avant toute écriture', async () => {
    for (const status of ['a_venir', 'terminee']) {
      const s = scenario({ status });
      await expect(new CampaignsService(s.db).register(DTO as any, 5, null)).rejects.toThrow(status === 'a_venir' ? 'pas encore commencé' : 'terminée');
      expect(s.calls.some((c) => c.sql.startsWith('INSERT'))).toBe(false);
    }
  });

  it('point de retrait : un compte qui n’est pas un point de retrait validé est refusé', async () => {
    for (const center of [[{ name: 'Client', role: 'customer', is_active: 1, pickup_approved: 1 }], [{ name: 'P', role: 'super_pickuppoint', is_active: 1, pickup_approved: 0 }], []]) {
      const s = scenario({ center });
      await expect(new CampaignsService(s.db).register(DTO as any, 5, null)).rejects.toThrow('Centre de retrait introuvable');
      expect(s.calls.some((c) => c.sql.startsWith('INSERT'))).toBe(false);
    }
  });

  it('même e-mail (ancienne demande) : refusée', async () => {
    const s = scenario({ existingEmail: true });
    await expect(new CampaignsService(s.db).register(DTO as any, 5, null)).rejects.toThrow(ALREADY_REGISTERED_MESSAGE);
    expect(s.calls.some((c) => c.sql.startsWith('INSERT'))).toBe(false);
  });

  it('autre compte sur le même appareil / la même connexion : refusée', async () => {
    const s = scenario({ usedKinds: ['device', 'ip'] });
    await expect(new CampaignsService(s.db).register(DTO as any, 6, '41.85.1.2')).rejects.toThrow(SAME_DEVICE_MESSAGE);
    const q = s.calls.find((c) => c.sql.includes('SELECT DISTINCT kind'));
    expect(q.params[0]).toBe(1);
    expect(q.params[1].map((p: any[]) => p[0])).toEqual(['user', 'email', 'device', 'fingerprint', 'ip']);
    expect(s.calls.some((c) => c.sql.startsWith('INSERT'))).toBe(false);
  });

  it('deux demandes simultanées : la clé primaire des marques bloque la seconde (annulation)', async () => {
    const dup: any = new Error('Duplicate entry');
    dup.code = 'ER_DUP_ENTRY';
    const s = scenario({ guardInsert: dup });
    await expect(new CampaignsService(s.db).register(DTO as any, 5, null)).rejects.toThrow(SAME_DEVICE_MESSAGE);
    expect(s.conn.rollback).toHaveBeenCalled();
    expect(s.conn.commit).not.toHaveBeenCalled();
    expect(mailer).not.toHaveBeenCalled();
  });

  it('e-mail impossible : demande et marques supprimées, message clair (500)', async () => {
    mailer.mockRejectedValueOnce(new Error('SMTP down'));
    const s = scenario();
    await expect(new CampaignsService(s.db).register(DTO as any, 5, null)).rejects.toThrow("n'a pas été enregistrée");
    expect(s.calls.some((c) => c.sql.startsWith('DELETE FROM campaign_registration_guards') && c.params[0] === 40)).toBe(true);
    expect(s.calls.some((c) => c.sql.startsWith('DELETE FROM campaign_registrations') && c.params[0] === 40)).toBe(true);
  });
});

describe('Éligibilité et chiffres publics', () => {
  it('éligibilité : déjà demandé / même appareil / campagne fermée / possible', async () => {
    expect(await new CampaignsService(scenario({ existingEmail: true }).db).checkEligibility(1, 5, {}, null)).toMatchObject({ eligible: false, reason: 'already_registered' });
    expect(await new CampaignsService(scenario({ usedKinds: ['fingerprint'] }).db).checkEligibility(1, 5, { device_fingerprint: FP }, null)).toMatchObject({ eligible: false, reason: 'same_device' });
    expect(await new CampaignsService(scenario({ status: 'terminee' }).db).checkEligibility(1, 5, {}, null)).toMatchObject({ eligible: false, reason: 'not_active' });
    expect(await new CampaignsService(scenario().db).checkEligibility(1, 5, { device_id: DEVICE }, '1.2.3.4')).toEqual({ eligible: true });
  });

  it('chiffres publics : toutes les villes (même sans inscrit), totaux, aucune donnée nominative ; campagne terminée invisible', async () => {
    const regs = [
      { created: '2026-10-02 09:00:00', picked: '2026-10-03 10:00:00', picked_up: 1, otp_used: 1, city: 'Cotonou' },
      { created: '2026-10-02 12:00:00', picked: null, picked_up: 0, otp_used: 0, city: 'Cotonou' },
    ];
    const { db } = fakeDb((sql) => {
      if (sql.includes('FROM campaigns c WHERE c.id')) return [{ id: 1, objective_kits: 100, date_start: '2026-10-01', date_end: '2099-12-31', status: 'en_cours' }];
      if (sql.includes('FROM campaign_registrations r WHERE r.campaign_id')) return regs;
      if (sql.includes('SELECT city FROM campaign_locations')) return [{ city: 'Abomey-Calavi' }, { city: 'Cotonou' }];
      return [];
    });
    const st: any = await new CampaignsService(db).getPublicStats(1);
    expect(st).toMatchObject({ objective_kits: 100, registrations: 2, validated: 1, withdrawn: 1 });
    expect(st.by_city).toEqual([
      { label: 'Cotonou', registrations: 2, withdrawn: 1 },
      { label: 'Abomey-Calavi', registrations: 0, withdrawn: 0 },
    ]);
    expect(st.daily[0]).toEqual({ date: '2026-10-01', registrations: 0, withdrawals: 0 });
    expect(JSON.stringify(st)).not.toMatch(/email|full_name|otp_code/);

    const closed = fakeDb((sql) => (sql.includes('FROM campaigns c WHERE c.id') ? [{ id: 1, status: 'terminee' }] : []));
    await expect(new CampaignsService(closed.db).getPublicStats(1)).rejects.toThrow('introuvable');
  });
});
