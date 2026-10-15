import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { sendVerificationEmail } from '../auth/mailer';
import { toIsoDate } from '../campaigns/campaign-rules';
import { PROPOSAL_LABELS, PROPOSAL_STATUSES, ProposalStatus, escapeHtml, parseProposal } from './sponsor-rules';

// Demandes de campagne (15/10/2026) : le sponsor soumet → l'admin valide ou refuse (motif)
// → l'admin crée la campagne à partir de la demande validée (statut « Campagne créée »).
const UTC_FMT = '%Y-%m-%d %H:%i:%s';
const iso = (u: string | null) => (u ? `${u.replace(' ', 'T')}Z` : null);
const SORTS: Record<string, string> = {
  recent: 'p.created_at DESC, p.id DESC',
  oldest: 'p.created_at ASC, p.id ASC',
  start: 'p.date_start ASC, p.id DESC',
  kits: 'p.objective_kits DESC, p.id DESC',
  budget: 'p.budget DESC, p.id DESC',
};

function decisionEmail(contact: string, title: string, status: ProposalStatus, note: string | null, link: string) {
  const text: Record<string, string> = {
    approved: 'a été <strong style="color:#3f6b45;">validée</strong>. L’équipe E.doto family prépare maintenant la campagne.',
    rejected: 'n’a pas été retenue.',
    created: 'est devenue une <strong style="color:#3f6b45;">campagne</strong>. Vous pouvez la suivre en temps réel depuis votre espace sponsor.',
  };
  return `
  <div style="font-family: Inter, Arial, sans-serif; max-width: 620px; margin: auto; background: #fff; border-radius: 16px; overflow: hidden; border: 1px solid #f1ece4;">
    <div style="background: #1f1b16; padding: 24px; text-align: center;">
      <p style="color: #fff; font-size: 20px; margin: 0; font-family: Poppins, Arial, sans-serif;">E.doto family · Espace sponsor</p>
    </div>
    <div style="padding: 28px; color: #1f1b16; font-size: 15px; line-height: 1.6;">
      <p>Bonjour <strong>${escapeHtml(contact)}</strong>,</p>
      <p>Votre demande de campagne <strong>${escapeHtml(title)}</strong> ${text[status]}</p>
      ${note ? `<p>${status === 'rejected' ? 'Motif' : 'Message de l’équipe'} : ${escapeHtml(note)}</p>` : ''}
      <p><a href="${link}" style="color: #c2185b;">Ouvrir mon espace sponsor</a></p>
    </div>
  </div>`;
}

@Injectable()
export class SponsorProposalsService {
  constructor(private readonly db: DatabaseService) { }

  private map(r: any) {
    let cities: string[] = [];
    try { cities = JSON.parse(r.cities); } catch { cities = []; }
    return {
      id: Number(r.id),
      sponsor_id: Number(r.sponsor_id),
      sponsor_name: r.sponsor_name ?? undefined,
      sponsor_email: r.sponsor_email ?? undefined,
      sponsor_contact: r.sponsor_contact ?? undefined,
      sponsor_phone: r.sponsor_phone ?? undefined,
      title: r.title,
      description: r.description,
      cities,
      date_start: toIsoDate(r.date_start),
      date_end: toIsoDate(r.date_end),
      objective_kits: Number(r.objective_kits) || 0,
      budget: Number(r.budget) || 0,
      status: r.status as ProposalStatus,
      status_label: PROPOSAL_LABELS[r.status as ProposalStatus] ?? r.status,
      admin_note: r.admin_note,
      campaign_id: r.campaign_id === null || r.campaign_id === undefined ? null : Number(r.campaign_id),
      campaign_title: r.campaign_title ?? null,
      created_at: iso(r.created_at),
      decided_at: iso(r.decided_at),
      decided_by_name: r.decided_by_name ?? null,
    };
  }

  private baseSelect() {
    return `SELECT p.*, DATE_FORMAT(p.created_at, '${UTC_FMT}') AS created_at, DATE_FORMAT(p.decided_at, '${UTC_FMT}') AS decided_at,
              s.name AS sponsor_name, s.email AS sponsor_email, s.contact_name AS sponsor_contact, s.phone AS sponsor_phone,
              c.title AS campaign_title, u.name AS decided_by_name
       FROM sponsor_campaign_proposals p
       JOIN sponsors s ON s.id = p.sponsor_id
       LEFT JOIN campaigns c ON c.id = p.campaign_id
       LEFT JOIN users u ON u.id = p.decided_by`;
  }

