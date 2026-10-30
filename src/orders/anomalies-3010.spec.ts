jest.mock('../auth/mailer', () => ({ sendVerificationEmail: jest.fn().mockResolvedValue(undefined) }));

import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PaymentIntentService } from '../payment-intent/payment-intent.service';

// Anomalies relevées le 29/10/2026, corrigées le 30/10/2026
describe('POST /order-status : colonnes réelles de order_status', () => {
  const make = (taken = false) => {
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT id FROM order_status WHERE slug')) return [taken ? [{ id: 9 }] : [], []];
      if (sql.includes('MAX(serial)')) return [[{ serial: 7 }], []];
      if (sql.startsWith('SELECT * FROM order_status')) return [[{ id: 12, name: 'Prête à retirer' }], []];
      return [{ insertId: 12 }, []];
    });
    return { service: new OrdersService({} as any, { getPool: () => ({ query }) } as any), query };
  };

  it('nom, slug sans accent, rang suivant, langue et couleur par défaut ; jamais de colonne description', async () => {
    const { service, query } = make();
    const res = await service.createOrderStatus({ name: '  Prête à retirer ', description: 'ignorée' });
    expect(res).toEqual({ id: 12, name: 'Prête à retirer' });
    const insert = query.mock.calls.find(([sql]) => String(sql).startsWith('INSERT INTO order_status')) as any;
    expect(insert[0]).toContain('(name, slug, serial, language, color, translated_languages, created_at, updated_at)');
    expect(insert[0]).not.toContain('description');
    expect(insert[1]).toEqual(['Prête à retirer', 'prete-a-retirer', 8, 'fr', '#000000', '["fr"]']);
  });

  it('nom vide ou déjà pris : refusé, rien n’est écrit', async () => {
    await expect(make().service.createOrderStatus({ name: '  ' })).rejects.toBeInstanceOf(BadRequestException);
    const { service, query } = make(true);
    await expect(service.createOrderStatus({ name: 'Prête à retirer' })).rejects.toBeInstanceOf(BadRequestException);
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT'))).toBe(false);
  });
});

describe('Factures de boutique : identifiant de la boutique lu', () => {
  it('nom du fichier et ligne invoices avec shop_id (avant : invoice_shop_undefined, shop_id vide)', async () => {
    const conn: any = {
      query: jest.fn(async (sql: string) => {
        if (sql.startsWith('SELECT * FROM orders')) return [[{ id: 5, tracking_number: 'TRK5', customer_id: 2 }]];
        if (sql.startsWith('SELECT * FROM users')) return [[{ id: 2 }]];
        if (sql.includes('FROM order_children co')) {
          expect(sql).toContain('co.shop_id');
          return [[{ child_order_id: 1, shop_id: 3, shop_name: 'Boutique' }]];
        }
        return [{ insertId: 1 }];
      }),
    };
    const svc: any = new PaymentIntentService({ getPool: () => ({}) } as any);
    svc.buildInvoicePdfBuffer = jest.fn(async () => Buffer.from(''));
    svc.uploadPdfToCloudinary = jest.fn(async (_b: Buffer, id: string) => `https://cdn/${id}`);
    await svc.generateInvoices(5, conn);
    expect(svc.uploadPdfToCloudinary).toHaveBeenCalledWith(expect.anything(), 'invoice_shop_3_TRK5');
    const shopInsert = conn.query.mock.calls.find(([sql]: any) => String(sql).includes("'shop', 'generated'"));
    expect(shopInsert[1]).toEqual([5, 3, 'https://cdn/invoice_shop_3_TRK5']);
  });
});
