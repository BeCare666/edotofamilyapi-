import { BadRequestException } from '@nestjs/common';
import {
  orderRelation,
  pickUpdatableFields,
  presentOrderForRelation,
  safeSortDirection,
} from './order-access';
import { MASKED_OTP } from '../common/sanitize';

const admin = { id: 1, permissions: ['super_admin'] };
const customer = { id: 10, permissions: ['customer'] };
const otherCustomer = { id: 11, permissions: ['customer'] };
const pickup = { id: 20, permissions: ['super_pickuppoint'] };
const otherPickup = { id: 21, permissions: ['super_pickuppoint'] };
const owner = { id: 30, permissions: ['store_owner'] };

const order = { id: 5, customer_id: 10, pickup_point_id: 20, otp_code: '123456' };

describe('orderRelation', () => {
  it('reconnaît chaque relation légitime', () => {
    expect(orderRelation(admin, order)).toBe('admin');
    expect(orderRelation(customer, order)).toBe('customer');
    expect(orderRelation(pickup, order)).toBe('pickup');
    expect(orderRelation(owner, order, [7], [7, 8])).toBe('shop');
  });

  it("refuse les utilisateurs sans lien avec la commande", () => {
    expect(orderRelation(otherCustomer, order)).toBeNull();
    expect(orderRelation(otherPickup, order)).toBeNull();
    expect(orderRelation(owner, order, [9], [7])).toBeNull();
    expect(orderRelation(null, order)).toBeNull();
  });

  it("n'accorde pas la relation pickup à un client dont l'id coïncide", () => {
    const c = { id: 20, permissions: ['customer'] };
    expect(orderRelation(c, { customer_id: 99, pickup_point_id: 20 })).toBeNull();
  });
});

describe('presentOrderForRelation', () => {
  it("laisse l'OTP en clair pour l'admin et le client", () => {
    expect(presentOrderForRelation(order, 'admin').otp_code).toBe('123456');
    expect(presentOrderForRelation(order, 'customer').otp_code).toBe('123456');
  });

  it("masque l'OTP pour le point de retrait et la boutique", () => {
    expect(presentOrderForRelation(order, 'pickup').otp_code).toBe(MASKED_OTP);
    expect(presentOrderForRelation(order, 'shop').otp_code).toBe(MASKED_OTP);
    expect(presentOrderForRelation({ ...order, otp_code: null }, 'pickup').otp_code).toBeNull();
  });
});

describe('pickUpdatableFields', () => {
  it('ne garde que les champs autorisés pour le client', () => {
    const out = pickUpdatableFields('customer', {
      pickup_point_id: '20',
      note: 'devant la pharmacie',
      order_status: 'order-completed',
      total: 1,
      'id = 1; DROP TABLE orders; --': 'x',
    });
    expect(out).toEqual({ pickup_point_id: 20, note: 'devant la pharmacie' });
  });

  it('ne donne rien au point de retrait', () => {
    expect(pickUpdatableFields('pickup', { order_status: 'order-completed' })).toEqual({});
    expect(pickUpdatableFields(null, { note: 'x' })).toEqual({});
  });

  it('valide les statuts contre les ENUM de la table', () => {
    expect(pickUpdatableFields('admin', { order_status: 'order-cancelled' })).toEqual({ order_status: 'order-cancelled' });
    expect(() => pickUpdatableFields('admin', { order_status: 'hacked' })).toThrow(BadRequestException);
    expect(() => pickUpdatableFields('admin', { payment_status: 'free' })).toThrow(BadRequestException);
    expect(() => pickUpdatableFields('customer', { pickup_point_id: 'abc' })).toThrow(BadRequestException);
  });
});

describe('safeSortDirection', () => {
  it("n'accepte que ASC/DESC", () => {
    expect(safeSortDirection('asc')).toBe('ASC');
    expect(safeSortDirection('DESC')).toBe('DESC');
    expect(safeSortDirection('DESC; DROP TABLE users')).toBe('DESC');
    expect(safeSortDirection(undefined)).toBe('DESC');
  });
});
