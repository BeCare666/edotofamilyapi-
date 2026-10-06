jest.mock('../auth/mailer', () => ({ sendVerificationEmail: jest.fn().mockResolvedValue(undefined) }));

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { sendVerificationEmail } from '../auth/mailer';
import { CampaignsService } from './campaigns.service';
import { CampaignsAdminService } from './campaigns-admin.service';
import { computeStatus, diffSponsors, parseCampaignInput, statusSql, todayInBenin } from './campaign-rules';

type Handler = (sql: string, params: any[]) => any;

function fakeDb(handler: Handler) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    return [handler(sql, params) ?? [], []];
  });
  const conn = { query, beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
  const pool = { query, getConnection: jest.fn(async () => conn) };
  return { calls, conn, db: { getPool: () => pool, query } as any };
}

const makeAdmin = (db: any) => new CampaignsAdminService(db, new CampaignsService(db));
const mailer = sendVerificationEmail as jest.Mock;
beforeEach(() => mailer.mockClear());

const VALID = {
  title: 'Campagne test', objective_kits: 100, date_start: '2026-10-01', date_end: '2026-10-31',
  cities: ['Cotonou', ' Porto-Novo ', 'cotonou', ''], sponsors: [{ sponsor_id: 7, amount: 50000 }],
};

describe('Règles des campagnes', () => {
  it('statut calculé à partir des dates (fin incluse)', () => {
    expect(computeStatus('2026-10-01', '2026-10-31', '2026-09-30')).toBe('a_venir');
    expect(computeStatus('2026-10-01', '2026-10-31', '2026-10-01')).toBe('en_cours');
    expect(computeStatus('2026-10-01', '2026-10-31', '2026-10-31')).toBe('en_cours');
    expect(computeStatus('2026-10-01', '2026-10-31', '2026-11-01')).toBe('terminee');
    expect(computeStatus('2026-04-17', null, '2026-09-24')).toBe('en_cours'); // sans date de fin (ancienne donnée)
    expect(statusSql('c')).toContain('DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR)');
  });

  it('date du jour au Bénin (UTC+1)', () => {
    expect(todayInBenin(new Date('2026-09-24T23:30:00Z'))).toBe('2026-09-25');
    expect(todayInBenin(new Date('2026-09-24T22:59:00Z'))).toBe('2026-09-24');
  });

  it('formulaire : villes nettoyées et dédoublonnées ; date de fin obligatoire et après le début', () => {
    expect(parseCampaignInput(VALID).cities).toEqual(['Cotonou', 'Porto-Novo']);
    expect(() => parseCampaignInput({ ...VALID, date_end: '' })).toThrow('date de fin est obligatoire');
    expect(() => parseCampaignInput({ ...VALID, date_end: '2026-09-01' })).toThrow('après la date de début');
    expect(() => parseCampaignInput({ ...VALID, date_start: '2026-02-30' })).toThrow('Date de début invalide');
    expect(() => parseCampaignInput({ ...VALID, cities: [' '] })).toThrow('au moins une ville');
    expect(() => parseCampaignInput({ ...VALID, title: ' ' })).toThrow('nom de la campagne');
    expect(() => parseCampaignInput({ ...VALID, objective_kits: -1 })).toThrow('kits');
    expect(() => parseCampaignInput({ ...VALID, sponsors: [{ sponsor_id: 7, amount: 1 }, { sponsor_id: 7, amount: 2 }] })).toThrow('une fois');
  });

  it('sponsors modifiés : ajout, montant changé, retrait', () => {
    expect(diffSponsors(
      [{ sponsor_id: 1, amount: 10 }, { sponsor_id: 2, amount: 20 }],
      [{ sponsor_id: 2, amount: 25 }, { sponsor_id: 3, amount: 30 }],
    )).toEqual({ added: [{ sponsor_id: 3, amount: 30 }], updated: [{ sponsor_id: 2, amount: 25 }], removed: [1] });
  });
});

