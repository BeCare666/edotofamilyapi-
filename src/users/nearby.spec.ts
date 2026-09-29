import { UsersService } from './users.service';

function fakeDb(rows: any[], total = rows.length) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    // Requête de total : « SELECT COUNT(*) as total » (la liste contient aussi un COUNT(*) en sous-requête)
    return [/^\s*SELECT COUNT\(\*\) as total/i.test(sql) ? [{ total }] : rows, []];
  });
  return { calls, db: { getPool: () => ({ query }), query } as any };
}

describe('Points de retrait les plus proches', () => {
  it('avec position + rayon : filtre par distance, tri croissant, paramètres liés', async () => {
    const { db, calls } = fakeDb([{ id: 1, name: 'A', is_active: 1, distance_km: 1.23456 }]);
    const res: any = await new UsersService(db).getPublicUsersByRole({
      role: 'super_pickuppoint', lat: '6.37', lng: '2.39', radius_km: '5', limit: 50,
    } as any);
    const q = calls[0];
    expect(q.sql).toContain('ASIN');
    expect(q.sql).toContain('t.distance_km <= ?');
    expect(q.sql).toContain('ORDER BY t.distance_km IS NULL, t.distance_km ASC');
    expect(q.sql).toContain('pickup_approved = 1');
    expect(q.params).toEqual([6.37, 6.37, 2.39, 'super_pickuppoint', 5, 50, 0]);
    expect(res.data[0].distance_km).toBe(1.23);
    expect(res.data[0].status).toBe('active');
  });

  it('avec position sans rayon : tous les points triés, sans coordonnées en dernier', async () => {
    const { db, calls } = fakeDb([]);
    await new UsersService(db).getPublicUsersByRole({ role: 'super_pickuppoint', lat: 6.37, lng: 2.39 } as any);
    expect(calls[0].sql).not.toContain('<= ?');
    expect(calls[0].sql).toContain('ORDER BY t.distance_km IS NULL');
  });

  it.each([
    ['rayon > 50 km ignoré', { lat: 6.37, lng: 2.39, radius_km: 500 }, false],
    ['rayon négatif ignoré', { lat: 6.37, lng: 2.39, radius_km: -1 }, false],
  ])('%s', async (_l, extra, hasRadius) => {
    const { db, calls } = fakeDb([]);
    await new UsersService(db).getPublicUsersByRole({ role: 'super_pickuppoint', ...extra } as any);
    expect(calls[0].sql.includes('<= ?')).toBe(hasRadius);
  });

  it('position invalide ou injection : liste simple, aucune valeur interpolée', async () => {
    const { db, calls } = fakeDb([]);
    await new UsersService(db).getPublicUsersByRole({
      role: 'super_pickuppoint', lat: "6.3); DROP TABLE users; --", lng: '2.39', radius_km: '5',
    } as any);
    expect(calls[0].sql).not.toContain('ASIN');
    expect(calls[0].sql).not.toContain('DROP');
  });

  it('sans position : comportement inchangé (distance null)', async () => {
    const { db, calls } = fakeDb([{ id: 2, name: 'B', is_active: 0 }]);
    const res: any = await new UsersService(db).getPublicUsersByRole({ role: 'super_pickuppoint' } as any);
    expect(calls[0].sql).not.toContain('ASIN');
    expect(res.data[0]).toEqual(expect.objectContaining({ distance_km: null, status: 'blocked' }));
  });

  it('D3 : nombre de retraits = commandes retirées + kits retirés du point, avec ou sans position', async () => {
    const withPos = fakeDb([{ id: 1, name: 'A', is_active: 1, distance_km: 1, withdrawals_count: '3' }]);
    const res: any = await new UsersService(withPos.db).getPublicUsersByRole({ role: 'super_pickuppoint', lat: 6.37, lng: 2.39 } as any);
    expect(withPos.calls[0].sql).toContain("o.pickup_point_id = t.id AND o.order_status = 'order-completed'");
    expect(withPos.calls[0].sql).toContain('cr.pickup_center = CAST(t.id AS CHAR) AND cr.picked_up = 1');
    expect(withPos.calls[1].sql).not.toContain('FROM orders');
    expect(res.data[0].withdrawals_count).toBe(3);

    const noPos = fakeDb([{ id: 2, name: 'B', is_active: 1, withdrawals_count: null }]);
    const res2: any = await new UsersService(noPos.db).getPublicUsersByRole({ role: 'super_pickuppoint' } as any);
    expect(noPos.calls[0].sql).toContain("o.pickup_point_id = users.id AND o.order_status = 'order-completed'");
    expect(res2.data[0].withdrawals_count).toBe(0);
  });
});
