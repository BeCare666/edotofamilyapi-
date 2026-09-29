import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { bucketKey, parsePeriod, PeriodRange, utcToIso } from '../commissions/commission-rules';

// Dashboard du point de retrait connecté : uniquement ses commandes (payées) et ses kits.
// Jamais de code OTP renvoyé (seulement « code émis » / « code expiré »).
const UTC_FMT = '%Y-%m-%d %H:%i:%s';
const PRODUCTS_SQL = `(SELECT COALESCE(SUM(oc.subtotal), 0) FROM order_children oc WHERE oc.order_id = o.id)`;

type Status = 'pending' | 'withdrawn' | 'all';
const asStatus = (s: any): Status => (['pending', 'withdrawn', 'all'].includes(s) ? s : 'all');
const likeOrNull = (q: any) => (typeof q === 'string' && q.trim() ? `%${q.trim()}%` : null);

export interface Withdrawal {
  type: 'order' | 'kit';
  id: number;
  reference: string;
  customer: string | null;
  withdrawn_at: string;
  amount: number | null; // montant des produits (commandes) ; null pour un kit
  commission: number | null; // null : retrait antérieur à la mise en place des commissions
}

@Injectable()
export class PickupDashboardService {
  constructor(private readonly db: DatabaseService) { }

  private async withdrawals(pointId: number, range: PeriodRange, type: 'all' | 'order' | 'kit' = 'all', q?: string) {
    const pool = this.db.getPool();
    const like = likeOrNull(q);
    const tasks: Promise<any>[] = [];
    if (type !== 'kit') {
      tasks.push(pool.query(
        `SELECT o.id, o.tracking_number AS reference, u.name AS customer,
                DATE_FORMAT(o.delivered_at, '${UTC_FMT}') AS at, ${PRODUCTS_SQL} AS amount, o.commission_amount AS commission
         FROM orders o LEFT JOIN users u ON u.id = o.customer_id
         WHERE o.pickup_point_id = ? AND o.order_status = 'order-completed'
           AND o.delivered_at >= ? AND o.delivered_at < ?
           ${like ? 'AND (o.tracking_number LIKE ? OR u.name LIKE ?)' : ''}`,
        [pointId, range.startUtc, range.endUtc, ...(like ? [like, like] : [])],
      ).then(([rows]: any) => rows.map((r: any) => ({ ...r, type: 'order' }))));
    }
    if (type !== 'order') {
      tasks.push(pool.query(
        `SELECT r.id, c.title AS reference, r.full_name AS customer,
                DATE_FORMAT(r.picked_up_at, '${UTC_FMT}') AS at, NULL AS amount, r.commission_amount AS commission
         FROM campaign_registrations r JOIN campaigns c ON c.id = r.campaign_id
         WHERE r.pickup_center = ? AND r.picked_up = 1
           AND r.picked_up_at >= ? AND r.picked_up_at < ?
           ${like ? 'AND (c.title LIKE ? OR r.full_name LIKE ?)' : ''}`,
        [String(pointId), range.startUtc, range.endUtc, ...(like ? [like, like] : [])],
      ).then(([rows]: any) => rows.map((r: any) => ({ ...r, type: 'kit' }))));
    }
    const all = (await Promise.all(tasks)).flat();
    return all
      .map((r: any): Withdrawal & { at_utc: string } => ({
        type: r.type,
        id: Number(r.id),
        reference: r.reference,
        customer: r.customer ?? null,
        withdrawn_at: utcToIso(r.at),
        at_utc: r.at,
        amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
        commission: r.commission === null || r.commission === undefined ? null : Number(r.commission),
      }))
      .sort((a, b) => (a.at_utc < b.at_utc ? 1 : -1));
  }

