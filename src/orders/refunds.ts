import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';
import { DatabaseService } from '../database/database.services';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, SUPER_ADMIN } from '../auth/roles.decorator';
import { SensitiveAction } from '../auth/step-up';
import { PAYOUT_METHODS } from '../commissions/payouts';

/**
 * Remboursement d'une commande (B7, 30/10/2026, migration 025), par le super admin uniquement.
 * Règles : commande payée, pas encore retirée, pas déjà remboursée ; montant au plus égal au total payé.
 * Effets, en une seule opération : ligne order_refunds (montant, moyen, référence, motif), commande et lignes
 * « remboursée », code de retrait annulé (il ne peut plus servir au point de retrait).
 * L'argent est rendu par l'admin lui-même (Mobile Money, virement, espèces) : rien d'automatique côté FeexPay.
 * Une commande déjà retirée n'est pas remboursable ici (la commission du point est déjà acquise).
 */
@StrictDto()
export class RefundDto {
  @IsOptional() @IsScalar() amount: number;
  @IsOptional() @IsScalar() method: string;
  @IsOptional() @IsScalar() reference?: string;
  @IsOptional() @IsScalar() reason: string;
  @IsOptional() @IsScalar() refunded_at?: string;
}

const text = (v: any, max: number) => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (s.length > max) throw new BadRequestException(`Texte trop long (${max} caractères au plus).`);
  return s || null;
};

export function parseRefund(body: any, today = new Date()) {
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Montant invalide.');
  const method = String(body?.method ?? '');
  if (!PAYOUT_METHODS[method]) throw new BadRequestException('Moyen de remboursement invalide.');
  const reason = text(body?.reason, 255);
  if (!reason) throw new BadRequestException('Motif du remboursement obligatoire.');
  let day = today.toISOString().slice(0, 10);
  if (body?.refunded_at) {
    const raw = String(body.refunded_at);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime())) throw new BadRequestException('Date invalide.');
    if (raw > day) throw new BadRequestException('La date du remboursement ne peut pas être dans le futur.');
    day = raw;
  }
  return { amount: Math.round(amount), method, reference: text(body?.reference, 100), reason, refundedAt: day };
}

const refundRow = (r: any) => ({
  id: Number(r.id),
  amount: Number(r.amount),
  method: r.method,
  method_label: PAYOUT_METHODS[r.method] ?? r.method,
  reference: r.reference ?? null,
  reason: r.reason,
  refunded_at: r.refunded_at,
});

@Injectable()
export class RefundsService {
  constructor(private readonly db: DatabaseService) {}

  async get(orderId: number) {
    const [[r]]: any = await this.db.getPool().query(
      `SELECT id, amount, method, reference, reason, DATE_FORMAT(refunded_at, '%Y-%m-%d') AS refunded_at FROM order_refunds WHERE order_id = ?`,
      [orderId],
    );
    return { refund: r ? refundRow(r) : null };
  }

  async refund(orderId: number, body: any, adminId: number) {
    const p = parseRefund(body);
    const conn = await this.db.getPool().getConnection();
    try {
      await conn.beginTransaction();
      const [[o]]: any = await conn.query(
        `SELECT id, tracking_number, total, paid_total, order_status, payment_status, otp_used FROM orders WHERE id = ? FOR UPDATE`,
        [orderId],
      );
      if (!o) throw new NotFoundException('Commande introuvable.');
      if (o.payment_status !== 'payment-success') throw new BadRequestException("Cette commande n'a pas été payée : rien à rembourser.");
      if (o.order_status === 'order-refunded') throw new BadRequestException('Cette commande est déjà remboursée.');
      if (Number(o.otp_used) === 1 || o.order_status === 'order-completed') {
        throw new BadRequestException('Commande déjà retirée : elle ne peut pas être remboursée ici.');
      }
      const paid = Number(o.paid_total ?? o.total) || Number(o.total) || 0;
      if (p.amount > paid) throw new BadRequestException(`Le montant dépasse le total payé (${paid.toLocaleString('fr-FR')} FCFA).`);
      await conn.query(
        `INSERT INTO order_refunds (order_id, amount, method, reference, reason, refunded_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [orderId, p.amount, p.method, p.reference, p.reason, p.refundedAt, adminId || null],
      );
      await conn.query(
        `UPDATE orders SET order_status = 'order-refunded', otp_code = NULL, otp_expires_at = NULL, updated_at = NOW() WHERE id = ?`,
        [orderId],
      );
      await conn.query(`UPDATE order_children SET order_status = 'order-refunded', updated_at = NOW() WHERE order_id = ?`, [orderId]);
      await conn.commit();
      return {
        success: true,
        message: `Commande ${o.tracking_number} remboursée (${p.amount.toLocaleString('fr-FR')} FCFA).`,
        ...(await this.get(orderId)),
      };
    } catch (e: any) {
      await conn.rollback();
      if (e?.code === 'ER_DUP_ENTRY') throw new BadRequestException('Cette commande est déjà remboursée.');
      throw e;
    } finally {
      conn.release();
    }
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SUPER_ADMIN)
@Controller('admin/orders')
export class RefundsController {
  constructor(private readonly service: RefundsService) {}

  @Get(':id/refund')
  get(@Param('id') id: string) {
    return this.service.get(Number(id));
  }

  @SensitiveAction() // audit 3.1 : code redemandé si la double authentification est active
  @Post(':id/refund')
  refund(@Req() req: any, @Param('id') id: string, @Body() body: RefundDto) {
    return this.service.refund(Number(id), body, Number(req.user?.id));
  }
}
