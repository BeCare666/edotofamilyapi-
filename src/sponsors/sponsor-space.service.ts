import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { CampaignsAdminService } from '../campaigns/campaigns-admin.service';
import { statusSql, toIsoDate } from '../campaigns/campaign-rules';
import { beninMonth, dailySeries, daysBetween, lastMonths, prediction, todayBenin } from './sponsor-rules';

// Espace sponsor : uniquement les campagnes que le sponsor soutient (campaign_sponsors.sponsor_id),
// uniquement des chiffres et graphiques (aucune donnée nominative), export après validation de l'admin.
const UTC_FMT = '%Y-%m-%d %H:%i:%s';
const STATUS_LABEL: Record<string, string> = { a_venir: 'À venir', en_cours: 'En cours', terminee: 'Terminée' };

@Injectable()
export class SponsorSpaceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly campaignsAdmin: CampaignsAdminService,
  ) { }

  // Fiche sponsor du compte connecté (l'identifiant vient du jeton, jamais de la requête)
  async sponsorFor(userId: number) {
    const [[s]]: any = await this.db.getPool().query(
      `SELECT id, name, email, activated_at FROM sponsors WHERE user_id = ? LIMIT 1`,
      [userId],
    );
    if (!s) throw new ForbiddenException('Aucun espace sponsor rattaché à ce compte.');
    return { id: Number(s.id), name: s.name, email: s.email };
  }

  // Campagnes soutenues par le sponsor, avec sa contribution et les vrais chiffres
  private async campaignsOf(sponsorId: number, campaignId?: number) {
    const [rows]: any = await this.db.getPool().query(
      `SELECT c.id, c.title, c.description, c.date_start, c.date_end, c.objective_kits, ${statusSql('c')} AS status,
              cs.amount AS contribution,
              (SELECT GROUP_CONCAT(l.city ORDER BY l.city SEPARATOR '||') FROM campaign_locations l WHERE l.campaign_id = c.id) AS cities_raw,
              (SELECT COUNT(*) FROM campaign_registrations r WHERE r.campaign_id = c.id) AS registrations,
              (SELECT COUNT(*) FROM campaign_registrations r WHERE r.campaign_id = c.id AND r.otp_used = 1) AS validated,
              (SELECT COUNT(*) FROM campaign_registrations r WHERE r.campaign_id = c.id AND r.picked_up = 1) AS withdrawn,
              (SELECT er.status FROM sponsor_export_requests er WHERE er.campaign_id = c.id AND er.sponsor_id = cs.sponsor_id) AS export_status
       FROM campaign_sponsors cs JOIN campaigns c ON c.id = cs.campaign_id
       WHERE cs.sponsor_id = ? ${campaignId ? 'AND c.id = ?' : ''}
       ORDER BY c.date_start DESC, c.id DESC`,
      campaignId ? [sponsorId, campaignId] : [sponsorId],
    );
    return rows.map((r: any) => ({
      id: Number(r.id),
      title: r.title,
      description: r.description,
      date_start: toIsoDate(r.date_start),
      date_end: toIsoDate(r.date_end),
      status: r.status,
      status_label: STATUS_LABEL[r.status] ?? r.status,
      cities: r.cities_raw ? String(r.cities_raw).split('||') : [],
      objective_kits: Number(r.objective_kits) || 0,
      contribution: Number(r.contribution) || 0,
      registrations: Number(r.registrations) || 0,
      validated: Number(r.validated) || 0,
      withdrawn: Number(r.withdrawn) || 0,
      export_status: r.export_status ?? null,
    }));
  }

  private async ownCampaign(sponsorId: number, campaignId: number) {
    const [c] = await this.campaignsOf(sponsorId, campaignId);
    if (!c) throw new NotFoundException('Campagne introuvable.'); // campagne non soutenue : même réponse
    return c;
  }

  async summary(sponsorId: number) {
    const list = await this.campaignsOf(sponsorId);
    const today = todayBenin();
    const months = lastMonths(today);
    const monthly = new Map(months.map((m) => [m, 0]));
    if (list.length) {
      const ids = list.map((c) => c.id);
      const [rows]: any = await this.db.getPool().query(
        `SELECT DATE_FORMAT(r.picked_up_at, '${UTC_FMT}') AS at FROM campaign_registrations r
         WHERE r.picked_up = 1 AND r.picked_up_at IS NOT NULL AND r.campaign_id IN (${ids.map(() => '?').join(',')})`,
        ids,
      );
      for (const r of rows) {
        const m = beninMonth(r.at);
        if (monthly.has(m)) monthly.set(m, monthly.get(m) + 1);
      }
    }
    const sum = (f: (c: any) => number) => list.reduce((s, c) => s + f(c), 0);
    const objective = sum((c) => c.objective_kits);
    const withdrawn = sum((c) => c.withdrawn);
    return {
      totals: {
        campaigns: list.length,
        a_venir: list.filter((c) => c.status === 'a_venir').length,
        en_cours: list.filter((c) => c.status === 'en_cours').length,
        terminee: list.filter((c) => c.status === 'terminee').length,
        contributions: sum((c) => c.contribution), // somme de SES contributions (décision 3)
        objective_kits: objective,
        registrations: sum((c) => c.registrations),
        withdrawn,
        withdrawal_rate: objective > 0 ? Math.round((withdrawn / objective) * 1000) / 10 : null,
      },
      monthly_withdrawals: months.map((m) => ({ month: m, withdrawn: monthly.get(m) })),
      contributions_by_campaign: list.map((c) => ({ id: c.id, title: c.title, contribution: c.contribution, status: c.status })),
    };
  }

  async campaigns(sponsorId: number, query: { status?: any; q?: any }) {
    let list = await this.campaignsOf(sponsorId);
    if (['a_venir', 'en_cours', 'terminee'].includes(query.status)) list = list.filter((c) => c.status === query.status);
    const q = typeof query.q === 'string' ? query.q.trim().toLowerCase() : '';
    if (q) list = list.filter((c) => c.title.toLowerCase().includes(q) || c.cities.some((x: string) => x.toLowerCase().includes(q)));
    return list;
  }

  // Analyse d'une campagne : indicateurs, séries, parcours, répartitions, délai moyen, prévision
  async analytics(sponsorId: number, campaignId: number) {
    const c = await this.ownCampaign(sponsorId, campaignId);
    const [regs]: any = await this.db.getPool().query(
      `SELECT DATE_FORMAT(r.created_at, '${UTC_FMT}') AS created, DATE_FORMAT(r.picked_up_at, '${UTC_FMT}') AS picked,
              r.picked_up, r.otp_used, r.city, pc.name AS point_name
       FROM campaign_registrations r LEFT JOIN users pc ON CAST(pc.id AS CHAR) = r.pickup_center
       WHERE r.campaign_id = ?`,
      [campaignId],
    );
    const today = todayBenin();
    const withdrawnRows = regs.filter((r: any) => Number(r.picked_up) === 1 && r.picked);

    const group = (key: (r: any) => string) => {
      const m = new Map<string, { label: string; registrations: number; withdrawn: number }>();
      for (const r of regs) {
        const label = key(r);
        const g = m.get(label) ?? { label, registrations: 0, withdrawn: 0 };
        g.registrations++;
        if (Number(r.picked_up) === 1) g.withdrawn++;
        m.set(label, g);
      }
      return [...m.values()].sort((a, b) => b.registrations - a.registrations || a.label.localeCompare(b.label));
    };

    const delays = withdrawnRows.map((r: any) => (Date.parse(`${r.picked.replace(' ', 'T')}Z`) - Date.parse(`${r.created.replace(' ', 'T')}Z`)) / 3_600_000);
    const avgHours = delays.length ? delays.reduce((s: number, h: number) => s + h, 0) / delays.length : null;

    return {
      campaign: c,
      indicators: {
        objective_kits: c.objective_kits,
        registrations: c.registrations,
        validated: c.validated,
        withdrawn: c.withdrawn,
        not_withdrawn: c.registrations - c.withdrawn,
        withdrawal_rate: c.objective_kits > 0 ? Math.round((c.withdrawn / c.objective_kits) * 1000) / 10 : null,
        days_remaining: c.status === 'terminee' || !c.date_end ? null : Math.max(0, daysBetween(today, c.date_end)),
        average_delay_days: avgHours === null ? null : Math.round((avgHours / 24) * 10) / 10,
      },
      funnel: [
        { step: 'Inscrits', value: c.registrations },
        { step: 'Codes validés', value: c.validated },
        { step: 'Kits retirés', value: c.withdrawn },
      ],
      daily: dailySeries(c.date_start, c.date_end, today, regs.map((r: any) => r.created), withdrawnRows.map((r: any) => r.picked)),
      by_city: group((r) => r.city || 'Non renseignée'),
      by_pickup_point: group((r) => r.point_name || 'Point inconnu'),
      prediction: prediction({ status: c.status, dateStart: c.date_start, dateEnd: c.date_end, today, withdrawn: c.withdrawn, objective: c.objective_kits }),
    };
  }

  // Demande d'export : campagne soutenue ET terminée ; redemandable après un refus
  async requestExport(sponsorId: number, campaignId: number) {
    const c = await this.ownCampaign(sponsorId, campaignId);
    if (c.status !== 'terminee') throw new BadRequestException('L’export est possible une fois la campagne terminée.');
    const pool = this.db.getPool();
    const [[existing]]: any = await pool.query(
      `SELECT id, status FROM sponsor_export_requests WHERE campaign_id = ? AND sponsor_id = ?`,
      [campaignId, sponsorId],
    );
    if (existing?.status === 'approved') return { status: 'approved', message: 'Export déjà autorisé : vous pouvez le télécharger.' };
    if (existing?.status === 'pending') return { status: 'pending', message: 'Demande déjà envoyée : en attente de validation.' };
    if (existing) {
      await pool.query(
        `UPDATE sponsor_export_requests SET status = 'pending', reason = NULL, requested_at = NOW(), decided_at = NULL, decided_by = NULL WHERE id = ?`,
        [existing.id],
      );
    } else {
      await pool.query(
        `INSERT INTO sponsor_export_requests (campaign_id, sponsor_id, status, requested_at) VALUES (?, ?, 'pending', NOW())`,
        [campaignId, sponsorId],
      );
    }
    return { status: 'pending', message: 'Demande envoyée : E·Doto Family doit la valider.' };
  }

  async exports(sponsorId: number) {
    const [rows]: any = await this.db.getPool().query(
      `SELECT er.id, er.campaign_id, c.title, er.status, er.reason,
              DATE_FORMAT(er.requested_at, '${UTC_FMT}') AS requested_at, DATE_FORMAT(er.decided_at, '${UTC_FMT}') AS decided_at
       FROM sponsor_export_requests er JOIN campaigns c ON c.id = er.campaign_id
       WHERE er.sponsor_id = ? ORDER BY er.requested_at DESC`,
      [sponsorId],
    );
    const iso = (u: string | null) => (u ? `${u.replace(' ', 'T')}Z` : null);
    return rows.map((r: any) => ({ ...r, requested_at: iso(r.requested_at), decided_at: iso(r.decided_at) }));
  }

  // Téléchargement : seulement après acceptation (sans limite ensuite — décision 5)
  async download(sponsorId: number, campaignId: number) {
    await this.ownCampaign(sponsorId, campaignId);
    const [[req]]: any = await this.db.getPool().query(
      `SELECT status FROM sponsor_export_requests WHERE campaign_id = ? AND sponsor_id = ?`,
      [campaignId, sponsorId],
    );
    if (req?.status !== 'approved') throw new ForbiddenException('Export non autorisé : demandez-le puis attendez la validation d’E·Doto Family.');
    return this.campaignsAdmin.exportCampaign(campaignId);
  }

  // Cloche : décisions sur les demandes d'export (30 derniers jours) ; pastille = décisions des 7 derniers jours
  async notifications(sponsorId: number) {
    const list = (await this.exports(sponsorId)).filter((r: any) => r.decided_at && Date.now() - Date.parse(r.decided_at) < 30 * 86_400_000);
    const recent = list.filter((r: any) => Date.now() - Date.parse(r.decided_at) < 7 * 86_400_000).length;
    return { count: recent, items: list.slice(0, 10) };
  }
}
