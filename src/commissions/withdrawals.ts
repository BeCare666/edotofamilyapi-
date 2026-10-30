import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';
import { DatabaseService } from '../database/database.services';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { ActivePickupGuard } from '../auth/active-pickup.guard';
import { Roles, SUPER_ADMIN, SUPER_PICKUPPOINT } from '../auth/roles.decorator';
import { SensitiveAction } from '../auth/step-up';
import { PAYOUT_METHODS, parsePayout, pointMoney, requestRow } from './payouts';

/**
 * Retraits des commissions (B7, 30/10/2026, migration 025).
 * - Le point de retrait demande un montant (au plus : reste à verser - demandes en attente), avec le moyen et le
 *   numéro ou compte où être payé ; il peut annuler tant que la demande est en attente.
 * - L'admin paie (le versement est noté dans pickup_payouts, avec la référence du paiement) ou refuse avec un motif.
 * Chaque écriture verrouille la ligne du point : deux demandes ou deux paiements simultanés ne dépassent jamais le reste.
 * Pas de frais, pas de paiement automatique : l'admin paie lui-même puis note la référence.
 */
const text = (v: any, max: number, label: string, required = false) => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (required && !s) throw new BadRequestException(`${label} obligatoire.`);
  if (s.length > max) throw new BadRequestException(`${label} : ${max} caractères au plus.`);
  return s || null;
};

export function parseWithdrawalRequest(body: any) {
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Montant invalide.');
  const method = String(body?.method ?? '');
  if (!PAYOUT_METHODS[method]) throw new BadRequestException('Moyen de paiement invalide.');
  return {
    amount: Math.round(amount),
    method,
    account: text(body?.account, 100, 'Numéro ou compte de paiement', method !== 'cash') ?? '',
    note: text(body?.note, 255, 'Note'),
  };
}

@StrictDto()
export class WithdrawalRequestDto {
  @IsOptional() @IsScalar() amount: number;
  @IsOptional() @IsScalar() method: string;
  @IsOptional() @IsScalar() account?: string;
  @IsOptional() @IsScalar() note?: string;
}

@StrictDto()
export class WithdrawalDecisionDto {
  @IsOptional() @IsScalar() reference?: string;
  @IsOptional() @IsScalar() paid_at?: string;
  @IsOptional() @IsScalar() admin_note?: string;
}

@Injectable()
export class WithdrawalsService {
  constructor(private readonly db: DatabaseService) {}

  private get pool(): any {
    return this.db.getPool();
  }

