import {
  beninToUtc,
  cleanAvailability,
  formatShortCode,
  freeSlots,
  houseGaps,
  newReference,
  newShortCode,
  normalizeShortCode,
  weekdayOf,
} from './tc-rules';
import { parseLegacySearch } from '../common/legacy-search';
import { smsRecipient } from './tc-notify';

describe('Téléconsultation : règles', () => {
  it('convertit une heure du Bénin en UTC (UTC+1)', () => {
    expect(beninToUtc('2026-10-20', 9 * 60).toISOString()).toBe('2026-10-20T08:00:00.000Z');
  });

  it('numérote les jours du lundi (1) au dimanche (7)', () => {
    expect(weekdayOf('2026-10-19')).toBe(1); // lundi
    expect(weekdayOf('2026-10-25')).toBe(7); // dimanche
  });

  it('découpe les plages en créneaux et retire les créneaux pris, passés ou trop proches', () => {
    const rules = [{ weekday: 2, start_time: '09:00', end_time: '11:00', modes: 'both' }]; // mardi
    const busy = [{ starts_at: new Date('2026-10-20T08:30:00Z'), ends_at: new Date('2026-10-20T09:00:00Z') }]; // 9h30 Bénin
    const slots = freeSlots({ rules, timeOff: [], busy, slotMinutes: 30, fromDay: '2026-10-20', toDay: '2026-10-20', now: new Date('2026-10-19T12:00:00Z') });
    expect(slots.map((s) => s.toISOString())).toEqual(['2026-10-20T08:00:00.000Z', '2026-10-20T09:00:00.000Z', '2026-10-20T09:30:00.000Z']);
    // Maintenant = 8h50 Bénin : délai minimum de 30 min → premier créneau 9h30 (pris) puis 10h
    const later = freeSlots({ rules, timeOff: [], busy, slotMinutes: 30, fromDay: '2026-10-20', toDay: '2026-10-20', now: new Date('2026-10-20T07:50:00Z') });
    expect(later.map((s) => s.toISOString())).toEqual(['2026-10-20T09:00:00.000Z', '2026-10-20T09:30:00.000Z']);
  });

  it('respecte les jours d’absence et le mode de la plage', () => {
    const rules = [{ weekday: 2, start_time: '09:00', end_time: '10:00', modes: 'phone' }];
    const base = { rules, busy: [], slotMinutes: 30, fromDay: '2026-10-20', toDay: '2026-10-20', now: new Date('2026-10-01T00:00:00Z') };
    expect(freeSlots({ ...base, timeOff: [{ date_from: '2026-10-20', date_to: '2026-10-21' }] })).toHaveLength(0);
    expect(freeSlots({ ...base, timeOff: [], mode: 'video' })).toHaveLength(0);
    expect(freeSlots({ ...base, timeOff: [], mode: 'phone' })).toHaveLength(2);
  });

  it('refuse les plages qui se chevauchent ou inversées', () => {
    expect(() => cleanAvailability([{ weekday: 1, start_time: '09:00', end_time: '12:00' }, { weekday: 1, start_time: '11:00', end_time: '13:00' }])).toThrow();
    expect(() => cleanAvailability([{ weekday: 1, start_time: '12:00', end_time: '09:00' }])).toThrow();
    expect(cleanAvailability([{ weekday: 1, start_time: '09:00', end_time: '12:00' }, { weekday: 1, start_time: '14:00', end_time: '17:00', modes: 'video' }])).toHaveLength(2);
  });

  it('produit des codes lisibles et les relit sans espaces ni casse', () => {
    const code = newShortCode();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(normalizeShortCode(` ${formatShortCode(code).toLowerCase()} `)).toBe(code);
    expect(newReference()).toMatch(/^TC[A-Z2-9]{6}$/);
  });

  it('formate le numéro SMS au format international (Bénin par défaut)', () => {
    expect(smsRecipient('+229 01 97 00 00 00')).toBe('2290197000000');
    expect(smsRecipient('0197000000')).toBe('2290197000000');
    expect(smsRecipient('')).toBeNull();
  });
});

describe('Recherche des anciennes listes admin', () => {
  it('lit le format « name:texte » et le texte simple', () => {
    expect(parseLegacySearch('name:Boutique Edoto').text).toBe('Boutique Edoto');
    expect(parseLegacySearch('name:abc;is_active:true').fields.is_active).toBe('true');
    expect(parseLegacySearch('serviettes').text).toBe('serviettes');
    expect(parseLegacySearch('').text).toBe('');
  });
});

describe('Téléconsultation : médecin E.doto family', () => {
  const at = (h: number, m = 0) => beninToUtc('2026-10-20', h * 60 + m);
  it('ne garde que les heures où aucun autre médecin n’est libre', () => {
    const house = [at(9), at(9, 30), at(10), at(10, 30)];
    const others = [{ start: at(9, 30), minutes: 30 }, { start: at(10, 15), minutes: 20 }];
    expect(houseGaps(house, 30, others).map((d) => d.toISOString())).toEqual([at(9).toISOString()]);
  });
  it('garde toutes ses heures quand aucun autre médecin n’est libre', () => {
    const house = [at(14), at(14, 30)];
    expect(houseGaps(house, 30, [])).toHaveLength(2);
  });
});

describe('Téléconsultation : accès des routes', () => {
  // Rôle exigé par chaque espace (métadonnée @Roles lue par RolesGuard)
  const { ROLES_KEY } = require('../auth/roles.decorator');
  const c = require('./teleconsultation.controller');
  const roles = (ctrl: any) => Reflect.getMetadata(ROLES_KEY, ctrl);
  it('réserve chaque espace à son rôle', () => {
    expect(roles(c.TcPatientController)).toEqual(['customer']);
    expect(roles(c.TcDoctorController)).toEqual(['doctor']);
    expect(roles(c.TcCenterController)).toEqual(['health_center']);
    expect(roles(c.TcAdminController)).toEqual(['super_admin']);
    expect(roles(c.TcPublicController)).toBeUndefined();
  });
});
