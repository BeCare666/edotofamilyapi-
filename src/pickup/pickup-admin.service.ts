import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { sendVerificationEmail } from '../auth/mailer';
import { sendVerificationLink } from '../auth/auth.service';
import { buildPickupApprovedEmail, PICKUP_APPROVED_SUBJECT } from '../auth/verification-emails';

export type PickupPointStatus = 'pending' | 'active' | 'blocked';

// en attente : inscription non validée ; bloqué : validé puis désactivé (users.is_active = 0)
export function pickupPointStatus(row: { pickup_approved: any; is_active: any }): PickupPointStatus {
  if (Number(row.pickup_approved) === 0) return 'pending';
  return Number(row.is_active) === 0 ? 'blocked' : 'active';
}

const STATUS_FILTERS: Record<string, string> = {
  pending: 'AND pickup_approved = 0',
  active: 'AND pickup_approved = 1 AND is_active = 1',
  blocked: 'AND pickup_approved = 1 AND is_active = 0',
};

@Injectable()
export class PickupAdminService {
  constructor(private readonly db: DatabaseService) { }

  async list({ status, page = 1, limit = 20, search, verified, located, sort }: { status?: string; page?: any; limit?: any; search?: string; verified?: string; located?: string; sort?: string }) {
    const pool = this.db.getPool();
    const pageNumber = Math.max(1, Number(page) || 1);
    const limitNumber = Math.min(100, Math.max(1, Number(limit) || 20));
    // Filtres réels : statut, recherche (nom, e-mail, adresse), e-mail confirmé, position GPS
    let filter = STATUS_FILTERS[status as string] ?? '';
    const params: any[] = [];
    if (search && String(search).trim()) {
      const term = `%${String(search).trim()}%`;
      filter += ' AND (name COLLATE utf8mb4_general_ci LIKE ? OR email COLLATE utf8mb4_general_ci LIKE ? OR pickup_address COLLATE utf8mb4_general_ci LIKE ?)';
      params.push(term, term, term);
    }
    if (verified === '1') filter += ' AND is_verified = 1';
    if (verified === '0') filter += ' AND (is_verified = 0 OR is_verified IS NULL)';
    if (located === '1') filter += ' AND pickup_lat IS NOT NULL AND pickup_lng IS NOT NULL';
    if (located === '0') filter += ' AND (pickup_lat IS NULL OR pickup_lng IS NULL)';
    const SORTS: Record<string, string> = {
      default: 'pickup_approved ASC, created_at DESC',
      recent: 'created_at DESC',
      oldest: 'created_at ASC',
      name: 'name ASC',
      orders: 'orders_count DESC',
    };
    const orderSql = SORTS[String(sort)] ?? SORTS.default;

    const [rows]: any = await pool.query(
      `SELECT id, name, email, pickup_address, pickup_lat, pickup_lng,
              is_verified, is_active, pickup_approved, created_at,
              (SELECT COUNT(*) FROM orders o WHERE o.pickup_point_id = users.id AND o.is_archived = 0) AS orders_count
       FROM users
       WHERE role = 'super_pickuppoint' ${filter}
       ORDER BY ${orderSql}, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNumber, (pageNumber - 1) * limitNumber],
    );
    const [countRows]: any = await pool.query(
      `SELECT COUNT(*) AS total FROM users WHERE role = 'super_pickuppoint' ${filter}`,
      params,
    );
    const total = Number(countRows[0]?.total ?? 0);

    return {
      data: rows.map((r) => ({ ...r, orders_count: Number(r.orders_count ?? 0), status: pickupPointStatus(r) })),
      total,
      current_page: pageNumber,
      per_page: limitNumber,
      last_page: Math.max(1, Math.ceil(total / limitNumber)),
    };
  }

  // Compteurs réels des filtres de la liste
  async facets() {
    const [rows]: any = await this.db.getPool().query(
      `SELECT COUNT(*) AS total,
              SUM(pickup_approved = 0) AS pending,
              SUM(pickup_approved = 1 AND is_active = 1) AS active,
              SUM(pickup_approved = 1 AND is_active = 0) AS blocked,
              SUM(is_verified = 1) AS verified,
              SUM(pickup_lat IS NOT NULL AND pickup_lng IS NOT NULL) AS located
       FROM users WHERE role = 'super_pickuppoint'`,
    );
    const r = rows[0] ?? {};
    const n = (v: any) => Number(v ?? 0);
    return {
      total: n(r.total),
      status: { pending: n(r.pending), active: n(r.active), blocked: n(r.blocked) },
      verified: { yes: n(r.verified), no: n(r.total) - n(r.verified) },
      located: { yes: n(r.located), no: n(r.total) - n(r.located) },
    };
  }

  async approve(id: number) {
    const pool = this.db.getPool();
    const [rows]: any = await pool.query(
      `SELECT id, name, email, is_verified, pickup_approved FROM users WHERE id = ? AND role = 'super_pickuppoint' LIMIT 1`,
      [id],
    );
    const point = rows[0];
    if (!point) throw new NotFoundException('Point de retrait introuvable.');
    if (Number(point.pickup_approved) === 1) {
      throw new BadRequestException('Ce point de retrait est déjà validé.');
    }
    // Parcours demandé : inscription → confirmation de l'e-mail → validation admin
    if (!Number(point.is_verified)) {
      throw new BadRequestException("L'adresse e-mail de ce point de retrait n'a pas encore été confirmée.");
    }

    const [result]: any = await pool.query(
      `UPDATE users SET pickup_approved = 1, updated_at = NOW() WHERE id = ? AND pickup_approved = 0`,
      [id],
    );
    if (!result?.affectedRows) {
      throw new BadRequestException('Ce point de retrait est déjà validé.');
    }
    // Prévenir le point de retrait. Un échec d'envoi n'annule pas la validation.
    try {
      await sendVerificationEmail({
        email: point.email,
        subject: PICKUP_APPROVED_SUBJECT,
        message: buildPickupApprovedEmail(point.name, `${process.env.FRONTEND_CALLBACK_URL}/login`),
      });
    } catch (error) {
      console.error("Erreur e-mail de validation point de retrait :", error);
      return {
        success: true,
        email_sent: false,
        message: "Point de retrait validé, mais l'e-mail de notification n'a pas pu être envoyé.",
      };
    }
    return { success: true, email_sent: true, message: 'Point de retrait validé et prévenu par e-mail.' };
  }

  // Renvoi du lien de confirmation par l'admin (inscription en attente, e-mail non confirmé)
  async resendVerification(id: number) {
    const pool = this.db.getPool();
    const [rows]: any = await pool.query(
      `SELECT id, name, email, role, is_verified FROM users WHERE id = ? AND role = 'super_pickuppoint' LIMIT 1`,
      [id],
    );
    const point = rows[0];
    if (!point) throw new NotFoundException('Point de retrait introuvable.');
    if (Number(point.is_verified) === 1) {
      throw new BadRequestException("L'adresse e-mail est déjà confirmée.");
    }
    try {
      await sendVerificationLink(point);
    } catch (error) {
      console.error("Erreur renvoi e-mail de confirmation :", error);
      throw new InternalServerErrorException("Impossible d'envoyer l'e-mail.");
    }
    return { success: true, message: `Lien de confirmation renvoyé à ${point.email}.` };
  }
}
