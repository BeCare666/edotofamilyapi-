import { BadRequestException, Controller, Get, Injectable, Module, Query, UseGuards } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.services';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, SUPER_ADMIN } from '../auth/roles.decorator';
import { PAYOUT_METHODS } from '../commissions/payouts';

/**
 * Transactions (B6, 30/10/2026) : journal de l'argent réel, en lecture seule, pour le super admin.
 * - payment : paiement reçu et vérifié (payment_intents, FeexPay) ;
 * - attempt : paiement arrivé mais pas abouti (pending_payments en cours ou en échec) : à vérifier ;
 * - payout  : versement à un point de retrait (pickup_payouts, B7, migration 024) ;
 * - refund  : remboursement d'une commande (order_refunds, B7, migration 025).
 * Remplace la page du modèle d'origine, qui relisait la liste des commandes (taxe, remise : inexistants ici).
 */
export type TxKind = 'payment' | 'attempt' | 'payout' | 'refund';
const KINDS: TxKind[] = ['payment', 'attempt', 'payout', 'refund'];

const PAYMENTS_SQL = `SELECT 'payment' AS kind, pi.id, pi.created_at AS at, pi.total_amount AS amount,
    CAST(pi.tracking_number AS CHAR) AS order_ref, CAST(pi.feexpay_reference AS CHAR) AS reference,
    CAST(o.customer_name AS CHAR) AS party, CAST(pi.status AS CHAR) AS status, CAST(pi.payment_gateway AS CHAR) AS method,
    CAST(NULL AS CHAR) AS detail
  FROM payment_intents pi LEFT JOIN orders o ON o.id = pi.order_id`;

const ATTEMPTS_SQL = `SELECT 'attempt' AS kind, pp.id, pp.created_at AS at, o.total AS amount,
    CAST(pp.tracking_number AS CHAR) AS order_ref, CAST(pp.transaction_id AS CHAR) AS reference,
    CAST(o.customer_name AS CHAR) AS party, CAST(pp.status AS CHAR) AS status, CAST('feexpay' AS CHAR) AS method,
    CAST(pp.error_message AS CHAR) AS detail
  FROM pending_payments pp LEFT JOIN orders o ON o.tracking_number = pp.tracking_number
  WHERE pp.status <> 'completed'`;

const PAYOUTS_SQL = `SELECT 'payout' AS kind, p.id, p.paid_at AS at, p.amount,
    CAST(NULL AS CHAR) AS order_ref, CAST(p.reference AS CHAR) AS reference,
    CAST(u.name AS CHAR) AS party, CAST('paid' AS CHAR) AS status, CAST(p.method AS CHAR) AS method,
    CAST(p.note AS CHAR) AS detail
  FROM pickup_payouts p LEFT JOIN users u ON u.id = p.pickup_point_id`;

const REFUNDS_SQL = `SELECT 'refund' AS kind, rf.id, rf.refunded_at AS at, rf.amount,
    CAST(o.tracking_number AS CHAR) AS order_ref, CAST(rf.reference AS CHAR) AS reference,
    CAST(o.customer_name AS CHAR) AS party, CAST('refunded' AS CHAR) AS status, CAST(rf.method AS CHAR) AS method,
    CAST(rf.reason AS CHAR) AS detail
  FROM order_refunds rf LEFT JOIN orders o ON o.id = rf.order_id`;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseTxQuery(q: any) {
  const kind = q?.kind && q.kind !== 'all' ? String(q.kind) : null;
  if (kind && !KINDS.includes(kind as TxKind)) throw new BadRequestException('Type de transaction invalide.');
  const from = q?.from ? String(q.from) : null;
  const to = q?.to ? String(q.to) : null;
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) throw new BadRequestException('Date invalide.');
  if (from && to && from > to) throw new BadRequestException('La date de début est après la date de fin.');
  const search = typeof q?.q === 'string' && q.q.trim() ? q.q.trim().slice(0, 100) : null;
  const page = Math.max(1, Math.floor(Number(q?.page) || 1));
  const limit = Math.min(100, Math.max(1, Math.floor(Number(q?.limit) || 20)));
  return { kind: kind as TxKind | null, from, to, search, page, limit };
}

