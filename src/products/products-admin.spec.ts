import { BadRequestException } from '@nestjs/common';
import { ProductsService } from './products.service';

// Base simulée : enregistre chaque requête et répond selon le SQL
function fakeDb(responder: (sql: string, params: any[]) => any = () => []) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    return [responder(sql, params), []];
  });
  return { calls, db: { getPool: () => ({ query }), query } as any };
}

// Données envoyées par le formulaire admin à la mise à jour (forme réelle)
const formPayload = {
  language: 'fr',
  name: 'Tampons',
  slug: 'tampons',
  unit: '1',
  description: '<p>x</p>',
  status: 'publish',
  price: 5000,
  sale_price: 3000,
  quantity: 6000,
  sku: 'TAM',
  preview_url: 'edotofamily.com',
  video: null,
  gallery: [],
  image: { id: 3, url: 'https://x/y.jpg' },
  is_digital: true,
  type_id: 1,
  product_type: 'simple',
  categories: [{ categories_id: 3, sous_categories_id: [], sub_categories_id: [] }],
  tags: [1, 8],
  digital_file: {},
  variation_options: { upsert: [], delete: [] },
  in_flash_sale: undefined,
  min_price: null,
  max_price: null,
  countries_id: 19,
  is_origin: false,
  shop_id: 1,
};

describe('Admin — mise à jour produit', () => {
  const responder = (sql: string) => {
    if (sql.startsWith('SELECT id FROM products WHERE slug')) return [];
    if (sql.startsWith('SELECT id FROM sous_categories') || sql.startsWith('SELECT id FROM sub_categories')) return [];
    if (sql.startsWith('SELECT * FROM products WHERE id')) return [{ id: 30007, slug: 'tampons' }];
    return { affectedRows: 1 };
  };

  it("n'écrit que des colonnes réelles (variation_options ignoré → plus d'erreur 500)", async () => {
    const { db, calls } = fakeDb(responder);
    await new ProductsService(db).update(30007, { ...formPayload } as any);
    const upd = calls.find((c) => c.sql.startsWith('UPDATE products SET'))!;
    expect(upd).toBeDefined();
    expect(upd.sql).not.toContain('variation_options');
    expect(upd.sql).not.toContain('in_flash_sale');
    expect(upd.sql).not.toMatch(/\bcategories =|\btags =|\btype =/);
    expect(upd.sql).toContain('price = ?');
    expect(upd.params[upd.params.length - 1]).toBe(30007);
    // booléens en 0/1, objets en JSON
    const cols = upd.sql.replace('UPDATE products SET ', '').split(', ').map((x) => x.split(' = ')[0]);
    expect(upd.params[cols.indexOf('is_origin')]).toBe(0);
    expect(upd.params[cols.indexOf('image')]).toBe(JSON.stringify(formPayload.image));
  });

  it('réécrit les catégories et étiquettes dans les tables de liaison', async () => {
    const { db, calls } = fakeDb(responder);
    await new ProductsService(db).update(30007, { ...formPayload } as any);
    expect(calls.some((c) => c.sql === 'DELETE FROM product_categories WHERE product_id = ?')).toBe(true);
    const insCat = calls.find((c) => c.sql.startsWith('INSERT INTO product_categories'))!;
    expect(insCat.params).toEqual([30007, 3, null, null]);
    const insTag = calls.find((c) => c.sql.startsWith('INSERT INTO product_tags'))!;
    expect(insTag.params).toEqual([30007, 1, 30007, 8]);
  });

  it("une liste de catégories vide n'efface rien", async () => {
    const { db, calls } = fakeDb(responder);
    await new ProductsService(db).update(30007, { ...formPayload, categories: [] } as any);
    expect(calls.some((c) => c.sql.includes('product_categories'))).toBe(false);
  });

  it('prix promo vidé → NULL ; slug déjà pris → 400 en français', async () => {
    const { db, calls } = fakeDb(responder);
    await new ProductsService(db).update(30007, { sale_price: '' } as any);
    const upd = calls.find((c) => c.sql.startsWith('UPDATE products SET'))!;
    expect(upd.sql).toContain('sale_price = ?');
    expect(upd.params[0]).toBeNull();

    const taken = fakeDb((sql) => (sql.startsWith('SELECT id FROM products WHERE slug') ? [{ id: 2 }] : []));
    await expect(new ProductsService(taken.db).update(30007, { slug: 'revamil' } as any)).rejects.toThrow('Ce slug est déjà utilisé');
  });
});

describe('Admin — suppression produit', () => {
  it('refusée si le produit figure dans des commandes', async () => {
    const { db, calls } = fakeDb((sql) => (sql.includes('FROM order_children') ? [{ n: 3 }] : []));
    await expect(new ProductsService(db).remove(30007)).rejects.toBeInstanceOf(BadRequestException);
    expect(calls.some((c) => c.sql.startsWith('DELETE'))).toBe(false);
  });

  it('sinon supprime le produit et ses liaisons', async () => {
    const { db, calls } = fakeDb((sql) => (sql.includes('FROM order_children') ? [{ n: 0 }] : { affectedRows: 1 }));
    const res = await new ProductsService(db).remove(30003);
    expect(res.success).toBe(true);
    const deletes = calls.filter((c) => c.sql.startsWith('DELETE')).map((c) => c.sql);
    expect(deletes).toEqual([
      'DELETE FROM product_categories WHERE product_id = ?',
      'DELETE FROM product_tags WHERE product_id = ?',
      'DELETE FROM corridors_produits WHERE produit_id = ?',
      'DELETE FROM products WHERE id = ?',
    ]);
  });
});

describe('Admin — liste et filtres produits', () => {
  it('filtres réels : catégorie, étiquette, stock, promo, prix, origine, statuts multiples', async () => {
    const { db, calls } = fakeDb((sql) => (sql.includes('COUNT(*)') ? [{ total: 0 }] : []));
    await new ProductsService(db).getProducts({
      categories: '3', tag: '8', stock: 'low', on_sale: 'true', min_price: '100', max_price: '5000',
      is_origin: 'true', status: 'publish,draft', name: 'tam', page: '2', limit: '10', orderBy: 'quantity', sortedBy: 'asc',
    } as any);
    const data = calls.find((c) => c.sql.includes('LIMIT ? OFFSET ?'))!;
    expect(data.sql).toContain('FROM product_categories WHERE categories_id = ?');
    expect(data.sql).toContain('FROM product_tags WHERE tag_id = ?');
    expect(data.sql).toContain('p.quantity BETWEEN 1 AND 9');
    expect(data.sql).toContain('p.sale_price < p.price');
    expect(data.sql).toContain('p.is_origin = 1');
    expect(data.sql).toContain('p.status IN (?, ?)');
    expect(data.sql).toContain('ORDER BY p.quantity ASC');
    expect(data.params.slice(-2)).toEqual([10, 10]);
  });

  it('tri inconnu → date de création ; catégorie non numérique ignorée', async () => {
    const { db, calls } = fakeDb((sql) => (sql.includes('COUNT(*)') ? [{ total: 0 }] : []));
    await new ProductsService(db).getProducts({ orderBy: 'p.id; DROP', categories: 'intimite' } as any);
    const data = calls.find((c) => c.sql.includes('LIMIT ? OFFSET ?'))!;
    expect(data.sql).toContain('ORDER BY p.created_at DESC');
    expect(data.sql).not.toContain('product_categories');
  });
});
