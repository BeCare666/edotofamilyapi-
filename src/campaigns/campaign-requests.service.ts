import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { KIT_WITHDRAWN_SQL, assertCanChangeProcessing, stageCountsSql, stageSql } from '../orders/order-stage';

// Demandes de kit côté admin (06/10/2026) : traitées comme des commandes.
// À traiter → traitée (kit emballé par l'admin) → retirée (kit remis par le point de retrait).
// Jamais le code de retrait dans les réponses.
const SORTS: Record<string, string> = {
  'created_at:desc': 'r.created_at DESC',
  'created_at:asc': 'r.created_at ASC',
  'processed_at:desc': 'r.processed_at DESC',
  'picked_up_at:desc': 'r.picked_up_at DESC',
  'name:asc': 'r.full_name ASC',
};

// Jour au Bénin (UTC+1) → borne UTC
const day = (s: any) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const beninDayUtc = (s: string, addDays = 0) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + addDays) - 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
};

@Injectable()
export class CampaignRequestsService {
  constructor(private readonly db: DatabaseService) {}

  // Filtres réels : campagne, recherche (nom, e-mail), ville, point de retrait, période ; étape à part
  private filters(q: any, withStage: boolean) {
    const where: string[] = ['1 = 1'];
    const params: any[] = [];
    const campaignId = Number(q.campaign_id);
    if (q.campaign_id && Number.isInteger(campaignId) && campaignId > 0) { where.push('r.campaign_id = ?'); params.push(campaignId); }
    const search = typeof q.search === 'string' ? q.search.trim() : '';
    if (search) {
      where.push('(r.full_name LIKE ? COLLATE utf8mb4_general_ci OR r.email LIKE ? COLLATE utf8mb4_general_ci)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (typeof q.city === 'string' && q.city.trim()) {
      if (q.city === 'none') where.push("(r.city IS NULL OR r.city = '')");
      else { where.push('LOWER(r.city) = LOWER(?)'); params.push(q.city.trim()); }
    }
    if (typeof q.pickup_center === 'string' && /^\d+$/.test(q.pickup_center)) { where.push('r.pickup_center = ?'); params.push(q.pickup_center); }
    const from = day(q.date_from);
    const to = day(q.date_to);
    if (from) { where.push('r.created_at >= ?'); params.push(beninDayUtc(from)); }
    if (to) { where.push('r.created_at < ?'); params.push(beninDayUtc(to, 1)); }
    if (withStage) {
      const st = stageSql(q.stage, KIT_WITHDRAWN_SQL.replace(/\b(picked_up|order_status)\b/g, 'r.$1'));
      if (st) where.push(st.replace(/\bprocessed_at\b/g, 'r.processed_at'));
    }
    return { where: where.join(' AND '), params };
  }

  async list(q: any) {
    const pool = this.db.getPool();
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
    const page = Math.max(1, Number(q.page) || 1);
    const { where, params } = this.filters(q, true);
    const order = SORTS[q.sort] ?? SORTS['created_at:desc'];
    const [[rows], [[count]]]: any = await Promise.all([
      pool.query(
        `SELECT r.id, r.campaign_id, c.title AS campaign_title, r.full_name, r.email, r.city, r.pickup_center,
                pc.name AS pickup_center_name, r.created_at, r.otp_used, r.verified_at, r.picked_up, r.picked_up_at,
                r.order_status, r.processed_at, pb.name AS processed_by_name
         FROM campaign_registrations r
         JOIN campaigns c ON c.id = r.campaign_id
         LEFT JOIN users pc ON CAST(pc.id AS CHAR) = r.pickup_center
         LEFT JOIN users pb ON pb.id = r.processed_by
         WHERE ${where}
         ORDER BY ${order}, r.id DESC LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit],
      ),
      pool.query(`SELECT COUNT(*) AS total FROM campaign_registrations r WHERE ${where}`, params),
    ]);
    const total = Number(count?.total ?? 0);
    return {
      data: rows.map((r: any) => ({ ...r, picked_up: Number(r.picked_up) === 1, otp_used: Number(r.otp_used) === 1 })),
      total,
      page,
      last_page: Math.max(1, Math.ceil(total / limit)),
    };
  }

  // Compteurs réels : étapes (sur tout le périmètre filtré) ; campagnes, villes, points (dans l'étape choisie)
  async facets(q: any) {
    const pool = this.db.getPool();
    const base = this.filters({ ...q, stage: undefined }, false);
    const scoped = this.filters(q, true);
    const withdrawn = KIT_WITHDRAWN_SQL.replace(/\b(picked_up|order_status)\b/g, 'r.$1');
    const counts = stageCountsSql(withdrawn).replace(/\bprocessed_at\b/g, 'r.processed_at');
    const allCampaigns = this.filters({ ...q, campaign_id: undefined }, true);
    const [[[stages]], [campaigns], [cities], [points]]: any = await Promise.all([
      pool.query(`SELECT ${counts}, COUNT(*) AS total FROM campaign_registrations r WHERE ${base.where}`, base.params),
      pool.query(
        `SELECT c.id, c.title, COUNT(r.id) AS n FROM campaigns c
         LEFT JOIN campaign_registrations r ON r.campaign_id = c.id AND ${allCampaigns.where}
         GROUP BY c.id, c.title ORDER BY c.date_start DESC`,
        allCampaigns.params,
      ),
      pool.query(`SELECT r.city AS v, COUNT(*) AS n FROM campaign_registrations r WHERE ${scoped.where} GROUP BY r.city ORDER BY n DESC`, scoped.params),
      pool.query(
        `SELECT r.pickup_center AS id, pc.name, COUNT(*) AS n FROM campaign_registrations r
         LEFT JOIN users pc ON CAST(pc.id AS CHAR) = r.pickup_center
         WHERE ${scoped.where} GROUP BY r.pickup_center, pc.name ORDER BY n DESC`,
        scoped.params,
      ),
    ]);
    const num = (v: any) => Number(v ?? 0);
    return {
      total: num(stages?.total),
      stages: { to_process: num(stages?.to_process), processed: num(stages?.processed), withdrawn: num(stages?.withdrawn) },
      campaigns: campaigns.map((c: any) => ({ id: Number(c.id), title: c.title, count: num(c.n) })),
      cities: cities.map((c: any) => ({ value: c.v || 'none', label: c.v || 'Non renseignée', count: num(c.n) })),
      pickup_points: points.map((p: any) => ({ id: String(p.id), name: p.name ?? `Point ${p.id}`, count: num(p.n) })),
    };
  }

  async setProcessed(id: number, processed: boolean, adminId: number) {
    const pool = this.db.getPool();
    const [rows]: any = await pool.query(
      `SELECT id, picked_up, order_status, processed_at FROM campaign_registrations WHERE id = ? LIMIT 1`,
      [id],
    );
    const reg = rows[0];
    if (!reg) throw new NotFoundException('Demande introuvable.');
    assertCanChangeProcessing(reg, processed, 'kit');
    const [res]: any = processed
      ? await pool.query(
          `UPDATE campaign_registrations SET processed_at = NOW(), processed_by = ? WHERE id = ? AND processed_at IS NULL AND NOT ${KIT_WITHDRAWN_SQL}`,
          [adminId, id],
        )
      : await pool.query(
          `UPDATE campaign_registrations SET processed_at = NULL, processed_by = NULL WHERE id = ? AND processed_at IS NOT NULL AND NOT ${KIT_WITHDRAWN_SQL}`,
          [id],
        );
    if (!res?.affectedRows) throw new BadRequestException('La demande a changé entre-temps. Rechargez la page.');
    const [[after]]: any = await pool.query(`SELECT id, processed_at, processed_by FROM campaign_registrations WHERE id = ?`, [id]);
    return { success: true, ...after };
  }
}
