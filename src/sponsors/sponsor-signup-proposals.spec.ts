process.env.JWT_SECRET_KEY = 'test-secret';
jest.mock('../auth/mailer', () => ({ sendVerificationEmail: jest.fn().mockResolvedValue(undefined) }));

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { sendVerificationEmail } from '../auth/mailer';
import { SponsorAccountService } from './sponsor-account.service';
import { SponsorSpaceService } from './sponsor-space.service';
import { SponsorProposalsService } from './sponsor-proposals.service';
import { SponsorLiveService } from './sponsor-live.service';
import { SponsorSignupController, SponsorSpaceController, SponsorsAdminController } from './sponsors.controller';
import { CampaignsAdminService } from '../campaigns/campaigns-admin.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { ROLES_KEY, SPONSOR, SUPER_ADMIN } from '../auth/roles.decorator';
import { allowAttempt, parseProposal, parseSponsorSignup, todayBenin } from './sponsor-rules';

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
const mailer = sendVerificationEmail as jest.Mock;
beforeEach(() => {
  mailer.mockReset();
  mailer.mockResolvedValue(undefined);
});

const addDays = (n: number) => new Date(Date.parse(`${todayBenin()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
// 16/10/2026 : mot de passe avec majuscule, minuscule et chiffre ; téléphone enregistré sans espaces
const SIGNUP = { organization: 'Fondation Test', contact_name: 'Awa Test', phone: '+229 01 97 00 00 00', email: 'Contact@Fondation.test', password: 'Motdepasse1', consent: true };
const PROPOSAL = { title: 'Kits Cotonou', description: 'Distribution', cities: ['Cotonou', ' cotonou ', 'Porto-Novo'], date_start: addDays(5), date_end: addDays(35), objective_kits: 200, budget: 1500000 };

describe('Règles : inscription et demande de campagne', () => {
  it('inscription : champs obligatoires, e-mail en minuscules, téléphone et mot de passe contrôlés', () => {
    expect(parseSponsorSignup(SIGNUP).email).toBe('contact@fondation.test');
    expect(() => parseSponsorSignup({ ...SIGNUP, organization: ' ' })).toThrow('organisation');
    expect(() => parseSponsorSignup({ ...SIGNUP, phone: 'abc' })).toThrow('que des chiffres');
    expect(() => parseSponsorSignup({ ...SIGNUP, phone: '0197 ab 00' })).toThrow('que des chiffres');
    expect(() => parseSponsorSignup({ ...SIGNUP, contact_name: 'Awa 2' })).toThrow('lettres');
    expect(() => parseSponsorSignup({ ...SIGNUP, password: 'motdepasse1' })).toThrow('majuscule');
    expect(() => parseSponsorSignup({ ...SIGNUP, email: 'pas-un-email' })).toThrow('e-mail invalide');
    expect(() => parseSponsorSignup({ ...SIGNUP, password: 'court' })).toThrow('8 caractères');
  });

  it('demande : villes dédoublonnées, dates futures et ordonnées, au moins 1 kit', () => {
    expect(parseProposal(PROPOSAL).cities).toEqual(['Cotonou', 'Porto-Novo']);
    expect(() => parseProposal({ ...PROPOSAL, date_start: addDays(-1) })).toThrow('passée');
    expect(() => parseProposal({ ...PROPOSAL, date_end: addDays(2) })).toThrow('après la date de début');
    expect(() => parseProposal({ ...PROPOSAL, cities: [] })).toThrow('au moins une ville');
    expect(() => parseProposal({ ...PROPOSAL, objective_kits: 0 })).toThrow('kits');
    expect(() => parseProposal({ ...PROPOSAL, budget: -5 })).toThrow('Budget');
  });

  it('limiteur : 5 essais puis refus sur la fenêtre', () => {
    for (let i = 0; i < 5; i++) expect(allowAttempt('t:1', 5, 1000, 100)).toBe(true);
    expect(allowAttempt('t:1', 5, 1000, 200)).toBe(false);
    expect(allowAttempt('t:1', 5, 1000, 2000)).toBe(true);
  });
});

describe('Inscription libre d’un sponsor', () => {
  it('crée le compte sponsor et la fiche (inscrite par le sponsor) dans une transaction', async () => {
    const { db, calls, conn } = fakeDb((sql) => (sql.startsWith('INSERT INTO users') ? { insertId: 91 } : []));
    const res = await new SponsorAccountService(db).signup(SIGNUP);
    expect(res.success).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
    const user = calls.find((c) => c.sql.startsWith('INSERT INTO users'));
    expect(user.sql).toContain("'sponsor'");
    expect(user.params[2]).not.toBe('Motdepasse1'); // mot de passe haché
    const sponsor = calls.find((c) => c.sql.startsWith('INSERT INTO sponsors'));
    expect(sponsor.sql).toContain('self_registered');
    expect(sponsor.params).toEqual(['Fondation Test', 'contact@fondation.test', 91, 'Awa Test', '+2290197000000']);
    expect(mailer).toHaveBeenCalledTimes(1);
  });

  it('un e-mail en échec n’annule pas l’inscription', async () => {
    mailer.mockRejectedValueOnce(new Error('Brevo 401'));
    const { db } = fakeDb((sql) => (sql.startsWith('INSERT INTO users') ? { insertId: 92 } : []));
    const res = await new SponsorAccountService(db).signup(SIGNUP);
    expect(res.success).toBe(true);
    expect(res.email_sent).toBe(false);
  });

  it('adresse déjà utilisée (compte ou fiche créée par l’admin) : refus, rien n’est créé', async () => {
    const a = fakeDb((sql) => (sql.includes('FROM users WHERE email') ? [{ id: 1, role: 'customer' }] : []));
    await expect(new SponsorAccountService(a.db).signup(SIGNUP)).rejects.toThrow(ConflictException);
    const b = fakeDb((sql) => (sql.includes('FROM sponsors WHERE email') ? [{ id: 4 }] : []));
    await expect(new SponsorAccountService(b.db).signup(SIGNUP)).rejects.toThrow('invitation');
    expect([...a.calls, ...b.calls].some((c) => c.sql.startsWith('INSERT'))).toBe(false);
  });

  it('route publique, limitée à 5 essais par heure et par IP', async () => {
    expect(Reflect.getMetadata(ROLES_KEY, SponsorSignupController)).toBeUndefined();
    const accounts = { signup: jest.fn().mockResolvedValue({ success: true }) } as any;
    const ctrl = new SponsorSignupController(accounts);
    const req = { headers: { 'x-forwarded-for': '203.0.113.77' } };
    for (let i = 0; i < 5; i++) await ctrl.signup(req, SIGNUP);
    expect(() => ctrl.signup(req, SIGNUP)).toThrow('Trop de tentatives');
  });
});

describe('Demandes de campagne', () => {
  it('le sponsor soumet une demande (en attente), uniquement pour sa fiche', async () => {
    const { db, calls } = fakeDb((sql) => (sql.startsWith('INSERT') ? { insertId: 5 } : []));
    const res = await new SponsorProposalsService(db).create(3, PROPOSAL);
    expect(res).toMatchObject({ id: 5, status: 'pending' });
    const ins = calls.find((c) => c.sql.startsWith('INSERT'));
    expect(ins.params[0]).toBe(3);
    expect(JSON.parse(ins.params[3])).toEqual(['Cotonou', 'Porto-Novo']);
  });

  it('retrait possible seulement en attente', async () => {
    const { db } = fakeDb(() => ({ affectedRows: 0 }));
    await expect(new SponsorProposalsService(db).withdraw(3, 5)).rejects.toThrow('en attente');
  });

  it('une demande d’un autre sponsor est introuvable', async () => {
    const { db } = fakeDb(() => []);
    await expect(new SponsorProposalsService(db).oneForSponsor(3, 99)).rejects.toThrow(NotFoundException);
  });

  it('admin : refus sans motif impossible ; validation → e-mail ; double décision refusée', async () => {
    const row = { id: 5, sponsor_id: 3, title: 'Kits', cities: '["Cotonou"]', status: 'approved', sponsor_email: 's@x.io', sponsor_name: 'S', created_at: '2026-10-15 10:00:00' };
    const ok = fakeDb((sql) => (sql.startsWith('UPDATE') ? { affectedRows: 1 } : [row]));
    const svc = new SponsorProposalsService(ok.db);
    await expect(svc.decide(5, 1, false, ' ')).rejects.toThrow('motif');
    const res = await svc.decide(5, 1, true, '');
    expect(res.email_sent).toBe(true);
    expect(mailer.mock.calls[0][0].email).toBe('s@x.io');
    const done = fakeDb((sql) => (sql.startsWith('UPDATE') ? { affectedRows: 0 } : [row]));
    await expect(new SponsorProposalsService(done.db).decide(5, 1, true, '')).rejects.toThrow('déjà été traitée');
  });

  it('l’e-mail échappe les valeurs saisies', async () => {
    const row = { id: 5, sponsor_id: 3, title: '<script>x</script>', cities: '[]', status: 'rejected', admin_note: '<b>non</b>', sponsor_email: 's@x.io', sponsor_name: 'S' };
    const { db } = fakeDb((sql) => (sql.startsWith('UPDATE') ? { affectedRows: 1 } : [row]));
    await new SponsorProposalsService(db).decide(5, 1, false, '<b>non</b>');
    expect(mailer.mock.calls[0][0].message).not.toContain('<script>');
    expect(mailer.mock.calls[0][0].message).toContain('&lt;b&gt;non&lt;/b&gt;');
  });
});

describe('Création de la campagne depuis une demande validée', () => {
  const BODY = { title: 'Kits Cotonou', objective_kits: 200, date_start: '2026-11-01', date_end: '2026-11-30', cities: ['Cotonou'], sponsors: [{ sponsor_id: 3, amount: 1500000 }] };
  const handler = (status: string, campaignId: any = null): Handler => (sql) => {
    if (sql.includes('FROM sponsor_campaign_proposals WHERE id = ? FOR UPDATE')) return [{ id: 5, status, sponsor_id: 3, campaign_id: campaignId }];
    if (sql.includes('FROM sponsors WHERE id IN')) return [{ id: 3, name: 'Fondation', email: 'f@x.io' }];
    if (sql.startsWith('INSERT INTO campaigns')) return { insertId: 40 };
    if (sql.includes('FROM sponsor_campaign_proposals p')) return [{ id: 5, sponsor_id: 3, title: 'Kits', cities: '[]', status: 'created', sponsor_email: 'f@x.io', sponsor_name: 'Fondation' }];
    return [];
  };
  const admin = (db: any) => new CampaignsAdminService(db, new CampaignsService(db));

  it('demande validée → campagne créée, demande passée à « Campagne créée »', async () => {
    const { db, calls } = fakeDb(handler('approved'));
    const res = await admin(db).create({ ...BODY, proposal_id: 5 });
    expect(res.id).toBe(40);
    const mark = calls.find((c) => c.sql.includes("SET status = 'created'"));
    expect(mark.params).toEqual([40, 5]);
  });

  it('demande non validée ou déjà utilisée : refus, transaction annulée', async () => {
    const a = fakeDb(handler('pending'));
    await expect(admin(a.db).create({ ...BODY, proposal_id: 5 })).rejects.toThrow('demande validée');
    expect(a.conn.rollback).toHaveBeenCalled();
    const b = fakeDb(handler('approved', 12));
    await expect(admin(b.db).create({ ...BODY, proposal_id: 5 })).rejects.toThrow(BadRequestException);
  });

  it('le sponsor de la demande doit faire partie des sponsors de la campagne', async () => {
    const { db } = fakeDb(handler('approved'));
    await expect(admin(db).create({ ...BODY, sponsors: [], proposal_id: 5 })).rejects.toThrow('sponsor à l’origine');
  });

  it('sans demande : création inchangée', async () => {
    const { db, calls } = fakeDb(handler('approved'));
    await admin(db).create(BODY);
    expect(calls.some((c) => c.sql.includes('sponsor_campaign_proposals'))).toBe(false);
  });
});

describe('Suivi en temps réel (carte, journal, points)', () => {
  const campaigns = [
    { id: 1, title: 'En cours', status: 'en_cours', status_label: 'En cours', cities: ['Cotonou'], objective_kits: 10, registrations: 3, validated: 2, withdrawn: 1, date_start: '2026-10-01', date_end: '2026-10-31' },
    { id: 2, title: 'Terminée', status: 'terminee', status_label: 'Terminée', cities: ['Parakou'], objective_kits: 5, registrations: 0, validated: 0, withdrawn: 0, date_start: '2026-08-01', date_end: '2026-08-31' },
  ];
  const space = { campaignsOf: jest.fn(async () => campaigns) } as any as SponsorSpaceService;
  const now = new Date(Date.now()).toISOString().slice(0, 19).replace('T', ' ');
  const regs = [
    { campaign_id: 1, city: 'Cotonou', pickup_center: '7', otp_used: 1, picked_up: 1, created: now, verified: now, picked: now, full_name: 'NE DOIT PAS SORTIR', email: 'x@x.io' },
    { campaign_id: 1, city: 'Cotonou', pickup_center: '7', otp_used: 1, picked_up: 0, created: now, verified: now, picked: null },
    { campaign_id: 1, city: 'Abomey-Calavi', pickup_center: '8', otp_used: 0, picked_up: 0, created: '2026-10-02 09:00:00', verified: null, picked: null },
  ];
  const handler: Handler = (sql) => {
    if (sql.includes('FROM campaign_registrations r WHERE r.campaign_id IN') && !sql.includes('UNION')) return regs;
    if (sql.includes('FROM users WHERE id IN')) return [{ id: 7, name: 'Pharmacie A', pickup_address: 'Akpakpa', pickup_lat: '6.37', pickup_lng: '2.43' }, { id: 8, name: 'Point B', pickup_address: null, pickup_lat: null, pickup_lng: null }];
    if (sql.includes('GROUP BY e.type')) return [{ type: 'registration', n: 3 }, { type: 'validated', n: 2 }, { type: 'withdrawn', n: 1 }];
    if (sql.includes('UNION ALL')) return [{ type: 'withdrawn', campaign_id: 1, city: 'Cotonou', point_name: 'Pharmacie A', at: now }];
    return [];
  };

  it('carte : campagnes en cours par défaut, points avec GPS et chiffres, activité du jour, aucune donnée nominative', async () => {
    const { db } = fakeDb(handler);
    const live = await new SponsorLiveService(db, space).live(3, {});
    expect(live.campaigns.map((c: any) => c.id)).toEqual([1]);
    const a = live.points.find((p: any) => p.name === 'Pharmacie A');
    expect(a).toMatchObject({ lat: 6.37, lng: 2.43, registrations: 2, validated: 2, withdrawn: 1, today_withdrawn: 1, rate: 50 });
    expect(live.points.find((p: any) => p.name === 'Point B').lat).toBeNull();
    expect(live.today).toEqual({ registrations: 2, validated: 2, withdrawn: 1 });
    expect(live.cities.map((c: any) => c.city)).toEqual(['Cotonou', 'Abomey-Calavi']);
    expect(JSON.stringify(live)).not.toMatch(/NE DOIT PAS SORTIR|x@x\.io|full_name|email/);
  });

  it('campagne non soutenue : introuvable', async () => {
    const { db } = fakeDb(handler);
    await expect(new SponsorLiveService(db, space).live(3, { campaign: 99 })).rejects.toThrow(NotFoundException);
  });

  it('journal : compteurs par type, filtre de type, période convertie en UTC', async () => {
    const { db, calls } = fakeDb(handler);
    const res = await new SponsorLiveService(db, space).activity(3, { type: 'withdrawn', from: '2026-10-01', to: '2026-10-15' });
    expect(res.counts).toEqual({ registration: 3, validated: 2, withdrawn: 1 });
    expect(res.total).toBe(1);
    const list = calls.find((c) => c.sql.includes('LIMIT ? OFFSET ?'));
    expect(list.params).toContain('2026-09-30 23:00:00');
    expect(list.params).toContain('2026-10-15 23:00:00');
    expect(list.params).toContain('withdrawn');
  });

  it('points : tri et recherche', async () => {
    const { db } = fakeDb(handler);
    const res = await new SponsorLiveService(db, space).points(3, { q: 'akpakpa' });
    expect(res.data.map((p: any) => p.name)).toEqual(['Pharmacie A']);
  });
});

describe('Accès', () => {
  it('routes du sponsor réservées au rôle sponsor ; demandes de campagne côté admin réservées au super admin', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SponsorSpaceController)).toEqual([SPONSOR]);
    expect(Reflect.getMetadata(ROLES_KEY, SponsorsAdminController)).toEqual([SUPER_ADMIN]);
  });
});
