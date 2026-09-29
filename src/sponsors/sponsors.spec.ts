process.env.JWT_SECRET_KEY = 'test-secret';
jest.mock('../auth/mailer', () => ({ sendVerificationEmail: jest.fn().mockResolvedValue(undefined) }));

import * as bcrypt from 'bcrypt';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { sendVerificationEmail } from '../auth/mailer';
import { SponsorAccountService } from './sponsor-account.service';
import { SponsorSpaceService } from './sponsor-space.service';
import { SponsorExportsAdminService } from './sponsor-exports-admin.service';
import { SponsorSpaceController, SponsorsAdminController } from './sponsors.controller';
import { AuthService } from '../auth/auth.service';
import { ROLES_KEY, SPONSOR, SUPER_ADMIN } from '../auth/roles.decorator';
import { dailySeries, lastMonths, prediction, sha256 } from './sponsor-rules';

type Handler = (sql: string, params: any[]) => any;
function fakeDb(handler: Handler) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    return [handler(sql, params) ?? [], []];
  });
  return { calls, db: { getPool: () => ({ query }), query } as any };
}
const mailer = sendVerificationEmail as jest.Mock;
beforeEach(() => mailer.mockClear());

describe('Règles de l’espace sponsor', () => {
  it('prévision : seulement en cours ET lancée depuis au moins 7 jours (décision 6)', () => {
    const base = { dateStart: '2026-09-01', dateEnd: '2026-09-30', withdrawn: 20, objective: 100 };
    expect(prediction({ ...base, status: 'a_venir', today: '2026-09-10' }).available).toBe(false);
    expect(prediction({ ...base, status: 'terminee', today: '2026-10-10' }).available).toBe(false);
    expect(prediction({ ...base, status: 'en_cours', today: '2026-09-07' })).toEqual(expect.objectContaining({ available: false }));
    const p: any = prediction({ ...base, status: 'en_cours', today: '2026-09-11' }); // 10 jours, 2/jour, 19 jours restants
    expect(p).toEqual(expect.objectContaining({ available: true, rate_per_day: 2, days_elapsed: 10, days_remaining: 19, projected_withdrawals: 58, projected_percent_of_objective: 58 }));
    expect(prediction({ ...base, dateEnd: null, status: 'en_cours', today: '2026-09-11' }).available).toBe(false);
  });

  it('séries quotidiennes cumulées, à l’heure du Bénin', () => {
    const s = dailySeries('2026-09-01', '2026-09-03', '2026-09-10', ['2026-08-31 23:30:00', '2026-09-02 10:00:00'], ['2026-09-03 08:00:00']);
    expect(s).toEqual([
      { date: '2026-09-01', registrations: 1, withdrawals: 0 },
      { date: '2026-09-02', registrations: 2, withdrawals: 0 },
      { date: '2026-09-03', registrations: 2, withdrawals: 1 },
    ]);
    expect(lastMonths('2026-02-15', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
  });
});

describe('Invitation et activation du compte sponsor', () => {
  it('crée un compte « sponsor » (connexion impossible avant activation), lien secret par e-mail, empreinte seule en base', async () => {
    process.env.FRONTEND_CALLBACK_URL = 'https://edoto.test';
    const { db, calls } = fakeDb((sql) => {
      if (sql.startsWith('SELECT id, name, email, user_id, activated_at FROM sponsors')) return [{ id: 3, name: 'ONG A', email: 'a@ong.org', user_id: null, activated_at: null }];
      if (sql.startsWith('SELECT id, role FROM users')) return [];
      if (sql.startsWith('INSERT INTO users')) return { insertId: 99 };
      return {};
    });
    const res = await new SponsorAccountService(db).invite(3);
    expect(res.message).toContain('a@ong.org');
    const user = calls.find((c) => c.sql.startsWith('INSERT INTO users'));
    expect(user.sql).toContain("'sponsor'");
    expect(user.params[2]).toMatch(/^!invitation-/);
    const link = mailer.mock.calls[0][0].message.match(/https:\/\/edoto\.test\/sponsor\/activation\?token=([A-Za-z0-9_-]+)/);
    expect(link).toBeTruthy();
    const inv = calls.find((c) => c.sql.startsWith('INSERT INTO sponsor_invitations'));
    expect(inv.params[1]).toBe(sha256(link[1]));
    expect(inv.params).not.toContain(link[1]);
  });

  it('adresse déjà utilisée par un autre type de compte : refus, aucun rôle modifié', async () => {
    const { db, calls } = fakeDb((sql) => {
      if (sql.startsWith('SELECT id, name, email, user_id, activated_at FROM sponsors')) return [{ id: 3, name: 'ONG A', email: 'a@ong.org', user_id: null, activated_at: null }];
      if (sql.startsWith('SELECT id, role FROM users')) return [{ id: 5, role: 'customer' }];
      return {};
    });
    await expect(new SponsorAccountService(db).invite(3)).rejects.toBeInstanceOf(ConflictException);
    expect(calls.some((c) => c.sql.startsWith('UPDATE users') || c.sql.startsWith('INSERT INTO users'))).toBe(false);
  });

  it('compte déjà actif : pas de nouvelle invitation', async () => {
    const { db } = fakeDb(() => [{ id: 3, name: 'A', email: 'a@o.org', user_id: 9, activated_at: new Date() }]);
    await expect(new SponsorAccountService(db).invite(3)).rejects.toThrow('déjà actif');
  });

  it('activation : mot de passe ≥ 8 caractères, lien valide, lien supprimé ensuite', async () => {
    const token = 'x'.repeat(43);
    const { db, calls } = fakeDb((sql) => {
      if (sql.includes('FROM sponsor_invitations i JOIN sponsors s')) return [{ sponsor_id: 3, name: 'A', email: 'a@o.org', user_id: 9 }];
      if (sql.startsWith('UPDATE users')) return { affectedRows: 1 };
      return {};
    });
    const svc = new SponsorAccountService(db);
    await expect(svc.accept({ token, password: 'court' })).rejects.toBeInstanceOf(BadRequestException);
    await svc.accept({ token, password: 'MotDePasse2026' });
    const up = calls.find((c) => c.sql.startsWith('UPDATE users'));
    expect(up.sql).toContain("role = 'sponsor'");
    expect(await bcrypt.compare('MotDePasse2026', up.params[0])).toBe(true);
    expect(calls.some((c) => c.sql.startsWith('DELETE FROM sponsor_invitations'))).toBe(true);
    const expired = fakeDb(() => []);
    await expect(new SponsorAccountService(expired.db).accept({ token, password: 'MotDePasse2026' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('connexion : un compte sponsor reçoit un jeton « sponsor »', async () => {
    const hash = await bcrypt.hash('MotDePasse2026', 4);
    const { db } = fakeDb(() => [{ id: 9, email: 'a@o.org', password: hash, role: 'sponsor', is_active: 1 }]);
    const res: any = await new AuthService(db).login('a@o.org', 'MotDePasse2026');
    expect(res.permissions).toEqual(['sponsor']);
  });
});

describe('Espace sponsor : périmètre et export', () => {
  const CAMP = { id: 7, title: 'Campagne A', date_start: '2026-01-01', date_end: '2026-01-31', objective_kits: 100, status: 'terminee', contribution: '50000', cities_raw: 'Cotonou', registrations: 4, validated: 2, withdrawn: 1, export_status: null };
  const space = (handler: Handler) => {
    const f = fakeDb(handler);
    const excel = { exportCampaign: jest.fn().mockResolvedValue({ filename: 'c.xlsx', buffer: Buffer.from('x') }) };
    return { ...f, excel, svc: new SponsorSpaceService(f.db, excel as any) };
  };

  it('campagnes : uniquement celles que le sponsor soutient (filtre sur sponsor_id) ; autre campagne → introuvable', async () => {
    const { svc, calls } = space((sql) => (sql.includes('FROM campaign_sponsors cs JOIN campaigns c') ? [] : []));
    await expect(svc.analytics(3, 8)).rejects.toBeInstanceOf(NotFoundException);
    expect(calls[0].sql).toContain('WHERE cs.sponsor_id = ?');
    expect(calls[0].params).toEqual([3, 8]);
  });

  it('accueil : budget = somme de SES contributions ; statuts comptés', async () => {
    const { svc } = space((sql) => {
      if (sql.includes('FROM campaign_sponsors cs JOIN campaigns c')) return [CAMP, { ...CAMP, id: 8, status: 'en_cours', contribution: '25000', withdrawn: 3 }];
      return [];
    });
    const s: any = await svc.summary(3);
    expect(s.totals).toEqual(expect.objectContaining({ campaigns: 2, terminee: 1, en_cours: 1, contributions: 75000, objective_kits: 200, withdrawn: 4, withdrawal_rate: 2 }));
    expect(s.monthly_withdrawals).toHaveLength(12);
  });

  it('analyse : chiffres et graphiques uniquement (aucun nom ni e-mail)', async () => {
    const { svc, calls } = space((sql) => {
      if (sql.includes('FROM campaign_sponsors cs JOIN campaigns c')) return [CAMP];
      if (sql.includes('FROM campaign_registrations r LEFT JOIN users pc')) return [
        { created: '2026-01-02 10:00:00', picked: '2026-01-04 10:00:00', picked_up: 1, otp_used: 1, city: 'Cotonou', point_name: 'Point A' },
        { created: '2026-01-03 10:00:00', picked: null, picked_up: 0, otp_used: 0, city: null, point_name: 'Point A' },
      ];
      return [];
    });
    const a: any = await svc.analytics(3, 7);
    const regQuery = calls.find((c) => c.sql.includes('FROM campaign_registrations r LEFT JOIN users pc'));
    expect(regQuery.sql).not.toMatch(/full_name|email/);
    expect(a.indicators.average_delay_days).toBe(2);
    expect(a.by_city.map((g: any) => g.label)).toEqual(['Cotonou', 'Non renseignée']);
    expect(a.prediction.available).toBe(false);
    expect(JSON.stringify(a)).not.toMatch(/@/);
  });

  it('demande d’export : seulement si la campagne est terminée ; redemandable après refus', async () => {
    const running = space((sql) => (sql.includes('FROM campaign_sponsors cs JOIN campaigns c') ? [{ ...CAMP, status: 'en_cours' }] : []));
    await expect(running.svc.requestExport(3, 7)).rejects.toThrow('terminée');

    const again = space((sql) => {
      if (sql.includes('FROM campaign_sponsors cs JOIN campaigns c')) return [CAMP];
      if (sql.startsWith('SELECT id, status FROM sponsor_export_requests')) return [{ id: 4, status: 'rejected' }];
      return {};
    });
    const r = await again.svc.requestExport(3, 7);
    expect(r.status).toBe('pending');
    expect(again.calls.some((c) => c.sql.startsWith("UPDATE sponsor_export_requests SET status = 'pending'"))).toBe(true);
  });

  it('téléchargement : refusé sans acceptation, autorisé ensuite (sans limite)', async () => {
    const pending = space((sql) => {
      if (sql.includes('FROM campaign_sponsors cs JOIN campaigns c')) return [CAMP];
      if (sql.startsWith('SELECT status FROM sponsor_export_requests')) return [{ status: 'pending' }];
      return [];
    });
    await expect(pending.svc.download(3, 7)).rejects.toBeInstanceOf(ForbiddenException);
    expect(pending.excel.exportCampaign).not.toHaveBeenCalled();

    const ok = space((sql) => {
      if (sql.includes('FROM campaign_sponsors cs JOIN campaigns c')) return [CAMP];
      if (sql.startsWith('SELECT status FROM sponsor_export_requests')) return [{ status: 'approved' }];
      return [];
    });
    await ok.svc.download(3, 7);
    await ok.svc.download(3, 7);
    expect(ok.excel.exportCampaign).toHaveBeenCalledTimes(2);
  });

  it('compte sans fiche sponsor : accès refusé', async () => {
    const { svc } = space(() => []);
    await expect(svc.sponsorFor(9)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('Admin : validation des demandes d’export', () => {
  const REQ = { id: 4, status: 'pending', title: 'Campagne A', name: 'ONG A', email: 'a@ong.org' };

  it('refus : motif obligatoire ; acceptation : e-mail au sponsor', async () => {
    const { db, calls } = fakeDb((sql) => {
      if (sql.includes('FROM sponsor_export_requests er')) return [REQ];
      if (sql.startsWith('UPDATE sponsor_export_requests')) return { affectedRows: 1 };
      return [];
    });
    const svc = new SponsorExportsAdminService(db);
    await expect(svc.reject(4, 1, ' ')).rejects.toThrow('motif');
    const res = await svc.approve(4, 1);
    expect(res.email_sent).toBe(true);
    const up = calls.find((c) => c.sql.startsWith('UPDATE sponsor_export_requests'));
    expect(up.params).toEqual(['approved', null, 1, 4]);
    expect(mailer.mock.calls[0][0].message).toContain('acceptée');
  });

  it('demande déjà traitée : refusée', async () => {
    const { db } = fakeDb((sql) => (sql.includes('FROM sponsor_export_requests er') ? [{ ...REQ, status: 'approved' }] : []));
    await expect(new SponsorExportsAdminService(db).approve(4, 1)).rejects.toThrow('déjà été traitée');
  });

  it('rôles : espace réservé aux sponsors, validation réservée à l’admin', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SponsorSpaceController)).toEqual([SPONSOR]);
    expect(Reflect.getMetadata(ROLES_KEY, SponsorsAdminController)).toEqual([SUPER_ADMIN]);
  });
});
