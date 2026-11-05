import { beninNow, isDue, isOccurrenceDay, isValidDate, parseTime, Reminder } from './reminder-rules';

// Rappel contraception à rythme libre (04/11/2026) : jours de rappel, heure du Bénin, un seul envoi par jour.
const utc = (s: string) => new Date(`${s}Z`);
const base: Reminder = { rhythm: 'daily', time_hm: '08:00', start_date: '2026-11-04', active: true, last_sent_at: null };

describe('Rappel contraception : règles', () => {
  it('heure du Bénin = UTC + 1', () => {
    expect(beninNow(utc('2026-11-04T23:30:00'))).toEqual({ date: '2026-11-05', minutes: 30 });
  });

  it('jours de rappel selon le rythme', () => {
    expect(isOccurrenceDay('daily', '2026-11-04', '2026-11-03')).toBe(false);
    expect(isOccurrenceDay('daily', '2026-11-04', '2026-11-20')).toBe(true);
    expect(isOccurrenceDay('weekly', '2026-11-04', '2026-11-11')).toBe(true);
    expect(isOccurrenceDay('weekly', '2026-11-04', '2026-11-12')).toBe(false);
    expect(isOccurrenceDay('every4weeks', '2026-11-04', '2026-12-02')).toBe(true);
    expect(isOccurrenceDay('every4weeks', '2026-11-04', '2026-11-25')).toBe(false);
    expect(isOccurrenceDay('every3months', '2026-11-04', '2027-02-04')).toBe(true);
    expect(isOccurrenceDay('every3months', '2026-11-04', '2026-12-04')).toBe(false);
    expect(isOccurrenceDay('every3months', '2027-01-31', '2027-04-30')).toBe(true);
    expect(isOccurrenceDay('once', '2026-11-04', '2026-11-04')).toBe(true);
    expect(isOccurrenceDay('once', '2026-11-04', '2026-11-05')).toBe(false);
  });

  it('heure et date valides seulement', () => {
    expect(parseTime('08:05')).toBe(485);
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('8:05')).toBeNull();
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
  });

  it('part à l’heure (Bénin), pas avant, et une seule fois par jour', () => {
    expect(isDue(base, utc('2026-11-04T06:59:00'))).toBe(false); // 07:59 au Bénin
    expect(isDue(base, utc('2026-11-04T07:00:00'))).toBe(true); // 08:00 au Bénin
    expect(isDue({ ...base, last_sent_at: utc('2026-11-04T07:00:30') }, utc('2026-11-04T07:05:00'))).toBe(false);
    expect(isDue({ ...base, last_sent_at: utc('2026-11-03T07:00:30') }, utc('2026-11-04T07:05:00'))).toBe(true);
  });

  it('rappel manqué de plus de 2 h : pas envoyé ; arrêté : jamais', () => {
    expect(isDue(base, utc('2026-11-04T09:01:00'))).toBe(false);
    expect(isDue({ ...base, active: false }, utc('2026-11-04T07:00:00'))).toBe(false);
  });
});
