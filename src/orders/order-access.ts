import { BadRequestException } from '@nestjs/common';
import { hasRole, STAFF, STORE_OWNER, SUPER_ADMIN, SUPER_PICKUPPOINT } from '../auth/roles.decorator';
import { maskOtp } from '../common/sanitize';

// Valeurs acceptées par les ENUM de la table orders (database/sql/orders.sql)
export const ORDER_STATUS_VALUES: string[] = [
  'order-pending',
  'order-processing',
  'order-completed',
  'order-cancelled',
  'order-refunded',
  'order-failed',
  'order-at-local-facility',
  'order-out-for-delivery',
];
export const PAYMENT_STATUS_VALUES: string[] = [
  'payment-pending',
  'payment-processing',
  'payment-success',
  'payment-failed',
  'payment-cash-on-delivery',
  'payment-cash',
  'payment-wallet',
  'payment-awaiting-for-approval',
];

export type OrderRelation = 'admin' | 'customer' | 'pickup' | 'shop' | null;

/**
 * Relation entre l'utilisateur et la commande.
 * `userShopIds` : boutiques gérées par l'utilisateur (store_owner / staff),
 * `orderShopIds` : boutiques des produits de la commande (order_children.shop_id).
 */
export function orderRelation(
  user: any,
  order: { customer_id?: number; pickup_point_id?: number },
  userShopIds: number[] = [],
  orderShopIds: number[] = [],
): OrderRelation {
  if (!user) return null;
  if (hasRole(user, SUPER_ADMIN)) return 'admin';
  const uid = Number(user.id);
  if (Number(order.customer_id) === uid) return 'customer';
  if (hasRole(user, SUPER_PICKUPPOINT) && Number(order.pickup_point_id) === uid) return 'pickup';
  if (hasRole(user, STORE_OWNER, STAFF) && orderShopIds.some((id) => userShopIds.includes(Number(id)))) {
    return 'shop';
  }
  return null;
}

// Seuls l'admin et le client propriétaire lisent l'OTP en clair.
export function presentOrderForRelation<T extends Record<string, any>>(order: T, relation: OrderRelation): T {
  if (relation === 'admin' || relation === 'customer') return order;
  return maskOtp(order);
}

/**
 * Champs modifiables via PUT /orders/:id selon la relation.
 * Tout autre champ est ignoré : les noms de colonnes ne viennent jamais directement du body.
 */
const UPDATABLE_FIELDS: Record<Exclude<OrderRelation, null>, string[]> = {
  admin: ['order_status', 'payment_status', 'pickup_point_id', 'note'],
  shop: ['order_status'],
  customer: ['pickup_point_id', 'note'],
  pickup: [],
};

export function pickUpdatableFields(relation: OrderRelation, body: Record<string, any>): Record<string, any> {
  if (!relation) return {};
  const allowed = UPDATABLE_FIELDS[relation];
  const out: Record<string, any> = {};
  for (const key of allowed) {
    if (body && body[key] !== undefined) out[key] = body[key];
  }
  if (out.order_status !== undefined && !ORDER_STATUS_VALUES.includes(out.order_status)) {
    throw new BadRequestException('order_status invalide.');
  }
  if (out.payment_status !== undefined && !PAYMENT_STATUS_VALUES.includes(out.payment_status)) {
    throw new BadRequestException('payment_status invalide.');
  }
  if (out.pickup_point_id !== undefined && out.pickup_point_id !== null) {
    const n = Number(out.pickup_point_id);
    if (!Number.isInteger(n) || n <= 0) throw new BadRequestException('pickup_point_id invalide.');
    out.pickup_point_id = n;
  }
  if (out.note !== undefined && out.note !== null && typeof out.note !== 'string') {
    throw new BadRequestException('note invalide.');
  }
  return out;
}

export function safeSortDirection(sortedBy: any): 'ASC' | 'DESC' {
  return String(sortedBy || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
}

// Passerelles qu'un client peut choisir lui-même. CASH et FULL_WALLET_PAYMENT passent la
// commande en « payée / terminée » sans vérification : réservés à l'admin.
export const CUSTOMER_PAYMENT_GATEWAYS = ['FEEXPAY', 'flutterwave'];