  /** Transaction avec la ligne du point verrouillée */
  private async locked<T>(pointId: number, work: (conn: any) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [found]: any = await conn.query(
        `SELECT id FROM users WHERE id = ? AND role = 'super_pickuppoint' AND pickup_approved = 1 FOR UPDATE`,
        [pointId],
      );
      if (!found?.length) throw new BadRequestException('Point de retrait inconnu.');
      const out = await work(conn);
      await conn.commit();
      return out;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  // ---------- Point de retrait ----------
  async request(pointId: number, body: any) {
    const r = parseWithdrawalRequest(body);
    await this.locked(pointId, async (conn) => {
      const m = await pointMoney(conn, pointId);
      if (r.amount > m.available) {
        throw new BadRequestException(`Le montant dépasse ce que vous pouvez retirer (${m.available.toLocaleString('fr-FR')} FCFA).`);
      }
      await conn.query(
        `INSERT INTO pickup_withdrawal_requests (pickup_point_id, amount, method, account, note, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', UTC_TIMESTAMP())`,
        [pointId, r.amount, r.method, r.account, r.note],
      );
    });
    return { success: true, message: 'Demande de retrait envoyée à l’équipe E.doto family.', ...(await pointMoney(this.pool, pointId)) };
  }

  async cancel(pointId: number, requestId: number) {
    const [res]: any = await this.pool.query(
      `UPDATE pickup_withdrawal_requests SET status = 'cancelled', decided_at = UTC_TIMESTAMP()
       WHERE id = ? AND pickup_point_id = ? AND status = 'pending'`,
      [requestId, pointId],
    );
    if (!res?.affectedRows) throw new BadRequestException('Cette demande ne peut plus être annulée.');
    return { success: true, message: 'Demande annulée.', ...(await pointMoney(this.pool, pointId)) };
  }

  // ---------- Admin ----------
  async list(query: any) {
    const status = ['pending', 'paid', 'rejected', 'cancelled'].includes(query?.status) ? query.status : null;
    const [rows]: any = await this.pool.query(
      `SELECT w.id, w.pickup_point_id, w.amount, w.method, w.account, w.note, w.status, w.admin_note, w.payout_id,
              DATE_FORMAT(w.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at, DATE_FORMAT(w.decided_at, '%Y-%m-%dT%H:%i:%sZ') AS decided_at,
              u.name AS point_name, u.pickup_address
       FROM pickup_withdrawal_requests w LEFT JOIN users u ON u.id = w.pickup_point_id
       ${status ? 'WHERE w.status = ?' : ''} ORDER BY (w.status = 'pending') DESC, w.id DESC LIMIT 200`,
      status ? [status] : [],
    );
    const [counts]: any = await this.pool.query(`SELECT status, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amount FROM pickup_withdrawal_requests GROUP BY status`);
    return {
      data: (rows || []).map((r: any) => ({
        ...requestRow(r),
        pickup_point: { id: Number(r.pickup_point_id), name: r.point_name ?? null, address: r.pickup_address ?? null },
        payout_id: r.payout_id === null ? null : Number(r.payout_id),
      })),
      counts: Object.fromEntries((counts || []).map((c: any) => [c.status, { n: Number(c.n), amount: Number(c.amount) }])),
    };
  }

  private async pendingRequest(id: number) {
    const [[w]]: any = await this.pool.query(`SELECT id, pickup_point_id, amount, method, status FROM pickup_withdrawal_requests WHERE id = ?`, [id]);
    if (!w) throw new NotFoundException('Demande introuvable.');
    if (w.status !== 'pending') throw new BadRequestException('Cette demande a déjà été traitée.');
    return w;
  }

  /** Payer : versement noté (pickup_payouts) et demande « payée », en une seule opération */
  async pay(id: number, body: any, adminId: number) {
    const w = await this.pendingRequest(id);
    const pointId = Number(w.pickup_point_id);
    const p = parsePayout({ pickup_point_id: pointId, amount: w.amount, method: w.method, reference: body?.reference, note: body?.admin_note, paid_at: body?.paid_at });
    await this.locked(pointId, async (conn) => {
      const [[again]]: any = await conn.query(`SELECT status FROM pickup_withdrawal_requests WHERE id = ? FOR UPDATE`, [id]);
      if (again?.status !== 'pending') throw new BadRequestException('Cette demande a déjà été traitée.');
      const m = await pointMoney(conn, pointId);
      if (p.amount > m.balance) {
        throw new BadRequestException(`Le montant dépasse le reste à verser (${m.balance.toLocaleString('fr-FR')} FCFA).`);
      }
      const [ins]: any = await conn.query(
        `INSERT INTO pickup_payouts (pickup_point_id, amount, method, reference, note, paid_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [pointId, p.amount, p.method, p.reference, p.note ?? `Demande de retrait n° ${id}`, p.paidAt, adminId || null],
      );
      await conn.query(
        `UPDATE pickup_withdrawal_requests SET status = 'paid', payout_id = ?, admin_note = ?, decided_by = ?, decided_at = UTC_TIMESTAMP() WHERE id = ?`,
        [ins.insertId, p.note, adminId || null, id],
      );
    });
    return { success: true, message: `Retrait de ${p.amount.toLocaleString('fr-FR')} FCFA payé et noté.` };
  }

  async reject(id: number, body: any, adminId: number) {
    const reason = text(body?.admin_note, 255, 'Motif du refus', true);
    await this.pendingRequest(id);
    const [res]: any = await this.pool.query(
      `UPDATE pickup_withdrawal_requests SET status = 'rejected', admin_note = ?, decided_by = ?, decided_at = UTC_TIMESTAMP()
       WHERE id = ? AND status = 'pending'`,
      [reason, adminId || null, id],
    );
    if (!res?.affectedRows) throw new BadRequestException('Cette demande a déjà été traitée.');
    return { success: true, message: 'Demande refusée.' };
  }
}

// Point de retrait : l'identifiant du point vient toujours du jeton
@UseGuards(JwtAuthGuard, RolesGuard, ActivePickupGuard)
@Roles(SUPER_PICKUPPOINT)
@Controller('pickup/withdrawals')
export class PickupWithdrawalsController {
  constructor(private readonly service: WithdrawalsService) {}

  @Post()
  request(@Req() req: any, @Body() body: WithdrawalRequestDto) {
    return this.service.request(Number(req.user.id), body);
  }

  @Post(':id/cancel')
  cancel(@Req() req: any, @Param('id') id: string) {
    return this.service.cancel(Number(req.user.id), Number(id));
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SUPER_ADMIN)
@Controller('admin/withdrawals')
export class AdminWithdrawalsController {
  constructor(private readonly service: WithdrawalsService) {}

  // ?status=pending|paid|rejected|cancelled
  @Get()
  list(@Query() query: any) {
    return this.service.list(query);
  }

  @SensitiveAction() // audit 3.1 : code redemandé si la double authentification est active
  @Post(':id/pay')
  pay(@Req() req: any, @Param('id') id: string, @Body() body: WithdrawalDecisionDto) {
    return this.service.pay(Number(id), body, Number(req.user?.id));
  }

  @Post(':id/reject')
  reject(@Req() req: any, @Param('id') id: string, @Body() body: WithdrawalDecisionDto) {
    return this.service.reject(Number(id), body, Number(req.user?.id));
  }
}