/** Filtres communs (période, recherche) ; le type ne s'applique qu'à la liste, pas aux totaux */
export function txWhere(f: ReturnType<typeof parseTxQuery>) {
  const where: string[] = [];
  const params: any[] = [];
  if (f.from) { where.push('t.at >= ?'); params.push(`${f.from} 00:00:00`); }
  if (f.to) { where.push('t.at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(f.to); }
  if (f.search) {
    const like = `%${f.search}%`;
    where.push('(t.order_ref LIKE ? OR t.reference LIKE ? OR t.party LIKE ?)');
    params.push(like, like, like);
  }
  return { where, params };
}

const METHOD_LABELS: Record<string, string> = { ...PAYOUT_METHODS, feexpay: 'FeexPay' };

export const txRow = (r: any) => ({
  kind: r.kind as TxKind,
  id: Number(r.id),
  at: r.at,
  amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
  order_ref: r.order_ref ?? null,
  reference: r.reference ?? null,
  party: r.party ?? null,
  status: r.status,
  method: r.method,
  method_label: METHOD_LABELS[String(r.method)] ?? r.method,
  detail: r.detail ?? null,
});

@Injectable()
export class TransactionsService {
  constructor(private readonly db: DatabaseService) {}

  async list(query: any) {
    const f = parseTxQuery(query);
    // Tables récentes absentes (avant les migrations 024, 025) : journal sans elles
    let withPayouts = true;
    let withRefunds = true;
    for (;;) {
      try {
        return await this.run(f, withPayouts, withRefunds);
      } catch (err: any) {
        const msg = String(err?.message);
        if (withRefunds && /order_refunds/.test(msg)) withRefunds = false;
        else if (withPayouts && /pickup_payouts/.test(msg)) withPayouts = false;
        else throw err;
      }
    }
  }

  private async run(f: ReturnType<typeof parseTxQuery>, withPayouts: boolean, withRefunds = true) {
    const pool = this.db.getPool();
    const union = [PAYMENTS_SQL, ATTEMPTS_SQL, ...(withPayouts ? [PAYOUTS_SQL] : []), ...(withRefunds ? [REFUNDS_SQL] : [])].join('\nUNION ALL\n');
    const { where, params } = txWhere(f);
    const listWhere = f.kind ? [...where, 't.kind = ?'] : where;
    const listParams = f.kind ? [...params, f.kind] : params;
    const w = (parts: string[]) => (parts.length ? `WHERE ${parts.join(' AND ')}` : '');

    const [rows]: any = await pool.query(
      `SELECT t.* FROM (${union}) t ${w(listWhere)} ORDER BY t.at DESC, t.id DESC LIMIT ? OFFSET ?`,
      [...listParams, f.limit, (f.page - 1) * f.limit],
    );
    const [[count]]: any = await pool.query(`SELECT COUNT(*) AS total FROM (${union}) t ${w(listWhere)}`, listParams);
    const [sums]: any = await pool.query(
      `SELECT t.kind, COUNT(*) AS n, COALESCE(SUM(t.amount), 0) AS amount FROM (${union}) t ${w(where)} GROUP BY t.kind`,
      params,
    );
    const by = (k: TxKind) => (sums || []).find((s: any) => s.kind === k) || { n: 0, amount: 0 };
    const total = Number(count?.total) || 0;
    return {
      data: (rows || []).map(txRow),
      totals: {
        received: Number(by('payment').amount) || 0,
        received_count: Number(by('payment').n) || 0,
        paid_out: Number(by('payout').amount) || 0,
        paid_out_count: Number(by('payout').n) || 0,
        attempts_count: Number(by('attempt').n) || 0,
        refunded: Number(by('refund').amount) || 0,
        refunded_count: Number(by('refund').n) || 0,
      },
      payouts_available: withPayouts,
      page: f.page,
      limit: f.limit,
      total,
      last_page: Math.max(1, Math.ceil(total / f.limit)),
    };
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SUPER_ADMIN)
@Controller('admin/transactions')
export class TransactionsController {
  constructor(private readonly service: TransactionsService) {}

  // ?kind=payment|attempt|payout|all&from=AAAA-MM-JJ&to=AAAA-MM-JJ&q&page&limit
  @Get()
  list(@Query() query: any) {
    return this.service.list(query);
  }
}

@Module({
  imports: [DatabaseModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
})
export class TransactionsModule {}
