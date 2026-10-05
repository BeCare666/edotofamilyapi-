import { AdminNotificationsService } from './admin-notifications.service';

function fakeDb(handler: (sql: string) => any[]) {
  const calls: string[] = [];
  const query = jest.fn(async (sql: string) => {
    calls.push(sql);
    return [handler(sql), []];
  });
  return { calls, db: { getPool: () => ({ query }) } as any };
}

describe('Notifications admin (données réelles)', () => {
  it('construit chaque notification depuis sa table, triée de la plus récente à la plus ancienne', async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes('INTERVAL 14 DAY') && sql.includes('FROM orders')) return [{ id: 1, tracking_number: 'ORD-1', total: 3000, payment_status: 'payment-pending', customer_name: 'Awa', created_at: '2026-10-04T10:00:00Z' }];
      if (sql.includes("payment_status = 'payment-success'") && sql.includes('NOT IN')) return [{ id: 2, tracking_number: 'ORD-2', total: 500, delivery_type: 'PICKUP', updated_at: '2026-10-03T10:00:00Z' }];
      if (sql.includes('FROM custom_deliveries')) return [];
      if (sql.includes('pickup_approved = 0')) return [{ id: 9, name: 'Point A', created_at: '2026-10-02T10:00:00Z', updated_at: null }];
      if (sql.includes('FROM sponsor_export_requests')) return [];
      if (sql.includes('FROM products')) return [{ id: 7, name: 'Tampons', quantity: 0, updated_at: '2026-10-01T10:00:00Z' }];
      return [];
    });
    const { items } = await new AdminNotificationsService(db).list();
    expect(items.map((i) => i.key)).toEqual(['order-1', 'paid-2', 'pickup-9', 'stock-7-0']);
    expect(items[0]).toEqual(expect.objectContaining({ title: 'Nouvelle commande ORD-1', href: '/orders/1', action: false }));
    // fr-FR sépare les milliers par une espace insécable fine
    expect(items[0].body).toMatch(/^3\s000 FCFA/u);
    expect(items[1].action).toBe(true);
    expect(items[3].title).toBe('Produit en rupture de stock');
  });

  it("n'expose jamais de code de retrait ni de contact", async () => {
    const { db, calls } = fakeDb(() => []);
    await new AdminNotificationsService(db).list();
    for (const sql of calls) {
      expect(sql).not.toContain('otp_code');
      expect(sql).not.toContain('customer_contact');
      expect(sql).not.toContain('password');
    }
  });
});
