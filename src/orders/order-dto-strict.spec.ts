import 'reflect-metadata';
import { BadRequestException, Logger } from '@nestjs/common';
import { StrictBodyPipe } from 'src/common/strict-body';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { OrderPaymentDto } from './dto/order-payment.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { CreateOrderStatusDto } from './dto/create-order-status.dto';

// Audit sécurité 2.3 (28/10/2026) : DTO des commandes (lot 2)
const body = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

describe('DTO des commandes (lot 2)', () => {
  const pipe = new StrictBodyPipe();
  let warn: jest.SpyInstance;
  beforeEach(() => (warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)));
  afterEach(() => warn.mockRestore());

  it('création : corps envoyé par le site gardé tel quel, sans journal (point de retrait)', async () => {
    const sent = {
      products: [{ product_id: 7, order_quantity: 2, unit_price: 1500, subtotal: 3000 }],
      total: 3000,
      payment_gateway: 'FEEXPAY',
      delivery: { type: 'PICKUP', pickup_point_id: 12 },
    };
    await expect(pipe.transform(JSON.parse(JSON.stringify(sent)), body(CreateOrderDto))).resolves.toEqual(sent);
    expect(warn).not.toHaveBeenCalled();
  });

  it('création : livraison à domicile gardée', async () => {
    const delivery = { type: 'CUSTOM', lat: 6.37, lng: 2.39, description: 'Portail bleu', phone: '+229 01 00 00 00' };
    const out: any = await pipe.transform({ products: [{ product_id: 1, order_quantity: 1 }], delivery: { ...delivery } }, body(CreateOrderDto));
    expect(out.delivery).toEqual(delivery);
  });

  it('création : champs non lus retirés et journalisés (carte, statut)', async () => {
    const out: any = await pipe.transform(
      { products: [{ product_id: 1, order_quantity: 1 }], card: { number: '4111' }, order_status: 'order-completed' },
      body(CreateOrderDto),
    );
    expect(out.card).toBeUndefined();
    expect(out.order_status).toBeUndefined();
    expect(String(warn.mock.calls[0][0])).toContain('card, order_status');
  });

  it('création : champ inconnu dans un produit ou dans le lieu retiré', async () => {
    const out: any = await pipe.transform(
      { products: [{ product_id: 1, order_quantity: 1, shop_id: 99 }], delivery: { type: 'PICKUP', pickup_point_id: 3, x: 1 } },
      body(CreateOrderDto),
    );
    expect(out.products[0]).toEqual({ product_id: 1, order_quantity: 1 });
    expect(out.delivery).toEqual({ type: 'PICKUP', pickup_point_id: 3 });
  });

  it('création : objet dans un champ simple ou produit non objet → 400', async () => {
    const bad = [
      { shop_id: { id: 1 } },
      { payment_gateway: ['CASH'] },
      { products: [{ product_id: { id: 1 }, order_quantity: 1 }] },
      { products: [5] },
      { products: 'x' },
      { delivery: { type: 'PICKUP', pickup_point_id: { a: 1 } } },
      { delivery: 'PICKUP' },
    ];
    for (const v of bad) {
      await expect(pipe.transform(v, body(CreateOrderDto))).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('mise à jour : champs du site (point, note) et de l\'admin (statut) gardés', async () => {
    await expect(pipe.transform({ pickup_point_id: 4, note: null }, body(UpdateOrderDto))).resolves.toEqual({ pickup_point_id: 4, note: null });
    await expect(pipe.transform({ order_status: 'order-processing' }, body(UpdateOrderDto))).resolves.toEqual({ order_status: 'order-processing' });
    await expect(pipe.transform({ payment_status: 'payment-success' }, body(UpdateOrderDto))).resolves.toEqual({ payment_status: 'payment-success' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('mise à jour : autres colonnes retirées, objet → 400', async () => {
    await expect(pipe.transform({ note: 'ok', total: 0, customer_id: 1 }, body(UpdateOrderDto))).resolves.toEqual({ note: 'ok' });
    await expect(pipe.transform({ pickup_point_id: { id: 1 } }, body(UpdateOrderDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('code de retrait, paiement, statut de commande', async () => {
    await expect(pipe.transform({ order_id: 5, otp_code: '123456' }, body(VerifyOtpDto))).resolves.toEqual({ order_id: 5, otp_code: '123456' });
    await expect(pipe.transform({ order_id: { id: 5 }, otp_code: '1' }, body(VerifyOtpDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ tracking_number: 'ORD-1' }, body(OrderPaymentDto))).resolves.toEqual({ tracking_number: 'ORD-1' });
    await expect(pipe.transform({ tracking_number: { a: 1 } }, body(OrderPaymentDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ name: 'A', description: 'B', id: 9 }, body(CreateOrderStatusDto))).resolves.toEqual({ name: 'A', description: 'B' });
  });
});