describe('Admin : création / modification / suppression', () => {
  it('création : campagne + villes + lien sponsor (code d’accès) dans une transaction, e-mail au sponsor', async () => {
    const { db, calls, conn } = fakeDb((sql) => {
      if (sql.includes('FROM sponsors WHERE id IN')) return [{ id: 7, name: 'ONG A', email: 'a@ong.org' }];
      if (sql.startsWith('INSERT INTO campaigns')) return { insertId: 55 };
      return {};
    });
    const res = await makeAdmin(db).create(VALID);
    expect(res.id).toBe(55);
    const ins = calls.find((c) => c.sql.startsWith('INSERT INTO campaigns'));
    expect(ins.params).toEqual(['Campagne test', null, null, 'Cotonou, Porto-Novo', '2026-10-01', '2026-10-31', 100]);
    expect(calls.filter((c) => c.sql.startsWith('INSERT INTO campaign_locations')).map((c) => c.params)).toEqual([[55, 'Cotonou'], [55, 'Porto-Novo']]);
    const link = calls.find((c) => c.sql.startsWith('INSERT INTO campaign_sponsors'));
    expect(link.params.slice(0, 5)).toEqual([55, 7, 'ONG A', 'a@ong.org', 50000]);
    expect(link.params[5]).toMatch(/^[0-9a-f]{32}$/);
    expect(conn.commit).toHaveBeenCalled();
    expect(mailer).toHaveBeenCalledTimes(1);
  });

  it('création : sponsor inconnu → annulé, rien d’envoyé', async () => {
    const { db, conn } = fakeDb((sql) => (sql.includes('FROM sponsors WHERE id IN') ? [] : {}));
    await expect(makeAdmin(db).create(VALID)).rejects.toThrow('Sponsor introuvable');
    expect(conn.rollback).toHaveBeenCalled();
    expect(mailer).not.toHaveBeenCalled();
  });

  it('modification : villes et sponsors mis à jour ; code des sponsors conservés inchangé ; e-mail seulement aux nouveaux', async () => {
    const { db, calls } = fakeDb((sql) => {
      if (sql.startsWith('SELECT id FROM campaigns')) return [{ id: 9 }];
      if (sql.includes('FROM sponsors WHERE id IN')) return [{ id: 7, name: 'ONG A', email: 'a@ong.org' }, { id: 8, name: 'ONG B', email: 'b@ong.org' }];
      if (sql.startsWith('SELECT id, city FROM campaign_locations')) return [{ id: 1, city: 'Cotonou' }, { id: 2, city: 'Zou / Mono' }];
      if (sql.startsWith('SELECT sponsor_id, amount FROM campaign_sponsors')) return [{ sponsor_id: 7, amount: '40000.00' }, { sponsor_id: 6, amount: '1.00' }];
      return {};
    });
    await makeAdmin(db).update(9, { ...VALID, sponsors: [{ sponsor_id: 7, amount: 50000 }, { sponsor_id: 8, amount: 1000 }] });
    expect(calls.some((c) => c.sql.startsWith('DELETE FROM campaign_locations') && c.params[0] === 2)).toBe(true);
    expect(calls.filter((c) => c.sql.startsWith('INSERT INTO campaign_locations')).map((c) => c.params)).toEqual([[9, 'Porto-Novo']]);
    expect(calls.some((c) => c.sql.startsWith('DELETE FROM campaign_sponsors') && c.params[1] === 6)).toBe(true);
    expect(calls.find((c) => c.sql.startsWith('UPDATE campaign_sponsors SET amount')).params).toEqual([50000, 9, 7]);
    expect(calls.filter((c) => c.sql.startsWith('INSERT INTO campaign_sponsors')).map((c) => c.params[1])).toEqual([8]);
    expect(mailer).toHaveBeenCalledTimes(1);
  });

  it('suppression interdite si la campagne a des inscrits ; autorisée sinon', async () => {
    const withRegs = fakeDb((sql) => (sql.includes('FROM campaigns c WHERE c.id') ? [{ id: 1, n: 3 }] : {}));
    await expect(makeAdmin(withRegs.db).remove(1)).rejects.toThrow('3 inscrits');
    expect(withRegs.calls.some((c) => c.sql.startsWith('DELETE'))).toBe(false);

    const empty = fakeDb((sql) => (sql.includes('FROM campaigns c WHERE c.id') ? [{ id: 2, n: 0 }] : {}));
    await makeAdmin(empty.db).remove(2);
    expect(empty.calls.some((c) => c.sql === 'DELETE FROM campaigns WHERE id = ?')).toBe(true);

    const none = fakeDb(() => []);
    await expect(makeAdmin(none.db).remove(3)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sponsor : e-mail unique', async () => {
    const { db } = fakeDb((sql) => (sql.startsWith('SELECT id FROM sponsors') ? [{ id: 1 }] : {}));
    await expect(makeAdmin(db).createSponsor({ name: 'ONG', email: 'A@ong.org' })).rejects.toBeInstanceOf(ConflictException);
    await expect(makeAdmin(db).createSponsor({ name: 'ONG', email: 'pas-un-mail' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('liste : filtre sur le statut calculé, jamais sur la colonne status', async () => {
    const { db, calls } = fakeDb((sql) => (sql.includes('COUNT(*) AS total') ? [{ total: 0 }] : []));
    await makeAdmin(db).list({ status: 'terminee' });
    expect(calls[0].sql).toContain("THEN 'terminee'");
    expect(calls[0].params[0]).toBe('terminee');
    expect(calls[0].sql).not.toMatch(/c\.status\s*=/);
  });
});

describe('Inscription : ville obligatoire parmi les villes de la campagne', () => {
  const base = (cityRows: any[]) => fakeDb((sql) => {
    if (sql.includes('FROM campaigns c WHERE c.id')) return [{ id: 1, status: 'en_cours' }];
    if (sql.includes('FROM campaign_locations WHERE campaign_id')) return cityRows;
    if (sql.includes('SELECT name, role, is_active')) return [{ name: 'Point A', role: 'super_pickuppoint', is_active: 1, pickup_approved: 1 }];
    if (sql.includes('SELECT name, email FROM users')) return [{ name: 'Awa', email: 'awa@t.io' }];
    if (sql.startsWith('INSERT INTO campaign_registrations')) return { insertId: 40 };
    return [];
  });

  it('ville absente ou hors campagne : refusée', async () => {
    const a = base([]);
    await expect(new CampaignsService(a.db).register({ campaign_id: 1, pickup_center: '20' } as any, 5)).rejects.toThrow('Indiquez votre ville');
    await expect(new CampaignsService(a.db).register({ campaign_id: 1, pickup_center: '20', city: 'Parakou' } as any, 5)).rejects.toThrow('ne se déroule pas');
  });

  it('ville de la campagne : enregistrée (orthographe de la campagne) ; ancien compteur plus modifié', async () => {
    const b = base([{ city: 'Cotonou' }]);
    await new CampaignsService(b.db).register({ campaign_id: 1, pickup_center: '20', city: 'cotonou' } as any, 5);
    const ins = b.calls.find((c) => c.sql.startsWith('INSERT INTO campaign_registrations'));
    expect(ins.params.slice(0, 5)).toEqual([1, 'Awa', 'awa@t.io', '20', 'Cotonou']);
    expect(ins.params[5]).toMatch(/^\d{6}$/); // code de retrait enregistré avec la demande
    expect(b.calls.some((c) => c.sql.includes('distributed_kits'))).toBe(false);
  });

  it('campagnes publiques : en cours / à venir / par ville sur le statut calculé et les villes', async () => {
    const { db, calls } = fakeDb(() => []);
    const svc = new CampaignsService(db);
    await svc.getActiveCampaign();
    await svc.getUpcomingCampaigns();
    await svc.getActiveCampaignByCity('Cotonou');
    expect(calls[0].sql).toContain("= 'en_cours'");
    expect(calls[1].sql).toContain("= 'a_venir'");
    expect(calls[2].sql).toContain('FROM campaign_locations l WHERE l.campaign_id = c.id AND LOWER(l.city) = LOWER(?)');
    for (const c of calls) expect(c.sql).not.toMatch(/WHERE status =/);
  });
});

describe('Excel', () => {
  const DETAIL_ROWS: Handler = (sql) => {
    if (sql.includes('FROM campaigns c WHERE c.id = ?')) {
      return [{ id: 3, title: 'Santé Jeunes', description: null, date_start: '2026-02-16', date_end: '2026-04-16', objective_kits: 100,
        location: 'Cotonou', status: 'terminee', cities_raw: 'Abomey-Calavi||Cotonou', budget: '75000.00', registrations_count: 3, picked_up_count: 1 }];
    }
    if (sql.includes('FROM campaign_sponsors cs LEFT JOIN sponsors')) return [{ sponsor_id: 7, name: 'ONG A', email: 'a@ong.org', amount: '75000.00' }];
    if (sql.includes('FROM campaign_registrations r')) {
      return [
        { id: 1, full_name: 'Awa', email: 'awa@t.io', city: 'Cotonou', pickup_center: '90001', pickup_center_name: 'Siège', created_at: new Date('2026-03-01T10:00:00Z'), otp_used: 1, picked_up: 1, picked_up_at: new Date('2026-03-02T10:00:00Z') },
        { id: 2, full_name: 'Bio', email: 'bio@t.io', city: 'Cotonou', pickup_center: '90001', pickup_center_name: 'Siège', created_at: new Date('2026-03-01T11:00:00Z'), otp_used: 0, picked_up: 0, picked_up_at: null },
        { id: 3, full_name: 'Cica', email: 'c@t.io', city: null, pickup_center: '60001', pickup_center_name: 'Point B', created_at: new Date('2026-03-03T11:00:00Z'), otp_used: 0, picked_up: 0, picked_up_at: null },
      ];
    }
    return [];
  };

  it('fichier d’une campagne : infos, sponsors, inscrits nominatifs, chiffres par point et par ville ; sans code OTP', async () => {
    const { db, calls } = fakeDb(DETAIL_ROWS);
    const file = await makeAdmin(db).exportCampaign(3);
    expect(file.filename).toBe('campagne-3-sante-jeunes.xlsx');
    expect(calls.every((c) => !c.sql.includes('otp_code'))).toBe(true);

    const wb = new Workbook();
    await wb.xlsx.load(file.buffer as any);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Campagne', 'Sponsors', 'Inscrits', 'Par point de retrait', 'Par ville']);
    const info = wb.getWorksheet('Campagne');
    const values = Object.fromEntries(info.getSheetValues().slice(2).map((r: any) => [r[1], r[2]]));
    expect(values['Statut']).toBe('Terminée');
    expect(values['Ville(s)']).toBe('Abomey-Calavi, Cotonou');
    expect(values['Inscrits']).toBe(3);
    expect(values['Kits retirés']).toBe(1);
    expect(values['Inscrits sans retrait']).toBe(2);
    expect(values['Budget (somme des sponsors, FCFA)']).toBe(75000);

    const regs = wb.getWorksheet('Inscrits').getSheetValues().slice(2) as any[];
    expect(regs.map((r) => [r[1], r[2], r[3], r[4], r[6]])).toEqual([
      ['Awa', 'awa@t.io', 'Cotonou', 'Siège', 'Oui'],
      ['Bio', 'bio@t.io', 'Cotonou', 'Siège', 'Non'],
      ['Cica', 'c@t.io', 'Non renseignée', 'Point B', 'Non'],
    ]);
    const byPoint = wb.getWorksheet('Par point de retrait').getSheetValues().slice(2) as any[];
    expect(byPoint.map((r) => [r[1], r[2], r[3], r[4]])).toEqual([['Siège', 2, 1, 1], ['Point B', 1, 0, 1], ['TOTAL', 3, 1, 2]]);
    const byCity = wb.getWorksheet('Par ville').getSheetValues().slice(2) as any[];
    expect(byCity.map((r) => [r[1], r[2], r[3]])).toEqual([['Cotonou', 2, 1], ['Non renseignée', 1, 0], ['TOTAL', 3, 1]]);
  });

  it('fichier global : une ligne par campagne + total', async () => {
    const { db } = fakeDb((sql) => (sql.includes('FROM campaigns c ORDER BY') ? [
      { id: 1, title: 'A', date_start: '2026-01-01', date_end: '2026-01-31', objective_kits: 10, status: 'terminee', cities_raw: 'Cotonou', budget: '100', registrations_count: 4, picked_up_count: 1, sponsor_names: 'ONG A' },
      { id: 2, title: 'B', date_start: '2026-12-01', date_end: '2026-12-31', objective_kits: 5, status: 'a_venir', cities_raw: 'Parakou||Natitingou', budget: '0', registrations_count: 0, picked_up_count: 0, sponsor_names: null },
    ] : []));
    const file = await makeAdmin(db).exportAll();
    const wb = new Workbook();
    await wb.xlsx.load(file.buffer as any);
    const rows = wb.getWorksheet('Campagnes').getSheetValues().slice(2) as any[];
    expect(rows.map((r) => [r[2], r[3], r[4], r[8], r[10], r[11], r[12]])).toEqual([
      ['A', 'Terminée', 'Cotonou', 100, 4, 1, 3],
      ['B', 'À venir', 'Parakou, Natitingou', 0, 0, 0, 0],
      ['TOTAL', undefined, undefined, 100, 4, 1, 3],
    ]);
  });
});