  // Filtres réels communs (sponsor et admin) : statut, recherche, ville, période de début, tri
  private where(q: any, extra: { sql: string; params: any[] }[] = []) {
    const where: string[] = [];
    const params: any[] = [];
    for (const e of extra) { where.push(e.sql); params.push(...e.params); }
    if (PROPOSAL_STATUSES.includes(q?.status)) { where.push('p.status = ?'); params.push(q.status); }
    const search = typeof q?.q === 'string' ? q.q.trim() : '';
    if (search) {
      where.push('(p.title COLLATE utf8mb4_general_ci LIKE ? OR s.name COLLATE utf8mb4_general_ci LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    const city = typeof q?.city === 'string' ? q.city.trim() : '';
    if (city) { where.push('p.cities COLLATE utf8mb4_general_ci LIKE ?'); params.push(`%${JSON.stringify(city).slice(1, -1)}%`); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(q?.from || '')) { where.push('p.date_start >= ?'); params.push(q.from); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(q?.to || '')) { where.push('p.date_start <= ?'); params.push(q.to); }
    const sponsor = Number(q?.sponsor);
    if (Number.isInteger(sponsor) && sponsor > 0) { where.push('p.sponsor_id = ?'); params.push(sponsor); }
    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params, order: SORTS[q?.sort] ?? SORTS.recent };
  }

  // Compteurs réels pour les filtres
  private async facets(scope: { sql: string; params: any[] } | null) {
    const pool = this.db.getPool();
    const w = scope ? `WHERE ${scope.sql}` : '';
    const p = scope ? scope.params : [];
    const [[statusRows], [cityRows], [sponsorRows]]: any = await Promise.all([
      pool.query(`SELECT p.status, COUNT(*) AS n FROM sponsor_campaign_proposals p ${w} GROUP BY p.status`, p),
      pool.query(`SELECT p.cities FROM sponsor_campaign_proposals p ${w}`, p),
      scope ? Promise.resolve([[]]) : pool.query(
        `SELECT s.id, s.name, COUNT(*) AS n FROM sponsor_campaign_proposals p JOIN sponsors s ON s.id = p.sponsor_id GROUP BY s.id, s.name ORDER BY s.name`,
      ),
    ]);
    const cities = new Map<string, number>();
    for (const r of cityRows) {
      let list: string[] = [];
      try { list = JSON.parse(r.cities); } catch { }
      for (const c of list) cities.set(c, (cities.get(c) || 0) + 1);
    }
    const counts = Object.fromEntries(statusRows.map((r: any) => [r.status, Number(r.n)]));
    return {
      statuses: PROPOSAL_STATUSES.map((s) => ({ value: s, label: PROPOSAL_LABELS[s], count: counts[s] || 0 })),
      total: statusRows.reduce((s: number, r: any) => s + Number(r.n), 0),
      cities: [...cities.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([value, count]) => ({ value, label: value, count })),
      sponsors: sponsorRows.map((r: any) => ({ value: String(r.id), label: r.name, count: Number(r.n) })),
    };
  }

  // ------------------------------------------------------------ Sponsor
  async create(sponsorId: number, body: any) {
    const input = parseProposal(body);
    const [res]: any = await this.db.getPool().query(
      `INSERT INTO sponsor_campaign_proposals (sponsor_id, title, description, cities, date_start, date_end, objective_kits, budget, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [sponsorId, input.title, input.description, JSON.stringify(input.cities), input.date_start, input.date_end, input.objective_kits, input.budget],
    );
    return { id: Number(res.insertId), status: 'pending', message: 'Demande envoyée : l’équipe E.doto family va l’étudier.' };
  }

  async listForSponsor(sponsorId: number, q: any) {
    const w = this.where(q, [{ sql: 'p.sponsor_id = ?', params: [sponsorId] }]);
    const [rows]: any = await this.db.getPool().query(`${this.baseSelect()} ${w.sql} ORDER BY ${w.order}`, w.params);
    return rows.map((r: any) => this.map(r));
  }

  facetsForSponsor(sponsorId: number) {
    return this.facets({ sql: 'p.sponsor_id = ?', params: [sponsorId] });
  }

  async oneForSponsor(sponsorId: number, id: number) {
    const [[row]]: any = await this.db.getPool().query(`${this.baseSelect()} WHERE p.id = ? AND p.sponsor_id = ?`, [id, sponsorId]);
    if (!row) throw new NotFoundException('Demande introuvable.');
    return this.map(row);
  }

  // Le sponsor peut retirer une demande tant qu'elle est en attente
  async withdraw(sponsorId: number, id: number) {
    const [res]: any = await this.db.getPool().query(
      `DELETE FROM sponsor_campaign_proposals WHERE id = ? AND sponsor_id = ? AND status = 'pending'`,
      [id, sponsorId],
    );
    if (!res?.affectedRows) throw new BadRequestException('Seule une demande en attente peut être retirée.');
    return { success: true, message: 'Demande retirée.' };
  }

  // ------------------------------------------------------------ Admin
  async listForAdmin(q: any) {
    const w = this.where(q);
    const page = Math.max(1, Number(q?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q?.limit) || 20));
    const pool = this.db.getPool();
    const [[{ total }]]: any = await pool.query(
      `SELECT COUNT(*) AS total FROM sponsor_campaign_proposals p JOIN sponsors s ON s.id = p.sponsor_id ${w.sql}`,
      w.params,
    );
    const [rows]: any = await pool.query(
      `${this.baseSelect()} ${w.sql} ORDER BY (p.status = 'pending') DESC, ${w.order} LIMIT ? OFFSET ?`,
      [...w.params, limit, (page - 1) * limit],
    );
    return { data: rows.map((r: any) => this.map(r)), total: Number(total), page, limit, last_page: Math.max(1, Math.ceil(Number(total) / limit)) };
  }

  facetsForAdmin() {
    return this.facets(null);
  }

  async oneForAdmin(id: number) {
    const [[row]]: any = await this.db.getPool().query(`${this.baseSelect()} WHERE p.id = ?`, [id]);
    if (!row) throw new NotFoundException('Demande introuvable.');
    return this.map(row);
  }

  // E-mail au sponsor après une décision ou la création de la campagne ; un échec n'annule rien
  async notify(id: number) {
    try {
      const p = await this.oneForAdmin(id);
      const base = (process.env.FRONTEND_CALLBACK_URL || '').replace(/\/+$/, '');
      await sendVerificationEmail({
        email: p.sponsor_email,
        subject: `Votre demande de campagne · ${p.title}`,
        message: decisionEmail(p.sponsor_contact || p.sponsor_name, p.title, p.status, p.admin_note, `${base}/sponsor`),
      });
      return true;
    } catch (e) {
      console.error('Erreur e-mail décision demande de campagne :', e);
      return false;
    }
  }

  async decide(id: number, adminId: number, approve: boolean, noteRaw: any) {
    const note = typeof noteRaw === 'string' ? noteRaw.trim() : '';
    if (!approve && !note) throw new BadRequestException('Indiquez le motif du refus.');
    if (note.length > 500) throw new BadRequestException('Message trop long (500 caractères max).');
    const [res]: any = await this.db.getPool().query(
      `UPDATE sponsor_campaign_proposals SET status = ?, admin_note = ?, decided_at = NOW(), decided_by = ? WHERE id = ? AND status = 'pending'`,
      [approve ? 'approved' : 'rejected', note || null, adminId, id],
    );
    if (!res?.affectedRows) {
      await this.oneForAdmin(id); // 404 si elle n'existe pas
      throw new BadRequestException('Cette demande a déjà été traitée.');
    }
    const emailSent = await this.notify(id);
    return { success: true, email_sent: emailSent, message: approve ? 'Demande validée : vous pouvez créer la campagne.' : 'Demande refusée.' };
  }
}

// ------------------------------------------------------------ Lien avec la création de campagne
// Fonctions simples (sans injection) appelées par campaigns-admin.service, dans sa transaction.

// La demande doit être validée, sans campagne, et son sponsor doit faire partie des sponsors de la campagne.
export async function assertProposalCanLink(conn: any, proposalId: number, sponsorIds: number[]) {
  const [[p]]: any = await conn.query(`SELECT id, status, sponsor_id, campaign_id FROM sponsor_campaign_proposals WHERE id = ? FOR UPDATE`, [proposalId]);
  if (!p) throw new NotFoundException('Demande de campagne introuvable.');
  if (p.status !== 'approved' || p.campaign_id) throw new BadRequestException('Seule une demande validée, sans campagne, peut devenir une campagne.');
  if (!sponsorIds.includes(Number(p.sponsor_id))) {
    throw new BadRequestException('Le sponsor à l’origine de la demande doit faire partie des sponsors de la campagne.');
  }
}

export async function markProposalCreated(conn: any, proposalId: number, campaignId: number) {
  await conn.query(`UPDATE sponsor_campaign_proposals SET status = 'created', campaign_id = ? WHERE id = ?`, [campaignId, proposalId]);
}
