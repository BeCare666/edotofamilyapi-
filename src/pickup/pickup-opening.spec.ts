// Tournées de retrait (12/11/2026, rapports/PLAN_TOURNEES_RETRAIT.md, 1.7, 1.8, 1.9) : base simulée
import { BadRequestException } from '@nestjs/common';
import { loadSettings } from '../platform-settings/platform-settings.store';
import { PickupRoundsCron } from './pickup-rounds.cron';
import { PickupOpeningService } from './pickup-opening.service';

type Handler = (sql: string, params: any[]) => any;
function fakeDb(handler: Handler) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    return [handler(sql, params) ?? [], []];
  });
  const conn = { query, beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn().mockResolvedValue(undefined), release: jest.fn() };
  const pool = { query, getConnection: jest.fn(async () => conn) };
  return { calls, conn, db: { getPool: () => pool } as any };
}
const benin = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00+01:00`);

beforeEach(() => {
  loadSettings([]);
  delete process.env.PUSH_CRON;
});
// Horloge figée : seul Date est remplacé (les minuteries réelles restent)
const RealDate = Date;
function freeze(at: Date) {
  const fixed = at.getTime();
  class FrozenDate extends RealDate {
    constructor(...args: any[]) {
      super(...((args.length ? args : [fixed]) as [any]));
    }
    static now() {
      return fixed;
    }
  }
  (global as any).Date = FrozenDate;
}
afterEach(() => {
  (global as any).Date = RealDate;
});

describe('tâche des tournées (1.7)', () => {
  it('colis traité → « disponible » réservé une seule fois ; non traité → tournée suivante et code prolongé (D6, D7)', async () => {
    freeze(benin('2026-11-12', '09:00'));
    const round = benin('2026-11-12', '09:00');
    const { db, calls } = fakeDb((sql) => {
      if (sql.includes('FROM orders o') && sql.includes('available_notified_at IS NULL')) {
        return [
          { id: 1, pickup_point_id: 3, processed_at: new Date(), available_at: round },
          { id: 2, pickup_point_id: 3, processed_at: null, available_at: round },
        ];
      }
      if (sql.startsWith('UPDATE')) return { affectedRows: 1 };
      return [];
    });
    await new PickupRoundsCron(db).tick();
    const updates = calls.filter((c) => c.sql.startsWith('UPDATE orders'));
    expect(updates[0].sql).toContain('SET available_notified_at = UTC_TIMESTAMP()');
    expect(updates[0].sql).toContain('available_notified_at IS NULL');
    expect(updates[0].params).toEqual([1, round]);
    expect(updates[1].sql).toContain('processed_at IS NULL');
    const [next, expires, id, old] = updates[1].params;
    expect(next.toISOString()).toBe(benin('2026-11-12', '17:00').toISOString());
    expect(expires.getTime() - next.getTime()).toBe(48 * 3600000);
    expect([id, old]).toEqual([2, round]);
  });

  it('serveur arrêté longtemps : jamais reporté à une heure déjà passée', async () => {
    freeze(benin('2026-11-14', '10:00'));
    const { db, calls } = fakeDb((sql) => {
      if (sql.includes('FROM campaign_registrations r') && sql.includes('available_notified_at IS NULL')) {
        return [{ id: 7, email: 'a@t.io', pickup_center: '3', processed_at: null, available_at: benin('2026-11-12', '09:00') }];
      }
      if (sql.startsWith('UPDATE')) return { affectedRows: 1 };
      return [];
    });
    await new PickupRoundsCron(db).tick();
    const u = calls.find((c) => c.sql.startsWith('UPDATE campaign_registrations'));
    expect(u!.params[0].toISOString()).toBe(benin('2026-11-14', '17:00').toISOString());
  });

  it('PUSH_CRON=off : rien n’est lu ni envoyé', async () => {
    process.env.PUSH_CRON = 'off';
    const { db, calls } = fakeDb(() => []);
    await new PickupRoundsCron(db).tick();
    expect(calls).toHaveLength(0);
  });
});

describe('jours d’ouverture du point (1.8)', () => {
  it('D11 : un colis attendu ce jour-là → refus, rien n’est enregistré', async () => {
    freeze(benin('2026-11-12', '10:00'));
    const at = benin('2026-11-15', '09:00'); // dimanche
    const { db, calls } = fakeDb((sql) => {
      if (sql.includes('FROM orders o') && sql.includes('o.available_at, o.otp_expires_at')) {
        return [{ available_at: at, otp_expires_at: new Date(at.getTime() + 48 * 3600000) }];
      }
      return [];
    });
    const err = await new PickupOpeningService(db).save(3, { days: { sun: false } }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/dimanche 15 novembre/);
    expect(calls.some((c) => c.sql.startsWith('INSERT') || c.sql.startsWith('DELETE'))).toBe(false);
  });

  it('enregistrement puis recalcul des colis pas encore arrivés (D10)', async () => {
    freeze(benin('2026-11-14', '18:00')); // samedi
    const monday = benin('2026-11-16', '09:00');
    const { db, calls, conn } = fakeDb((sql) => {
      // Avant : fermé le dimanche
      if (sql.includes('FROM pickup_open_days')) return [{ mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 1, sun: 0 }];
      if (sql.includes('FROM orders o') && sql.includes('o.id, o.available_at')) return [{ id: 9, available_at: monday }];
      if (sql.startsWith('UPDATE')) return { affectedRows: 1 };
      return [];
    });
    const res: any = await new PickupOpeningService(db).save(3, { days: { sun: true }, closures: [{ from: '2026-12-24', to: '2026-12-25' }] });
    expect(conn.commit).toHaveBeenCalled();
    expect(calls.find((c) => c.sql.startsWith('INSERT INTO pickup_open_days'))!.params).toEqual([3, 1, 1, 1, 1, 1, 1, 1]);
    expect(calls.find((c) => c.sql.startsWith('INSERT INTO pickup_closures'))!.params).toEqual([[[3, '2026-12-24', '2026-12-25']]]);
    // Rouvert le dimanche : la commande prévue lundi 09 h passe à dimanche 09 h
    const u = calls.find((c) => c.sql.startsWith('UPDATE orders SET available_at'));
    expect(u!.params[0].toISOString()).toBe(benin('2026-11-15', '09:00').toISOString());
    expect(res.message).toMatch(/1 client a reçu la nouvelle heure/);
  });

  it('au moins un jour coché', async () => {
    const { db } = fakeDb(() => []);
    const days = { mon: false, tue: false, wed: false, thu: false, fri: false, sat: false, sun: false };
    await expect(new PickupOpeningService(db).save(3, { days })).rejects.toThrow('au moins un jour');
  });
});

describe('route publique (1.9)', () => {
  it('point fermé le dimanche : disponible lundi à 09 h 00, mention du jour fermé ; ids contrôlés', async () => {
    freeze(benin('2026-11-14', '18:00'));
    const { db, calls } = fakeDb((sql) => {
      if (sql.includes("role = 'super_pickuppoint'")) return [{ id: 3 }];
      if (sql.includes('FROM pickup_open_days')) return [{ mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 1, sun: 0 }];
      return [];
    });
    const out = await new PickupOpeningService(db).nextForPoints('3,abc,-1,3');
    expect(calls[0].params).toEqual([[3]]);
    expect(out).toEqual([{ id: 3, available_at: benin('2026-11-16', '09:00'), day: 'lundi 16 novembre', hour: '09 h 00', closed_on: 'dimanche' }]);
  });
});
