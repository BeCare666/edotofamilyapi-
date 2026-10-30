import { BadRequestException } from '@nestjs/common';
import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Versements aux points de retrait (B7, 30/10/2026, migration 024).
// Gagné = commissions figées des commandes retirées et des kits remis (mêmes règles que l'écran des commissions) ;
// versé = paiements notés par l'admin ; reste à verser = gagné - versé. Un versement ne dépasse jamais le reste.
export const PAYOUT_METHODS: Record<string, string> = {
  mobile_money: 'Mobile Money',
  cash: 'Espèces',
  bank: 'Virement bancaire',
};

export const EARNED_ORDERS_SQL = `(SELECT COALESCE(SUM(o.commission_amount), 0) FROM orders o
  WHERE o.pickup_point_id = u.id AND o.order_status = 'order-completed')`;
export const EARNED_KITS_SQL = `(SELECT COALESCE(SUM(r.commission_amount), 0) FROM campaign_registrations r
  WHERE r.pickup_center = CAST(u.id AS CHAR) AND r.picked_up = 1)`;
export const PAID_SQL = `(SELECT COALESCE(SUM(p.amount), 0) FROM pickup_payouts p WHERE p.pickup_point_id = u.id)`;

@StrictDto()
export class CreatePayoutDto {
  @IsOptional() @IsScalar() pickup_point_id: number;
  @IsOptional() @IsScalar() amount: number;
  @IsOptional() @IsScalar() method: string;
  @IsOptional() @IsScalar() reference?: string;
  @IsOptional() @IsScalar() note?: string;
  @IsOptional() @IsScalar() paid_at?: string;
}

const text = (v: any, max: number) => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (s.length > max) throw new BadRequestException(`Texte trop long (${max} caractères au plus).`);
  return s || null;
};

export function parsePayout(body: any, today = new Date()) {
  const pointId = Number(body?.pickup_point_id);
  if (!Number.isInteger(pointId) || pointId <= 0) throw new BadRequestException('Point de retrait invalide.');
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Montant invalide.');
  const method = String(body?.method ?? '');
  if (!PAYOUT_METHODS[method]) throw new BadRequestException('Moyen de paiement invalide.');
  let paidAt = today.toISOString().slice(0, 10);
  if (body?.paid_at !== undefined && body?.paid_at !== null && body?.paid_at !== '') {
    const raw = String(body.paid_at);
    const d = new Date(`${raw}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(d.getTime())) throw new BadRequestException('Date invalide.');
    if (raw > paidAt) throw new BadRequestException('La date du versement ne peut pas être dans le futur.');
    paidAt = raw;
  }
  return {
    pointId,
    amount: Math.round(amount),
    method,
    reference: text(body?.reference, 100),
    note: text(body?.note, 255),
    paidAt,
  };
}

export const money = (earnedOrders: any, earnedKits: any, paid: any) => {
  const earned = (Number(earnedOrders) || 0) + (Number(earnedKits) || 0);
  const p = Number(paid) || 0;
  return { earned, paid: p, balance: Math.max(0, earned - p) };
};

export const payoutRow = (r: any) => ({
  id: Number(r.id),
  amount: Number(r.amount),
  method: r.method,
  method_label: PAYOUT_METHODS[r.method] ?? r.method,
  reference: r.reference ?? null,
  note: r.note ?? null,
  paid_at: r.paid_at,
});

/** Gagné, versé, reste à verser et versements d'un point ; avant la migration 024, versé = 0 et liste vide */
export async function pointMoney(pool: any, pointId: number) {
  const [[e]]: any = await pool.query(
    `SELECT ${EARNED_ORDERS_SQL} AS earned_orders, ${EARNED_KITS_SQL} AS earned_kits FROM users u WHERE u.id = ?`,
    [pointId],
  );
  let paid = 0;
  let payouts: any[] = [];
  try {
    const [rows]: any = await pool.query(
      `SELECT id, amount, method, reference, note, DATE_FORMAT(paid_at, '%Y-%m-%d') AS paid_at
       FROM pickup_payouts WHERE pickup_point_id = ? ORDER BY paid_at DESC, id DESC`,
      [pointId],
    );
    payouts = (rows || []).map(payoutRow);
    paid = payouts.reduce((s, p) => s + p.amount, 0);
  } catch (err: any) {
    if (!/pickup_payouts/.test(String(err?.message))) throw err;
  }
  // Demandes de retrait (migration 025) : le montant en attente n'est plus disponible pour une nouvelle demande
  let requests: any[] = [];
  try {
    const [rows]: any = await pool.query(
      `SELECT id, amount, method, account, note, status, admin_note,
              DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at, DATE_FORMAT(decided_at, '%Y-%m-%dT%H:%i:%sZ') AS decided_at
       FROM pickup_withdrawal_requests WHERE pickup_point_id = ? ORDER BY id DESC LIMIT 50`,
      [pointId],
    );
    requests = (rows || []).map(requestRow);
  } catch (err: any) {
    if (!/pickup_withdrawal_requests/.test(String(err?.message))) throw err;
  }
  const m = money(e?.earned_orders, e?.earned_kits, paid);
  const pending = requests.filter((r) => r.status === 'pending').reduce((s, r) => s + r.amount, 0);
  return { ...m, pending, available: Math.max(0, m.balance - pending), payouts, requests };
}

export const REQUEST_STATUS_LABELS: Record<string, string> = {
  pending: 'En attente',
  paid: 'Payée',
  rejected: 'Refusée',
  cancelled: 'Annulée',
};

export const requestRow = (r: any) => ({
  id: Number(r.id),
  amount: Number(r.amount),
  method: r.method,
  method_label: PAYOUT_METHODS[r.method] ?? r.method,
  account: r.account ?? null,
  note: r.note ?? null,
  status: r.status,
  status_label: REQUEST_STATUS_LABELS[r.status] ?? r.status,
  admin_note: r.admin_note ?? null,
  created_at: r.created_at ?? null,
  decided_at: r.decided_at ?? null,
});
