// Tournées de retrait 09 h / 17 h (12/11/2026, rapports/PLAN_TOURNEES_RETRAIT.md, 1.3)
import { loadSettings } from '../platform-settings/platform-settings.store';
import {
  ALWAYS_OPEN,
  OpeningRule,
  allDaysOpen,
  closingConflicts,
  codeExpiry,
  formatRound,
  nextRound,
  parseOpeningRule,
  rescheduledRound,
  roundHours,
  roundSettingsError,
  currentRoundHours,
} from './pickup-rounds';

// Heure du Bénin = UTC+1 : « 2026-11-12 07:59 » au Bénin = 06:59Z
const benin = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00+01:00`);
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const rule = (closed: Partial<OpeningRule['days']> = {}, closures: OpeningRule['closures'] = []): OpeningRule => ({
  days: { ...allDaysOpen(), ...closed },
  closures,
});

// 12/11/2026 = jeudi
describe('tournées : calcul (D1)', () => {
  beforeEach(() => loadSettings([]));

  it('avant 08 h 00 → le jour même à 09 h 00', () => {
    expect(iso(nextRound(benin('2026-11-12', '07:59')))).toBe(iso(benin('2026-11-12', '09:00')));
    expect(iso(nextRound(benin('2026-11-12', '00:00')))).toBe(iso(benin('2026-11-12', '09:00')));
  });

  it('de 08 h 00 à 16 h 00 → 17 h 00', () => {
    expect(iso(nextRound(benin('2026-11-12', '08:00')))).toBe(iso(benin('2026-11-12', '17:00')));
    expect(iso(nextRound(benin('2026-11-12', '15:59')))).toBe(iso(benin('2026-11-12', '17:00')));
  });

  it('à partir de 16 h 00 → lendemain 09 h 00', () => {
    expect(iso(nextRound(benin('2026-11-12', '16:00')))).toBe(iso(benin('2026-11-13', '09:00')));
    expect(iso(nextRound(benin('2026-11-12', '23:59')))).toBe(iso(benin('2026-11-13', '09:00')));
  });

  it('passage de minuit (23 h 30 au Bénin = 22 h 30 UTC, même jour UTC) et fin de mois', () => {
    expect(iso(nextRound(new Date('2026-11-12T22:30:00Z')))).toBe(iso(benin('2026-11-13', '09:00')));
    expect(iso(nextRound(new Date('2026-11-12T23:30:00Z')))).toBe(iso(benin('2026-11-13', '09:00')));
    expect(iso(nextRound(benin('2026-11-30', '18:00')))).toBe(iso(benin('2026-12-01', '09:00')));
    expect(iso(nextRound(benin('2026-12-31', '18:00')))).toBe(iso(benin('2027-01-01', '09:00')));
  });

  it('tournées tous les jours, dimanche compris (D3)', () => {
    expect(iso(nextRound(benin('2026-11-14', '18:00')))).toBe(iso(benin('2026-11-15', '09:00')));
  });

  it('D7 : depuis l’heure d’une tournée, on obtient la suivante', () => {
    expect(iso(nextRound(benin('2026-11-12', '09:00')))).toBe(iso(benin('2026-11-12', '17:00')));
    expect(iso(nextRound(benin('2026-11-12', '17:00')))).toBe(iso(benin('2026-11-13', '09:00')));
  });
});

describe('tournées : jours d’ouverture du point (D8, D9)', () => {
  beforeEach(() => loadSettings([]));

  it('point fermé le jour même → premier jour ouvert à 09 h 00', () => {
    // Dimanche 15/11 fermé : payé dimanche 07 h → lundi 09 h ; payé samedi 18 h → lundi 09 h
    const r = rule({ sun: false });
    expect(iso(nextRound(benin('2026-11-15', '07:00'), r))).toBe(iso(benin('2026-11-16', '09:00')));
    expect(iso(nextRound(benin('2026-11-14', '18:00'), r))).toBe(iso(benin('2026-11-16', '09:00')));
    // Fermé le jour même alors que la tournée du soir était prévue : lendemain 09 h, pas 17 h
    expect(iso(nextRound(benin('2026-11-15', '10:00'), r))).toBe(iso(benin('2026-11-16', '09:00')));
  });

  it('plusieurs jours de congé', () => {
    const r = rule({}, [{ from: '2026-11-13', to: '2026-11-16' }]);
    expect(iso(nextRound(benin('2026-11-12', '17:30'), r))).toBe(iso(benin('2026-11-17', '09:00')));
    expect(iso(nextRound(benin('2026-11-12', '10:00'), r))).toBe(iso(benin('2026-11-12', '17:00')));
  });

  it('congé et jour de semaine fermés ensemble', () => {
    const r = rule({ mon: false }, [{ from: '2026-11-14', to: '2026-11-15' }]);
    expect(iso(nextRound(benin('2026-11-13', '20:00'), r))).toBe(iso(benin('2026-11-17', '09:00')));
  });

  it('aucun jour ouvert → null', () => {
    const days = allDaysOpen();
    for (const d of Object.keys(days)) (days as any)[d] = false;
    expect(nextRound(benin('2026-11-12', '07:00'), { days, closures: [] })).toBeNull();
  });
});

describe('tournées : réglages du super admin (D5)', () => {
  afterEach(() => loadSettings([]));

  it('heures réglées prises en compte', () => {
    loadSettings([
      { setting_key: 'pickup.morning_cutoff_hour', value: '7' },
      { setting_key: 'pickup.morning_round_hour', value: '10' },
      { setting_key: 'pickup.evening_cutoff_hour', value: '14' },
      { setting_key: 'pickup.evening_round_hour', value: '18' },
    ]);
    expect(iso(nextRound(benin('2026-11-12', '07:30')))).toBe(iso(benin('2026-11-12', '18:00')));
    expect(iso(nextRound(benin('2026-11-12', '06:59')))).toBe(iso(benin('2026-11-12', '10:00')));
    expect(iso(nextRound(benin('2026-11-12', '14:00')))).toBe(iso(benin('2026-11-13', '10:00')));
  });

  it('ordre imposé à l’enregistrement', () => {
    expect(roundSettingsError({ ...currentRoundHours(), 'pickup.morning_cutoff_hour': 9 }, 'pickup.morning_cutoff_hour')).toMatch(/ordre/);
    expect(roundSettingsError({ ...currentRoundHours(), 'pickup.evening_round_hour': 16 }, 'pickup.evening_round_hour')).toMatch(/ordre/);
    expect(roundSettingsError({ ...currentRoundHours(), 'pickup.evening_round_hour': 20 }, 'pickup.evening_round_hour')).toBeNull();
    expect(roundSettingsError({ ...currentRoundHours() }, 'tc.min_lead_hours')).toBeNull();
  });

  it('valeurs incohérentes en base → valeurs d’origine', () => {
    loadSettings([{ setting_key: 'pickup.morning_cutoff_hour', value: '12' }]);
    expect(roundHours()).toEqual({ morningCutoff: 8, morningRound: 9, eveningCutoff: 16, eveningRound: 17 });
  });
});

describe('tournées : code et textes (D6, Q4)', () => {
  it('code valable à partir de l’heure de disponibilité', () => {
    expect(iso(codeExpiry(benin('2026-11-12', '17:00'), 48))).toBe(iso(benin('2026-11-14', '17:00')));
  });

  it('jour et heure en français', () => {
    expect(formatRound(benin('2026-11-12', '09:00'))).toEqual({ day: 'jeudi 12 novembre', hour: '09 h 00' });
    expect(formatRound(benin('2026-11-15', '17:00'))).toEqual({ day: 'dimanche 15 novembre', hour: '17 h 00' });
  });
});

describe('tournées : changement des jours d’un point (D10, D11, Q1-Q3)', () => {
  const now = benin('2026-11-12', '10:00');
  const parcel = (at: Date, hours = 48) => ({ available_at: at, otp_expires_at: codeExpiry(at, hours) });

  it('Q1 : colis prévu ou présent ce jour-là → refus', () => {
    // Arrive vendredi 09 h, code valable 48 h → vendredi, samedi, dimanche
    const p = [parcel(benin('2026-11-13', '09:00'))];
    expect(closingConflicts(ALWAYS_OPEN, rule({ sat: false }), p, now)).toEqual(['2026-11-14']);
    expect(closingConflicts(ALWAYS_OPEN, rule({}, [{ from: '2026-11-13', to: '2026-11-13' }]), p, now)).toEqual(['2026-11-13']);
  });

  it('Q1 : congé plus tard, sans colis ces jours-là → accepté', () => {
    const p = [parcel(benin('2026-11-13', '09:00'))];
    expect(closingConflicts(ALWAYS_OPEN, rule({}, [{ from: '2026-11-20', to: '2026-11-25' }]), p, now)).toEqual([]);
  });

  it('Q2 : jour de semaine décoché, même règle', () => {
    const p = [parcel(benin('2026-11-12', '17:00'))];
    expect(closingConflicts(ALWAYS_OPEN, rule({ thu: false }), p, now)).toEqual(['2026-11-12']);
  });

  it('Q3 : code expiré → ne bloque plus', () => {
    const p = [parcel(benin('2026-11-09', '09:00'))]; // expiré le 11/11
    expect(closingConflicts(ALWAYS_OPEN, rule({ thu: false, fri: false }), p, now)).toEqual([]);
  });

  it('jour déjà fermé avant le changement : ne bloque pas un autre réglage', () => {
    const before = rule({ sat: false });
    const p = [parcel(benin('2026-11-13', '09:00'))];
    expect(closingConflicts(before, rule({ sat: false }, [{ from: '2026-11-30', to: '2026-11-30' }]), p, now)).toEqual([]);
  });

  it('D10 : jour rouvert → heure plus proche ; jour devenu fermé → tournée suivante ; sinon inchangée', () => {
    const sat = benin('2026-11-14', '18:00');
    // Prévu lundi 09 h car dimanche fermé ; le point rouvre le dimanche → dimanche 09 h
    expect(iso(rescheduledRound(benin('2026-11-16', '09:00'), ALWAYS_OPEN, sat))).toBe(iso(benin('2026-11-15', '09:00')));
    // Jour prévu toujours ouvert et déjà le plus proche : inchangé
    expect(rescheduledRound(benin('2026-11-15', '09:00'), ALWAYS_OPEN, sat)).toBeNull();
    // Prévu 17 h aujourd'hui, réglage changé à 16 h 30 : surtout pas reporté au lendemain
    expect(rescheduledRound(benin('2026-11-12', '17:00'), ALWAYS_OPEN, benin('2026-11-12', '16:30'))).toBeNull();
    // Jour prévu devenu fermé
    expect(iso(rescheduledRound(benin('2026-11-15', '09:00'), rule({ sun: false }), sat))).toBe(iso(benin('2026-11-16', '09:00')));
  });
});

describe('tournées : réglage envoyé par le point', () => {
  const now = benin('2026-11-12', '10:00');

  it('au moins un jour coché', () => {
    const days = { mon: false, tue: false, wed: false, thu: false, fri: false, sat: false, sun: false };
    expect(parseOpeningRule({ days }, now).error).toMatch(/au moins un jour/);
  });

  it('dates contrôlées, congés passés retirés, tri', () => {
    expect(parseOpeningRule({ closures: [{ from: '2026-02-30', to: '2026-03-01' }] }, now).error).toMatch(/invalide/);
    expect(parseOpeningRule({ closures: [{ from: '2026-11-20', to: '2026-11-18' }] }, now).error).toMatch(/fin est avant/);
    const { rule: r, error } = parseOpeningRule(
      { days: { sun: false }, closures: [{ from: '2026-12-24', to: '2026-12-26' }, { from: '2026-10-01', to: '2026-10-02' }, { from: '2026-11-20' }] },
      now,
    );
    expect(error).toBeUndefined();
    expect(r.days.sun).toBe(false);
    expect(r.days.mon).toBe(true);
    expect(r.closures).toEqual([{ from: '2026-11-20', to: '2026-11-20' }, { from: '2026-12-24', to: '2026-12-26' }]);
  });
});