  private async pendingCounts(pointId: number) {
    const pool = this.db.getPool();
    const [[[o]], [[k]]]: any = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS n FROM orders WHERE pickup_point_id = ? AND payment_status = 'payment-success'
           AND order_status NOT IN ('order-completed', 'order-cancelled', 'order-refunded', 'order-failed') AND is_archived = 0`,
        [pointId],
      ),
      pool.query(
        `SELECT COUNT(*) AS n FROM campaign_registrations WHERE pickup_center = ? AND picked_up = 0
           AND order_status NOT IN ('order-cancelled', 'order-refunded', 'order-failed')`,
        [String(pointId)],
      ),
    ]);
    return { orders: Number(o?.n) || 0, kits: Number(k?.n) || 0 };
  }

  async summary(pointId: number, periodRaw: any, dateRaw: any) {
    const range = parsePeriod(periodRaw, dateRaw);
    const [list, pending] = await Promise.all([this.withdrawals(pointId, range), this.pendingCounts(pointId)]);
    const series = range.buckets.map((b) => ({ ...b, orders: 0, kits: 0, commission: 0 }));
    const index = new Map(series.map((s, i) => [s.key, i]));
    for (const w of list) {
      const i = index.get(bucketKey(w.at_utc, range.period));
      if (i === undefined) continue;
      if (w.type === 'order') series[i].orders++;
      else series[i].kits++;
      series[i].commission += w.commission ?? 0;
    }
    const orders = list.filter((w) => w.type === 'order');
    const kits = list.filter((w) => w.type === 'kit');
    const sum = (a: Withdrawal[], f: (w: Withdrawal) => number | null) => a.reduce((s, w) => s + (f(w) ?? 0), 0);
    return {
      period: range.period,
      key: range.key,
      totals: {
        orders_withdrawn: orders.length,
        kits_withdrawn: kits.length,
        products_amount: sum(orders, (w) => w.amount),
        commission_orders: sum(orders, (w) => w.commission),
        commission_kits: sum(kits, (w) => w.commission),
        commission_total: sum(list, (w) => w.commission),
      },
      pending,
      series,
      latest: list.slice(0, 8).map(({ at_utc, ...w }) => w),
    };
  }

  async history(pointId: number, query: { period?: any; date?: any; type?: any; q?: any }) {
    const range = parsePeriod(query.period, query.date);
    const type = ['order', 'kit'].includes(query.type) ? query.type : 'all';
    const list = await this.withdrawals(pointId, range, type, query.q);
    return {
      period: range.period,
      key: range.key,
      totals: {
        count: list.length,
        products_amount: list.reduce((s, w) => s + (w.amount ?? 0), 0),
        commission: list.reduce((s, w) => s + (w.commission ?? 0), 0),
      },
      data: list.map(({ at_utc, ...w }) => w),
    };
  }

  async orders(pointId: number, query: { status?: any; q?: any; page?: any; limit?: any }) {
    const pool = this.db.getPool();
    const status = asStatus(query.status);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const like = likeOrNull(query.q);
    const where = [`o.pickup_point_id = ?`, `o.payment_status = 'payment-success'`, `o.is_archived = 0`];
    const params: any[] = [pointId];
    if (status === 'pending') where.push(`o.order_status NOT IN ('order-completed', 'order-cancelled', 'order-refunded', 'order-failed')`);
    if (status === 'withdrawn') where.push(`o.order_status = 'order-completed'`);
    if (like) {
      where.push(`(o.tracking_number LIKE ? OR u.name LIKE ?)`);
      params.push(like, like);
    }
    const from = `FROM orders o LEFT JOIN users u ON u.id = o.customer_id WHERE ${where.join(' AND ')}`;
    const [[rows], [countRows]]: any = await Promise.all([
      pool.query(
        `SELECT o.id, o.tracking_number, u.name AS customer_name, o.customer_contact, o.order_status,
                DATE_FORMAT(o.created_at, '${UTC_FMT}') AS created_at, DATE_FORMAT(o.delivered_at, '${UTC_FMT}') AS delivered_at,
                DATE_FORMAT(o.otp_expires_at, '${UTC_FMT}') AS otp_expires_at, (o.otp_code IS NOT NULL) AS has_otp,
                ${PRODUCTS_SQL} AS products_amount, o.commission_amount
         ${from}
         ORDER BY (o.order_status = 'order-completed') ASC, o.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit],
      ),
      pool.query(`SELECT COUNT(*) AS total ${from}`, params),
    ]);
    const total = Number(countRows[0]?.total) || 0;
    return {
      data: rows.map((r: any) => ({
        ...r,
        created_at: utcToIso(r.created_at),
        delivered_at: utcToIso(r.delivered_at),
        otp_expires_at: utcToIso(r.otp_expires_at),
        has_otp: !!Number(r.has_otp),
        withdrawn: r.order_status === 'order-completed',
        products_amount: Number(r.products_amount) || 0,
        commission_amount: r.commission_amount === null ? null : Number(r.commission_amount),
      })),
      total,
      page,
      last_page: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async kits(pointId: number, query: { status?: any; q?: any }) {
    const status = asStatus(query.status);
    const like = likeOrNull(query.q);
    const where = [`r.pickup_center = ?`];
    const params: any[] = [String(pointId)];
    if (status === 'pending') where.push(`r.picked_up = 0 AND r.order_status NOT IN ('order-cancelled', 'order-refunded', 'order-failed')`);
    if (status === 'withdrawn') where.push(`r.picked_up = 1`);
    if (like) {
      where.push(`(r.full_name LIKE ? OR c.title LIKE ?)`);
      params.push(like, like);
    }
    const [rows]: any = await this.db.getPool().query(
      `SELECT r.id, r.campaign_id, c.title AS campaign_title, r.full_name, r.city, r.order_status,
              DATE_FORMAT(r.created_at, '${UTC_FMT}') AS created_at, DATE_FORMAT(r.picked_up_at, '${UTC_FMT}') AS picked_up_at,
              DATE_FORMAT(r.otp_expires_at, '${UTC_FMT}') AS otp_expires_at, r.otp_used, r.picked_up, r.commission_amount
       FROM campaign_registrations r JOIN campaigns c ON c.id = r.campaign_id
       WHERE ${where.join(' AND ')}
       ORDER BY r.picked_up ASC, r.created_at DESC`,
      params,
    );
    return rows.map((r: any) => ({
      ...r,
      created_at: utcToIso(r.created_at),
      picked_up_at: utcToIso(r.picked_up_at),
      otp_expires_at: utcToIso(r.otp_expires_at),
      otp_used: Number(r.otp_used) === 1,
      picked_up: Number(r.picked_up) === 1,
      commission_amount: r.commission_amount === null ? null : Number(r.commission_amount),
    }));
  }

  // Cloche : retraits en attente (commandes payées non retirées + kits non retirés), les plus récents
  async notifications(pointId: number) {
    const [counts, orders, kits] = await Promise.all([
      this.pendingCounts(pointId),
      this.orders(pointId, { status: 'pending', limit: 10 }),
      this.kits(pointId, { status: 'pending' }),
    ]);
    const items = [
      ...orders.data.map((o: any) => ({ type: 'order', id: o.id, title: `Commande ${o.tracking_number}`, subtitle: o.customer_name, created_at: o.created_at, data: o })),
      ...kits.map((k: any) => ({ type: 'kit', id: k.id, title: `Kit — ${k.campaign_title}`, subtitle: k.full_name, created_at: k.created_at, data: k })),
    ]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 10);
    return { count: counts.orders + counts.kits, pending: counts, items };
  }
}
