import { BadRequestException } from '@nestjs/common';
import { TransactionsService, parseTxQuery, txWhere } from './transactions';

// Transactions (B6, 30/10/2026) : journal de l'argent réel, lecture seule
function fakeDb(handler: (sql: string, params: any[]) => any) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    return [handler(sql, params) ?? [], []];
  });
  return { calls, db: { getPool: () => ({ query }) } as any };
}

describe('Transactions : filtres', () => {
  it('valeurs par défaut, page et taille bornées', () => {
    expect(parseTxQuery({})).toEqual({ kind: null, from: null, to: null, search: null, page: 1, limit: 20 });
    expect(parseTxQuery({ kind: 'all', page: '-3', limit: '500' })).toMatchObject({ kind: null, page: 1, limit: 100 });
    expect(parseTxQuery({ kind: 'payout', q: '  MM-42 ' })).toMatchObject({ kind: 'payout', search: 'MM-42' });
  });

  it('type, dates mal écrites ou inversées : refusés', () => {
    expect(() => parseTxQuery({ kind: 'gift' })).toThrow(BadRequestException);
    expect(parseTxQuery({ kind: 'refund' }).kind).toBe('refund');
    expect(() => parseTxQuery({ from: '30/10/2026' })).toThrow(BadRequestException);
    expect(() => parseTxQuery({ from: '2026-10-30', to: '2026-10-01' })).toThrow(BadRequestException);
  });

  it('période incluse jusqu’à la fin du dernier jour, recherche sur commande, référence et nom', () => {
    const { where, params } = txWhere(parseTxQuery({ from: '2026-10-01', to: '2026-10-30', q: 'Awa' }));
    expect(where).toEqual(['t.at >= ?', 't.at < DATE_ADD(?, INTERVAL 1 DAY)', '(t.order_ref LIKE ? OR t.reference LIKE ? OR t.party LIKE ?)']);
    expect(params).toEqual(['2026-10-01 00:00:00', '2026-10-30', '%Awa%', '%Awa%', '%Awa%']);
  });
});

describe('Transactions : journal', () => {
  const rows = [
    { kind: 'payment', id: 4, at: '2026-10-29', amount: '1500.00', order_ref: 'TRK1', reference: 'FX9', party: 'Awa', status: 'payment-success', method: 'feexpay', detail: null },
    { kind: 'payout', id: 1, at: '2026-10-28', amount: '400.00', order_ref: null, reference: 'MM-42', party: 'Point A', status: 'paid', method: 'mobile_money', detail: null },
  ];
  const handler = (sql: string) => {
    if (sql.includes('GROUP BY t.kind')) return [{ kind: 'payment', n: 1, amount: '1500' }, { kind: 'payout', n: 1, amount: '400' }, { kind: 'attempt', n: 2, amount: '0' }];
    if (sql.includes('COUNT(*) AS total')) return [{ total: 2 }];
    return rows;
  };

  it('paiements, paiements non aboutis et versements réunis, totaux entrées et sorties', async () => {
    const { db, calls } = fakeDb(handler);
    const res = await new TransactionsService(db).list({});
    expect(res.data[0]).toMatchObject({ kind: 'payment', amount: 1500, method_label: 'FeexPay' });
    expect(res.data[1]).toMatchObject({ kind: 'payout', amount: 400, method_label: 'Mobile Money' });
    expect(res.totals).toEqual({ received: 1500, received_count: 1, paid_out: 400, paid_out_count: 1, attempts_count: 2, refunded: 0, refunded_count: 0 });
    const list = calls[0].sql;
    expect(list).toContain('FROM payment_intents');
    expect(list).toContain("WHERE pp.status <> 'completed'");
    expect(list).toContain('FROM pickup_payouts');
    expect(calls[0].params.slice(-2)).toEqual([20, 0]);
  });

  it('le type filtre la liste, pas les totaux', async () => {
    const { db, calls } = fakeDb(handler);
    await new TransactionsService(db).list({ kind: 'payout', page: 2 });
    expect(calls[0].sql).toContain('t.kind = ?');
    expect(calls[0].params).toEqual(['payout', 20, 20]);
    expect(calls[2].sql).not.toContain('t.kind = ?');
  });

  it('avant la migration 024 : journal sans les versements', async () => {
    const { db, calls } = fakeDb((sql) => {
      if (sql.includes('FROM pickup_payouts')) throw new Error("Table 'pickup_payouts' doesn't exist");
      return handler(sql);
    });
    const res = await new TransactionsService(db).list({});
    expect(res.payouts_available).toBe(false);
    expect(calls[calls.length - 1].sql).not.toContain('pickup_payouts');
  });
});
