import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ageOn, checkPassword, cleanBirthDate, cleanEmail, cleanName, cleanOrgName, cleanPhone, cleanSex } from './field-rules';
import { cityAmong, cleanPosition, normCity, setGeoFetcher } from './geo-city';
import { cleanTarget, readTarget, targetLabel, targetMismatch } from '../campaigns/campaign-target';
import { pickupCityOf } from '../campaigns/pickup-city';
import { isRealImage } from '../users/profile-photo.controller';

// Tests du chantier du 16/10/2026 : contrôle des champs, ciblage des campagnes, ville par GPS, photo
const bad = (fn: () => unknown, msg?: RegExp) => {
  try { fn(); } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    if (msg) expect((e as Error).message).toMatch(msg);
    return;
  }
  throw new Error('aurait dû échouer');
};

describe('Règles de saisie', () => {
  it('téléphone : chiffres seulement, 8 à 15 chiffres, + au début permis', () => {
    expect(cleanPhone('01 97 12 34 56')).toBe('0197123456');
    expect(cleanPhone('+22901971234')).toBe('+22901971234');
    bad(() => cleanPhone('01abc23456'), /que des chiffres/);
    bad(() => cleanPhone('0197-12-34'), /que des chiffres/);
    bad(() => cleanPhone('1234567'), /entre 8 et 15/);
    bad(() => cleanPhone(''), /obligatoire/);
    expect(cleanPhone('', { required: false })).toBeNull();
  });

  it('mot de passe : 8 caractères, minuscule, majuscule, chiffre, sans espace', () => {
    expect(checkPassword('Edoto2026')).toBe('Edoto2026');
    bad(() => checkPassword('edoto2026'), /majuscule/);
    bad(() => checkPassword('EDOTO2026'), /minuscule/);
    bad(() => checkPassword('Edotofamily'), /chiffre/);
    bad(() => checkPassword('Ed1'), /8 caractères/);
    bad(() => checkPassword('Edoto 2026'), /espace/);
    bad(() => checkPassword('A1' + 'a'.repeat(80)), /72/);
  });

  it('noms : lettres, accents, apostrophe, trait d’union ; pas de chiffres', () => {
    expect(cleanName('  Awa   Houndé ')).toBe('Awa Houndé');
    expect(cleanName("Jean-Marc N'Dah")).toBe("Jean-Marc N'Dah");
    bad(() => cleanName('Awa2'), /lettres/);
    bad(() => cleanName('A'), /2 caractères/);
    expect(cleanOrgName('UNFPA Bénin 2026')).toBe('UNFPA Bénin 2026');
    bad(() => cleanOrgName('<script>'), /non autorisés/);
  });

  it('e-mail et sexe', () => {
    expect(cleanEmail(' Awa@Exemple.BJ ')).toBe('awa@exemple.bj');
    bad(() => cleanEmail('awa@exemple'), /pas valide/);
    expect(cleanSex('female')).toBe('female');
    bad(() => cleanSex('autre'), /non valide/);
    bad(() => cleanSex(''), /obligatoire/);
  });

  it('date de naissance : vraie date, pas dans le futur, 10 à 100 ans', () => {
    expect(ageOn('2008-10-17', '2026-10-16')).toBe(17);
    expect(ageOn('2008-10-16', '2026-10-16')).toBe(18);
    expect(cleanBirthDate('2005-02-28')).toBe('2005-02-28');
    bad(() => cleanBirthDate('2005-02-30'), /non valide/);
    bad(() => cleanBirthDate('16/10/2005'), /non valide/);
    bad(() => cleanBirthDate('2999-01-01'), /futur/);
    bad(() => cleanBirthDate('2024-01-01'), /au moins 10 ans/);
  });
});

describe('Ciblage des campagnes', () => {
  it('lecture du formulaire : défaut « les deux » sans limite d’âge, contrôles', () => {
    expect(cleanTarget({})).toEqual({ target_sex: 'all', target_age_min: null, target_age_max: null });
    expect(cleanTarget({ target_sex: 'female', target_age_min: '15', target_age_max: 24 })).toEqual({ target_sex: 'female', target_age_min: 15, target_age_max: 24 });
    bad(() => cleanTarget({ target_sex: 'autre' }), /non valide/);
    bad(() => cleanTarget({ target_age_min: 30, target_age_max: 20 }), /dépasser/);
    bad(() => cleanTarget({ target_age_min: 15.5 }), /entier/);
  });

  it('libellés lisibles', () => {
    expect(targetLabel(readTarget({ target_sex: 'female', target_age_min: 15, target_age_max: 24 }))).toBe('Femmes et filles, 15 à 24 ans');
    expect(targetLabel(readTarget({ target_sex: 'male', target_age_min: 18 }))).toBe('Hommes et garçons, 18 ans et plus');
    expect(targetLabel(readTarget({}))).toBe('Tout public');
  });

  it('personne dans ou hors cible', () => {
    const t = readTarget({ target_sex: 'female', target_age_min: 15, target_age_max: 24 });
    const day = '2026-10-16';
    expect(targetMismatch(t, { birth_date: '2006-05-01', sex: 'female' }, day)).toBeNull();
    expect(targetMismatch(t, { birth_date: '2006-05-01', sex: 'male' }, day)?.message).toMatch(/femmes et aux filles/);
    expect(targetMismatch(t, { birth_date: '2012-05-01', sex: 'female' }, day)?.message).toMatch(/de 15 à 24 ans/);
    expect(targetMismatch(t, { birth_date: '2001-10-15', sex: 'female' }, day)?.reason).toBe('not_targeted'); // 25 ans
    expect(targetMismatch(t, { birth_date: null, sex: 'female' }, day)?.reason).toBe('profile_incomplete');
    expect(targetMismatch(readTarget({}), { birth_date: '1990-01-01', sex: 'male' }, day)).toBeNull();
  });
});

