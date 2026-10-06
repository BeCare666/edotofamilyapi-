import { OrdersService } from './orders.service';
import { CampaignRequestsService } from '../campaigns/campaign-requests.service';
import { ORDER_WITHDRAWN_SQL, stageSql } from './order-stage';

type Handler = (sql: string, params: any[]) => any;
function fakeDb(handler: Handler) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    return [handler(sql, params) ?? [], []];
  });
  return { calls, db: { getPool: () => ({ query }), query } as any };
}
const admin = { id: 1, permissions: ['super_admin'] };
const customer = { id: 10, permissions: ['customer'] };
const orders = (h: Handler) => {
  const f = fakeDb(h);
  return { ...f, svc: new OrdersService({} as any, {} as any, {} as any, f.db) };
};

describe('Étapes admin : à traiter / traitées / retirées', () => {
  it('conditions SQL des 3 étapes ; valeur inconnue ignorée', () => {
    expect(stageSql('to_process', ORDER_WITHDRAWN_SQL)).toBe(`(processed_at IS NULL AND NOT ${ORDER_WITHDRAWN_SQL})`);
    expect(stageSql('processed', ORDER_WITHDRAWN_SQL)).toBe(`(processed_at IS NOT NULL AND NOT ${ORDER_WITHDRAWN_SQL})`);
    expect(stageSql('withdrawn', ORDER_WITHDRAWN_SQL)).toBe(ORDER_WITHDRAWN_SQL);
    expect(stageSql('1=1; DROP', ORDER_WITHDRAWN_SQL)).toBeNull();
    expect(ORDER_WITHDRAWN_SQL).toContain("order_status = 'order-completed'");
  });

  it('liste admin filtrée par étape ; un client ne peut pas filtrer par étape', async () => {
    const a = orders((sql) => (sql.includes('COUNT(*)') ? [{ total: 0 }] : []));
    await a.svc.getOrders({ stage: 'processed' } as any, admin);
    expect(a.calls.find((c) => c.sql.startsWith('SELECT * FROM orders'))!.sql).toContain('processed_at IS NOT NULL');
    const c = orders((sql) => (sql.includes('COUNT(*)') ? [{ total: 0 }] : []));
    await c.svc.getOrders({ stage: 'processed' } as any, customer);
    expect(c.calls.find((x) => x.sql.startsWith('SELECT * FROM orders'))!.sql).not.toContain('processed_at');
  });

  it('compteurs : les 3 étapes sur tout le périmètre, les autres filtres dans l’étape choisie', async () => {
    const { svc, calls } = orders((sql) => {
      if (sql.includes('AS to_process')) return [{ to_process: 4, processed: 2, withdrawn: 7 }];
      if (sql.includes('SUM(campaign_id IS NOT NULL)')) return [{ campaign: 0, shop: 6, total: 6 }];
      return [];
    });
    const f: any = await svc.getOrderFacets({ stage: 'to_process' }, admin);
    expect(f.stages).toEqual({ to_process: 4, processed: 2, withdrawn: 7 });
    // Compteurs d'étape : WHERE sans filtre d'étape ; autres compteurs : WHERE avec l'étape choisie
    expect(calls.find((c) => c.sql.includes('AS to_process'))!.sql.split('FROM orders WHERE')[1]).not.toContain('processed_at');
    expect(calls.find((c) => c.sql.includes('GROUP BY order_status'))!.sql.split('WHERE')[1]).toContain('processed_at IS NULL AND NOT');
  });
});

describe('Traiter une commande', () => {
  const row = (o: any) => (sql: string) => {
    if (sql.startsWith('SELECT id, order_status, payment_status, otp_used, processed_at FROM orders')) return [{ id: 5, order_status: 'order-processing', payment_status: 'payment-success', otp_used: 0, processed_at: null, ...o }];
    if (sql.startsWith('UPDATE orders')) return { affectedRows: 1 };
    if (sql.startsWith('SELECT id, processed_at, processed_by FROM orders')) return [{ id: 5, processed_at: '2026-10-06 10:00:00', processed_by: 1 }];
    return [];
  };

  it('commande payée : traitée (date + admin), conditions revérifiées dans la mise à jour', async () => {
    const { svc, calls } = orders(row({}));
    const res: any = await svc.setProcessed(5, true, 1);
    const u = calls.find((c) => c.sql.startsWith('UPDATE orders'))!;
    expect(u.sql).toContain('processed_at = NOW(), processed_by = ?');
    expect(u.sql).toContain("payment_status = 'payment-success'");
    expect(u.sql).toContain('processed_at IS NULL');
    expect(u.params).toEqual([1, 5]);
    expect(res).toMatchObject({ success: true, processed_by: 1 });
  });

  it('refus : non payée, déjà retirée, annulée, déjà traitée ; annulation impossible si pas traitée', async () => {
    await expect(orders(row({ payment_status: 'payment-pending' })).svc.setProcessed(5, true, 1)).rejects.toThrow('non payée');
    await expect(orders(row({ otp_used: 1 })).svc.setProcessed(5, true, 1)).rejects.toThrow('retirée');
    await expect(orders(row({ order_status: 'order-completed' })).svc.setProcessed(5, false, 1)).rejects.toThrow('retirée');
    await expect(orders(row({ order_status: 'order-cancelled' })).svc.setProcessed(5, true, 1)).rejects.toThrow('annulée');
    await expect(orders(row({ processed_at: '2026-10-06' })).svc.setProcessed(5, true, 1)).rejects.toThrow('Déjà traitée');
    await expect(orders(row({})).svc.setProcessed(5, false, 1)).rejects.toThrow("n'est pas traitée");
  });

  it('annuler le traitement d’une commande traitée non retirée', async () => {
    const { svc, calls } = orders(row({ processed_at: '2026-10-06' }));
    await svc.setProcessed(5, false, 1);
    expect(calls.find((c) => c.sql.startsWith('UPDATE orders'))!.sql).toContain('processed_at = NULL, processed_by = NULL');
  });

  it('modification concurrente (retrait entre-temps) : message clair', async () => {
    const { svc } = orders((sql) => (sql.startsWith('UPDATE') ? { affectedRows: 0 } : row({})(sql)));
    await expect(svc.setProcessed(5, true, 1)).rejects.toThrow('changé entre-temps');
  });
});

