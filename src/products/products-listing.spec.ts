import { ProductsService } from './products.service';

function fakeDb(total = 3, rows: any[] = [{ id: 1, name: 'A', shop_id: 2, shop_slug: 's', shop_name: 'S' }]) {
  const calls: { sql: string; params: any[] }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight--;
    return [sql.includes('COUNT(*)') ? [{ total }] : rows, []];
  });
  return { calls, db: { getPool: () => ({ query }) } as any, maxInFlight: () => maxInFlight };
}

describe('C1 — liste publique des produits', () => {
  it('total et page en parallèle, en 2 requêtes ; même forme de réponse', async () => {
    const { db, calls, maxInFlight } = fakeDb();
    const res: any = await new ProductsService(db).getProductsByCorridor({ categories_id: '3' } as any);
    expect(calls).toHaveLength(2);
    expect(maxInFlight()).toBe(2);
    expect(res).toEqual({
      data: [{ id: 1, name: 'A', shop_id: 2, shop_slug: 's', shop_name: 'S', shop: { id: 2, slug: 's', name: 'S' } }],
      total: 3, limit: 20, offset: 0,
    });
  });

  it('catégorie en sous-requête ; sans filtre corridor : ni jointure corridors ni DISTINCT', async () => {
    const { db, calls } = fakeDb();
    await new ProductsService(db).getProductsByCorridor({ categories_id: '3' } as any);
    for (const c of calls) {
      expect(c.sql).toContain('p.id IN (SELECT product_id FROM product_categories WHERE categories_id = ?)');
      expect(c.sql).not.toContain('corridors_produits');
      expect(c.sql).not.toContain('DISTINCT');
      expect(c.sql).toContain('p.status = ?');
    }
    expect(calls[0].params).toEqual(['publish', 3]);
  });

  it('filtre corridor : sous-requête sur produit_id', async () => {
    const { db, calls } = fakeDb();
    await new ProductsService(db).getProductsByCorridor({ corridor_id: '4' } as any);
    expect(calls[0].sql).toContain('SELECT produit_id FROM corridors_produits WHERE corridor_id = ?');
  });

  it('prix min/max et tri sur le prix payé (promo sinon prix)', async () => {
    const { db, calls } = fakeDb();
    await new ProductsService(db).getProductsByCorridor({ min_price: '100', max_price: '1000', orderBy: 'price', sortedBy: 'asc' } as any);
    const data = calls.find((c) => c.sql.includes('LIMIT'));
    expect(data.sql).toContain('COALESCE(p.sale_price, p.price) >= ?');
    expect(data.sql).toContain('COALESCE(p.sale_price, p.price) <= ?');
    expect(data.sql).toContain('ORDER BY COALESCE(p.sale_price, p.price) ASC');
    expect(data.params).toEqual(['publish', 100, 1000, 20, 0]);
  });

  it('is_origin : « false » ne filtre plus ; « true » filtre', async () => {
    const off = fakeDb();
    await new ProductsService(off.db).getProductsByCorridor({ is_origin: 'false' } as any);
    expect(off.calls[0].sql).not.toContain('is_origin');
    const on = fakeDb();
    await new ProductsService(on.db).getProductsByCorridor({ is_origin: 'true' } as any);
    expect(on.calls[0].sql).toContain('p.is_origin = ?');
  });

  it('tri inconnu ou injection : repli sur la date, valeurs jamais interpolées ; limite bornée', async () => {
    const { db, calls } = fakeDb();
    const res: any = await new ProductsService(db).getProductsByCorridor({
      orderBy: 'id; DROP TABLE products', sortedBy: 'sideways', search: "x' OR 1=1 --", limit: '5000', offset: '-3',
    } as any);
    const data = calls.find((c) => c.sql.includes('LIMIT'));
    expect(data.sql).toContain('ORDER BY p.created_at DESC');
    expect(data.sql).not.toContain('DROP');
    expect(data.params).toEqual(['publish', "%x' OR 1=1 --%", 100, 0]);
    expect(res.limit).toBe(100);
    expect(res.offset).toBe(0);
  });

  it('recherche insensible aux majuscules et aux accents (« test » trouve « Test de Grossesse »)', async () => {
    const { db, calls } = fakeDb();
    await new ProductsService(db).getProductsByCorridor({ search: '  test ' } as any);
    for (const c of calls) {
      expect(c.sql).toContain('p.name COLLATE utf8mb4_general_ci LIKE ?');
    }
    expect(calls[0].params).toEqual(['publish', '%test%']);
  });
});