describe('Ville par la position GPS', () => {
  afterEach(() => setGeoFetcher(null));
  const answer = (address: any) => setGeoFetcher(async () => ({ ok: true, json: async () => ({ address }) }));

  it('noms comparés sans accents, casse ni traits d’union', () => {
    expect(normCity('Abomey-Calavi')).toBe(normCity('abomey calavi'));
    expect(normCity('Kétou')).toBe('ketou');
  });

  it('position obligatoire et valide', () => {
    bad(() => cleanPosition(undefined, undefined), /localisation/);
    bad(() => cleanPosition('abc', 2), /localisation/);
    expect(cleanPosition('6.37', '2.41')).toEqual({ lat: 6.37, lng: 2.41 });
  });

  it('ville de la campagne trouvée ou non', async () => {
    answer({ city: 'Abomey-Calavi', county: 'Abomey-Calavi', state: 'Atlantique' });
    expect(await cityAmong(6.44, 2.35, ['Cotonou', 'Abomey Calavi'])).toBe('Abomey Calavi');
    answer({ city: 'Porto-Novo' });
    expect(await cityAmong(6.49, 2.6, ['Cotonou'])).toBeNull();
  });

  it('service de position injoignable : refus (pas de passage sans contrôle)', async () => {
    setGeoFetcher(async () => { throw new Error('réseau'); });
    await expect(cityAmong(6.3, 2.4, ['Cotonou'])).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('ville d’un point de retrait : calculée une fois, gardée, recalculée si le point bouge', async () => {
    let calls = 0;
    setGeoFetcher(async () => { calls++; return { ok: true, json: async () => ({ address: { city: 'Cotonou' } }) }; });
    const writes: any[] = [];
    const pool = { query: async (_s: string, p?: any[]) => { writes.push(p); return [[]]; } };
    const point = { id: 9, pickup_lat: 6.3792081, pickup_lng: 2.4132059, pickup_city: null, pickup_city_src: null };
    expect(await pickupCityOf(pool, point)).toBe('Cotonou');
    expect(writes[0]).toEqual(['Cotonou', '6.37921,2.41321', 9]);
    expect(await pickupCityOf(pool, { ...point, pickup_city: 'Cotonou', pickup_city_src: '6.37921,2.41321' })).toBe('Cotonou');
    expect(calls).toBe(1);
    expect(await pickupCityOf(pool, { ...point, pickup_lat: null })).toBeNull();
  });
});

describe('Photo de profil', () => {
  it('contenu réel vérifié (JPEG, PNG, WebP) ; autre fichier refusé', () => {
    expect(isRealImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(true);
    expect(isRealImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe(true);
    expect(isRealImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe(true);
    expect(isRealImage(Buffer.from('<?php echo 1; ?>....'))).toBe(false);
    expect(isRealImage(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Routes de compte et retrait (16/10/2026)
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth/auth.service';
import { ProfilePhotoController } from '../users/profile-photo.controller';
import { CampaignsService } from '../campaigns/campaigns.service';

function fakeDb(handler: (sql: string, params: any[]) => any) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    return [handler(sql, params) ?? [], []];
  });
  const pool = { query };
  return { calls, db: { getPool: () => pool, query } as any };
}

describe('Changement de mot de passe (la route ne faisait rien avant)', () => {
  it('compte connecté, ancien mot de passe vérifié, nouveau contrôlé puis haché', async () => {
    const hash = await bcrypt.hash('Ancien2026', 4);
    const { db, calls } = fakeDb((sql) => (sql.startsWith('SELECT id, password FROM users') ? [{ id: 7, password: hash }] : []));
    const svc = new AuthService(db);
    await expect(svc.changePassword({ oldPassword: 'Ancien2026', newPassword: 'Nouveau2026' })).rejects.toThrow('Connectez-vous');
    await expect(svc.changePassword({ oldPassword: 'Faux2026', newPassword: 'Nouveau2026' }, 7)).rejects.toThrow('actuel incorrect');
    await expect(svc.changePassword({ old_password: 'Ancien2026', new_password: 'faible' }, 7)).rejects.toThrow('majuscule');
    await expect(svc.changePassword({ oldPassword: 'Ancien2026', newPassword: 'Ancien2026' }, 7)).rejects.toThrow('différent');
    expect(calls.some((c) => c.sql.startsWith('UPDATE users SET password'))).toBe(false);
    const res = await svc.changePassword({ old_password: 'Ancien2026', new_password: 'Nouveau2026' }, 7);
    expect(res.success).toBe(true);
    const up = calls.find((c) => c.sql.startsWith('UPDATE users SET password'));
    expect(up.params[1]).toBe(7);
    expect(await bcrypt.compare('Nouveau2026', up.params[0])).toBe(true);
  });
});

describe('Profil de la personne connectée', () => {
  const user = (over: any = {}) => fakeDb((sql) => (sql.startsWith('SELECT id, role, sex') ? [{ id: 7, role: 'customer', sex: null, birth_date: null, ...over }] : []));

  it('nom et téléphone contrôlés ; date de naissance et sexe enregistrés s’ils manquent', async () => {
    const { db, calls } = user();
    const ctl = new ProfilePhotoController(db);
    await expect(ctl.updateProfile({ phone: '01ab' }, { user: { id: 7 } })).rejects.toThrow('que des chiffres');
    await expect(ctl.updateProfile({ name: 'Awa 3' }, { user: { id: 7 } })).rejects.toThrow('lettres');
    await ctl.updateProfile({ name: 'Awa Houndé', phone: '0197000000', birth_date: '2006-05-01', sex: 'female' }, { user: { id: 7 } });
    const up = calls.find((c) => c.sql.startsWith('UPDATE users SET'));
    expect(up.params).toEqual(['Awa Houndé', '2006-05-01', 'female', 7]);
    expect(calls.some((c) => c.sql.startsWith('INSERT INTO profiles') && c.params[1] === '0197000000')).toBe(true);
  });

  it('date de naissance et sexe déjà renseignés : verrouillés (le ciblage ne peut pas être contourné)', async () => {
    const { db, calls } = user({ sex: 'female', birth_date: '2006-05-01' });
    const ctl = new ProfilePhotoController(db);
    await expect(ctl.updateProfile({ sex: 'male' }, { user: { id: 7 } })).rejects.toThrow('déjà renseigné');
    await expect(ctl.updateProfile({ birth_date: '1990-01-01' }, { user: { id: 7 } })).rejects.toThrow('déjà renseignée');
    // Même valeur renvoyée par le formulaire : acceptée sans écriture de ces champs
    await ctl.updateProfile({ sex: 'female', birth_date: '2006-05-01' }, { user: { id: 7 } });
    expect(calls.some((c) => c.sql.startsWith('UPDATE users SET'))).toBe(false);
  });
});

describe('Retrait d’un kit : public ciblé revérifié', () => {
  const REG = { id: 3, campaign_id: 1, email: 'awa@t.io', pickup_center: '20', otp_used: 1, picked_up: 0 };
  const db = (campaign: any, person: any) => fakeDb((sql) => {
    if (sql.startsWith('SELECT * FROM campaign_registrations')) return [REG];
    if (sql.startsWith('SELECT target_sex')) return [campaign];
    if (sql.startsWith('SELECT sex, DATE_FORMAT')) return [person];
    return [];
  });

  it('hors cible : retrait refusé ; campagne sans ciblage : aucun contrôle ; dans la cible : retrait', async () => {
    const t = { target_sex: 'female', target_age_min: 15, target_age_max: 24 };
    const out = db(t, { sex: 'male', birth_date: '2006-05-01' });
    await expect(new CampaignsService(out.db).markPickup({ registration_id: 3 }, 20)).rejects.toThrow('Retrait impossible');
    expect(out.calls.some((c) => c.sql.includes('SET r.picked_up = 1'))).toBe(false);

    const none = db({ target_sex: 'all', target_age_min: null, target_age_max: null }, undefined);
    await new CampaignsService(none.db).markPickup({ registration_id: 3 }, 20);
    expect(none.calls.some((c) => c.sql.startsWith('SELECT sex, DATE_FORMAT'))).toBe(false);

    const ok = db(t, { sex: 'female', birth_date: '2006-05-01' });
    await new CampaignsService(ok.db).markPickup({ registration_id: 3 }, 20);
    expect(ok.calls.some((c) => c.sql.includes('SET r.picked_up = 1'))).toBe(true);
  });
});