describe('Facture client', () => {
  it('facture générée au paiement : lien renvoyé ; absente : message clair', async () => {
    const ok = orders((sql) => (sql.includes('FROM invoices') ? [{ pdf_url: 'https://res.cloudinary.com/x/invoice_client_T1.pdf', created_at: '2026-10-01' }] : []));
    expect(await ok.svc.getClientInvoice(5)).toEqual({ url: 'https://res.cloudinary.com/x/invoice_client_T1.pdf', created_at: '2026-10-01' });
    expect(ok.calls[0].sql).toContain("type = 'client'");
    const none = orders(() => []);
    await expect(none.svc.getClientInvoice(5)).rejects.toThrow('Aucune facture');
  });
});

describe('Demandes de kit côté admin', () => {
  const svc = (h: Handler) => {
    const f = fakeDb(h);
    return { ...f, svc: new CampaignRequestsService(f.db) };
  };

  it('liste : campagne, étape, ville, point, recherche, période ; jamais le code de retrait', async () => {
    const { svc: s, calls } = svc((sql) => (sql.includes('COUNT(*)') ? [{ total: 1 }] : [{ id: 1, full_name: 'Awa', picked_up: 0, otp_used: 1 }]));
    const res: any = await s.list({ campaign_id: '4', stage: 'processed', city: 'Cotonou', pickup_center: '20', search: 'awa', date_from: '2026-10-01' });
    const q = calls[0];
    expect(q.sql).toContain('r.campaign_id = ?');
    expect(q.sql).toContain('r.processed_at IS NOT NULL');
    expect(q.sql).toContain('LOWER(r.city) = LOWER(?)');
    expect(q.sql).toContain('r.pickup_center = ?');
    expect(q.sql).not.toMatch(/otp_code/);
    expect(q.params.slice(0, 6)).toEqual([4, '%awa%', '%awa%', 'Cotonou', '20', '2026-09-30 23:00:00']);
    expect(res.data[0]).toMatchObject({ picked_up: false, otp_used: true });
  });

  it('traiter : refus si kit retiré ; sinon date + admin', async () => {
    const h = (o: any) => (sql: string) => {
      if (sql.startsWith('SELECT id, picked_up, order_status, processed_at')) return [{ id: 3, picked_up: 0, order_status: 'order-processing', processed_at: null, ...o }];
      if (sql.startsWith('UPDATE')) return { affectedRows: 1 };
      return [{ id: 3 }];
    };
    await expect(svc(h({ picked_up: 1 })).svc.setProcessed(3, true, 1)).rejects.toThrow('Kit déjà retiré');
    const ok = svc(h({}));
    await ok.svc.setProcessed(3, true, 1);
    expect(ok.calls.find((c) => c.sql.startsWith('UPDATE'))!.params).toEqual([1, 3]);
  });

  it('compteurs : étapes, campagnes, villes, points', async () => {
    const { svc: s } = svc((sql) => {
      if (sql.includes('AS to_process')) return [{ to_process: 3, processed: 1, withdrawn: 2, total: 6 }];
      if (sql.includes('FROM campaigns c')) return [{ id: 4, title: 'Zou', n: 6 }];
      if (sql.includes('GROUP BY r.city')) return [{ v: 'Cotonou', n: 5 }, { v: null, n: 1 }];
      if (sql.includes('GROUP BY r.pickup_center')) return [{ id: '20', name: 'Point A', n: 6 }];
      return [];
    });
    const f: any = await s.facets({ campaign_id: '4' });
    expect(f).toMatchObject({ total: 6, stages: { to_process: 3, processed: 1, withdrawn: 2 } });
    expect(f.cities).toEqual([{ value: 'Cotonou', label: 'Cotonou', count: 5 }, { value: 'none', label: 'Non renseignée', count: 1 }]);
    expect(f.pickup_points[0]).toEqual({ id: '20', name: 'Point A', count: 6 });
  });
});
