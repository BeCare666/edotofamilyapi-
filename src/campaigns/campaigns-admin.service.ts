import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Workbook, Worksheet } from 'exceljs';
import { DatabaseService } from '../database/database.services';
import { sendVerificationEmail } from '../auth/mailer';
import { CampaignsService } from './campaigns.service';
import {
  CAMPAIGN_STATUSES,
  CampaignInput,
  diffSponsors,
  parseCampaignInput,
  parseSponsorInput,
  STATUS_LABELS,
  statusSql,
  toIsoDate,
} from './campaign-rules';
import { campaignExtraColumns, decorateCampaign, isoDates } from './campaign-sql';

const NOT_SET = 'Non renseignée';

@Injectable()
export class CampaignsAdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly campaigns: CampaignsService,
  ) { }

  // =========================
  // SPONSORS
  // =========================
  async listSponsors() {
    const [rows]: any = await this.db.getPool().query(
      `SELECT s.id, s.name, s.email, s.created_at, s.invited_at, s.activated_at,
              (SELECT COUNT(*) FROM campaign_sponsors cs WHERE cs.sponsor_id = s.id) AS campaigns_count,
              (SELECT i.expires_at FROM sponsor_invitations i WHERE i.sponsor_id = s.id) AS invitation_expires_at
       FROM sponsors s ORDER BY s.name ASC`,
    );
    // État du compte de l'espace sponsor : non invité / invité (lien valide ou expiré) / actif
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      created_at: r.created_at,
      campaigns_count: Number(r.campaigns_count) || 0,
      account_status: r.activated_at ? 'active' : r.invited_at ? 'invited' : 'not_invited',
      invitation_expired: !r.activated_at && !!r.invited_at && (!r.invitation_expires_at || new Date(r.invitation_expires_at).getTime() < Date.now()),
      invited_at: r.invited_at,
      activated_at: r.activated_at,
    }));
  }

  async createSponsor(body: any) {
    const { name, email } = parseSponsorInput(body);
    const pool = this.db.getPool();
    const [existing]: any = await pool.query(`SELECT id FROM sponsors WHERE email = ? LIMIT 1`, [email]);
    if (existing[0]) throw new ConflictException('Un sponsor existe déjà avec cet e-mail.');
    const [res]: any = await pool.query(`INSERT INTO sponsors (name, email) VALUES (?, ?)`, [name, email]);
    return { id: res.insertId, name, email };
  }

  // =========================
  // LISTE / DÉTAIL
  // =========================
  async list({ status, page = 1, limit = 20 }: { status?: string; page?: any; limit?: any }) {
    const pool = this.db.getPool();
    const pageNumber = Math.max(1, Number(page) || 1);
    const limitNumber = Math.min(100, Math.max(1, Number(limit) || 20));
    const filter = CAMPAIGN_STATUSES.includes(status as any) ? `WHERE ${statusSql('c')} = ?` : '';
    const params = filter ? [status] : [];

    const [[rows], [countRows]]: any = await Promise.all([
      pool.query(
        `SELECT c.id, c.title, c.date_start, c.date_end, c.objective_kits, c.location, c.created_at,
                ${campaignExtraColumns('c')},
                (SELECT GROUP_CONCAT(cs.name ORDER BY cs.name SEPARATOR ', ') FROM campaign_sponsors cs WHERE cs.campaign_id = c.id) AS sponsor_names
         FROM campaigns c ${filter}
         ORDER BY c.date_start DESC, c.id DESC
         LIMIT ? OFFSET ?`,
        [...params, limitNumber, (pageNumber - 1) * limitNumber],
      ),
      pool.query(`SELECT COUNT(*) AS total FROM campaigns c ${filter}`, params),
    ]);
    const total = Number(countRows[0]?.total || 0);
    return {
      data: rows.map((r: any) => isoDates(decorateCampaign(r))),
      total,
      page: pageNumber,
      last_page: Math.max(1, Math.ceil(total / limitNumber)),
    };
  }

  private async loadCampaign(id: number) {
    const [rows]: any = await this.db.getPool().query(
      `SELECT c.id, c.title, c.description, c.image_url, c.date_start, c.date_end, c.objective_kits, c.location,
              c.created_at, c.updated_at, ${campaignExtraColumns('c')}
       FROM campaigns c WHERE c.id = ? LIMIT 1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Campagne introuvable.');
    return isoDates(decorateCampaign(rows[0]));
  }

  async detail(id: number) {
    const pool = this.db.getPool();
    const campaign = await this.loadCampaign(id);
    const [[sponsors], [registrations]]: any = await Promise.all([
      pool.query(
        `SELECT cs.sponsor_id, COALESCE(s.name, cs.name) AS name, COALESCE(s.email, cs.email) AS email, cs.amount
         FROM campaign_sponsors cs LEFT JOIN sponsors s ON s.id = cs.sponsor_id
         WHERE cs.campaign_id = ? ORDER BY name ASC`,
        [id],
      ),
      // Jamais le code OTP : seulement l'état du retrait
      pool.query(
        `SELECT r.id, r.full_name, r.email, r.city, r.pickup_center, pc.name AS pickup_center_name,
                r.created_at, r.otp_used, r.picked_up, r.picked_up_at
         FROM campaign_registrations r
         LEFT JOIN users pc ON CAST(pc.id AS CHAR) = r.pickup_center
         WHERE r.campaign_id = ? ORDER BY r.created_at ASC`,
        [id],
      ),
    ]);

    const regs = registrations.map((r: any) => ({
      ...r,
      otp_used: Number(r.otp_used) === 1,
      picked_up: Number(r.picked_up) === 1,
    }));
    return {
      ...campaign,
      sponsors: sponsors.map((s: any) => ({ ...s, sponsor_id: s.sponsor_id === null ? null : Number(s.sponsor_id), amount: Number(s.amount) })),
      registrations: regs,
      stats: {
        by_pickup_point: groupStats(regs, (r) => r.pickup_center_name || `Point ${r.pickup_center}`),
        by_city: groupStats(regs, (r) => r.city || NOT_SET),
      },
    };
  }

  // =========================
  // CRÉATION / MODIFICATION / SUPPRESSION
  // =========================
  private async loadSponsors(conn: any, input: CampaignInput) {
    if (!input.sponsors.length) return new Map<number, { name: string; email: string }>();
    const ids = input.sponsors.map((s) => s.sponsor_id);
    const [rows]: any = await conn.query(
      `SELECT id, name, email FROM sponsors WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
    const map = new Map<number, { name: string; email: string }>(rows.map((r: any) => [Number(r.id), { name: r.name, email: r.email }]));
    for (const id of ids) if (!map.has(id)) throw new BadRequestException(`Sponsor introuvable : ${id}.`);
    return map;
  }

  private async addSponsorLinks(conn: any, campaignId: number, links: { sponsor_id: number; amount: number }[], info: Map<number, { name: string; email: string }>) {
    const toNotify: { name: string; email: string; amount: number; accessCode: string }[] = [];
    for (const l of links) {
      const s = info.get(l.sponsor_id);
      const accessCode = randomBytes(16).toString('hex');
      await conn.query(
        `INSERT INTO campaign_sponsors (campaign_id, sponsor_id, name, email, amount, access_code) VALUES (?, ?, ?, ?, ?, ?)`,
        [campaignId, l.sponsor_id, s.name, s.email, l.amount, accessCode],
      );
      toNotify.push({ name: s.name, email: s.email, amount: l.amount, accessCode });
    }
    return toNotify;
  }

  // E-mail d'accès au sponsor (comportement existant : n'empêche pas l'enregistrement en cas d'échec)
  private async notifySponsors(title: string, list: { name: string; email: string; amount: number; accessCode: string }[]) {
    for (const s of list) {
      try {
        await sendVerificationEmail({
          email: s.email,
          subject: `Accès sponsor – ${title}`,
          message: this.campaigns.buildSponsorEmail({ name: s.name, campaignTitle: title, amount: s.amount, accessCode: s.accessCode }),
        });
      } catch (e) {
        console.error('Erreur email sponsor:', e);
      }
    }
  }

  private async withTransaction<T>(fn: (conn: any) => Promise<T>): Promise<T> {
    const conn = await this.db.getPool().getConnection();
    try {
      await conn.beginTransaction();
      const out = await fn(conn);
      await conn.commit();
      return out;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async create(body: any) {
    const input = parseCampaignInput(body);
    const { id, notify } = await this.withTransaction(async (conn) => {
      const info = await this.loadSponsors(conn, input);
      const [res]: any = await conn.query(
        `INSERT INTO campaigns (title, description, image_url, location, date_start, date_end, objective_kits)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [input.title, input.description, input.image_url, input.cities.join(', '), input.date_start, input.date_end, input.objective_kits],
      );
      const campaignId = Number(res.insertId);
      for (const city of input.cities) {
        await conn.query(`INSERT INTO campaign_locations (campaign_id, city) VALUES (?, ?)`, [campaignId, city]);
      }
      const notify = await this.addSponsorLinks(conn, campaignId, input.sponsors, info);
      return { id: campaignId, notify };
    });
    await this.notifySponsors(input.title, notify);
    return { id, message: 'Campagne créée.' };
  }

  async update(id: number, body: any) {
    const input = parseCampaignInput(body);
    const notify = await this.withTransaction(async (conn) => {
      const [exists]: any = await conn.query(`SELECT id FROM campaigns WHERE id = ? LIMIT 1`, [id]);
      if (!exists[0]) throw new NotFoundException('Campagne introuvable.');
      const info = await this.loadSponsors(conn, input);

      await conn.query(
        `UPDATE campaigns SET title = ?, description = ?, image_url = ?, location = ?, date_start = ?, date_end = ?, objective_kits = ?
         WHERE id = ?`,
        [input.title, input.description, input.image_url, input.cities.join(', '), input.date_start, input.date_end, input.objective_kits, id],
      );

      // Villes : on retire celles qui ne sont plus dans la liste, on ajoute les nouvelles
      const [curCities]: any = await conn.query(`SELECT id, city FROM campaign_locations WHERE campaign_id = ?`, [id]);
      const wanted = new Set(input.cities.map((c) => c.toLowerCase()));
      const have = new Set<string>();
      for (const row of curCities) {
        const key = String(row.city).toLowerCase();
        if (!wanted.has(key)) await conn.query(`DELETE FROM campaign_locations WHERE id = ?`, [row.id]);
        else have.add(key);
      }
      for (const city of input.cities) {
        if (!have.has(city.toLowerCase())) {
          await conn.query(`INSERT INTO campaign_locations (campaign_id, city) VALUES (?, ?)`, [id, city]);
        }
      }

      // Sponsors : le code d'accès des sponsors conservés ne change pas
      const [curLinks]: any = await conn.query(
        `SELECT sponsor_id, amount FROM campaign_sponsors WHERE campaign_id = ? AND sponsor_id IS NOT NULL`,
        [id],
      );
      const diff = diffSponsors(curLinks, input.sponsors);
      for (const sid of diff.removed) {
        await conn.query(`DELETE FROM campaign_sponsors WHERE campaign_id = ? AND sponsor_id = ?`, [id, sid]);
      }
      for (const u of diff.updated) {
        await conn.query(`UPDATE campaign_sponsors SET amount = ? WHERE campaign_id = ? AND sponsor_id = ?`, [u.amount, id, u.sponsor_id]);
      }
      return this.addSponsorLinks(conn, id, diff.added, info);
    });
    await this.notifySponsors(input.title, notify);
    return { id, message: 'Campagne modifiée.' };
  }

  async remove(id: number) {
    const pool = this.db.getPool();
    const [rows]: any = await pool.query(
      `SELECT c.id, (SELECT COUNT(*) FROM campaign_registrations r WHERE r.campaign_id = c.id) AS n
       FROM campaigns c WHERE c.id = ? LIMIT 1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Campagne introuvable.');
    const n = Number(rows[0].n) || 0;
    if (n > 0) {
      throw new BadRequestException(`Suppression impossible : la campagne a ${n} inscrit${n > 1 ? 's' : ''}.`);
    }
    // Villes et liens sponsors supprimés en cascade (clés étrangères ON DELETE CASCADE)
    await pool.query(`DELETE FROM campaigns WHERE id = ?`, [id]);
    return { message: 'Campagne supprimée.' };
  }

  // =========================
  // EXCEL
  // =========================
  async exportCampaign(id: number): Promise<{ filename: string; buffer: Buffer }> {
    const d: any = await this.detail(id);
    const wb = newWorkbook();

    const info = wb.addWorksheet('Campagne');
    info.columns = [{ header: 'Information', key: 'k', width: 28 }, { header: 'Valeur', key: 'v', width: 60 }];
    const rows: [string, any][] = [
      ['Campagne', d.title],
      ['Statut', STATUS_LABELS[d.status as keyof typeof STATUS_LABELS] ?? d.status],
      ['Ville(s)', d.cities.join(', ')],
      ['Date de début', d.date_start],
      ['Date de fin', d.date_end ?? NOT_SET],
      ['Kits fournis (objectif)', d.objective_kits],
      ['Inscrits', d.registrations_count],
      ['Kits retirés', d.picked_up_count],
      ['Inscrits sans retrait', d.registrations_count - d.picked_up_count],
      ['Taux de retrait (sur les kits fournis)', d.objective_kits ? `${Math.round((d.picked_up_count / d.objective_kits) * 1000) / 10} %` : '—'],
      ['Budget (somme des sponsors, FCFA)', d.budget],
      ['Description', d.description ?? ''],
    ];
    rows.forEach(([k, v]) => info.addRow({ k, v }));
    styleHeader(info);

    const sp = wb.addWorksheet('Sponsors');
    sp.columns = [
      { header: 'Sponsor', key: 'name', width: 32 },
      { header: 'E-mail', key: 'email', width: 34 },
      { header: 'Montant (FCFA)', key: 'amount', width: 18 },
    ];
    d.sponsors.forEach((s: any) => sp.addRow(s));
    sp.addRow({ name: 'Budget total', amount: d.budget }).font = { bold: true };
    styleHeader(sp);

    const reg = wb.addWorksheet('Inscrits');
    reg.columns = [
      { header: 'Nom', key: 'full_name', width: 28 },
      { header: 'E-mail', key: 'email', width: 32 },
      { header: 'Ville', key: 'city', width: 18 },
      { header: 'Point de retrait', key: 'point', width: 28 },
      { header: 'Inscrit le', key: 'created', width: 20 },
      { header: 'Kit retiré', key: 'picked', width: 12 },
      { header: 'Retiré le', key: 'picked_at', width: 20 },
    ];
    d.registrations.forEach((r: any) =>
      reg.addRow({
        full_name: r.full_name,
        email: r.email,
        city: r.city || NOT_SET,
        point: r.pickup_center_name || `Point ${r.pickup_center}`,
        created: formatDateTime(r.created_at),
        picked: r.picked_up ? 'Oui' : 'Non',
        picked_at: r.picked_up_at ? formatDateTime(r.picked_up_at) : '',
      }),
    );
    styleHeader(reg);

    addStatsSheet(wb, 'Par point de retrait', 'Point de retrait', d.stats.by_pickup_point);
    addStatsSheet(wb, 'Par ville', 'Ville', d.stats.by_city);

    return { filename: `campagne-${d.id}-${slug(d.title)}.xlsx`, buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
  }

  async exportAll(): Promise<{ filename: string; buffer: Buffer }> {
    const [rows]: any = await this.db.getPool().query(
      `SELECT c.id, c.title, c.date_start, c.date_end, c.objective_kits, c.location, ${campaignExtraColumns('c')},
              (SELECT GROUP_CONCAT(cs.name ORDER BY cs.name SEPARATOR ', ') FROM campaign_sponsors cs WHERE cs.campaign_id = c.id) AS sponsor_names
       FROM campaigns c ORDER BY c.date_start DESC, c.id DESC`,
    );
    const list = rows.map((r: any) => isoDates(decorateCampaign(r)));
    const wb = newWorkbook();
    const ws = wb.addWorksheet('Campagnes');
    ws.columns = [
      { header: 'N°', key: 'id', width: 8 },
      { header: 'Campagne', key: 'title', width: 40 },
      { header: 'Statut', key: 'status', width: 12 },
      { header: 'Ville(s)', key: 'cities', width: 30 },
      { header: 'Début', key: 'date_start', width: 12 },
      { header: 'Fin', key: 'date_end', width: 12 },
      { header: 'Sponsors', key: 'sponsors', width: 30 },
      { header: 'Budget (FCFA)', key: 'budget', width: 16 },
      { header: 'Kits fournis', key: 'objective_kits', width: 12 },
      { header: 'Inscrits', key: 'registrations_count', width: 10 },
      { header: 'Kits retirés', key: 'picked_up_count', width: 12 },
      { header: 'Inscrits sans retrait', key: 'not_picked', width: 18 },
    ];
    for (const c of list) {
      ws.addRow({
        ...c,
        status: STATUS_LABELS[c.status as keyof typeof STATUS_LABELS] ?? c.status,
        cities: c.cities.join(', '),
        date_end: c.date_end ?? NOT_SET,
        sponsors: c.sponsor_names ?? '',
        not_picked: c.registrations_count - c.picked_up_count,
      });
    }
    const totals = ws.addRow({
      title: 'TOTAL',
      budget: list.reduce((s: number, c: any) => s + c.budget, 0),
      objective_kits: list.reduce((s: number, c: any) => s + (Number(c.objective_kits) || 0), 0),
      registrations_count: list.reduce((s: number, c: any) => s + c.registrations_count, 0),
      picked_up_count: list.reduce((s: number, c: any) => s + c.picked_up_count, 0),
      not_picked: list.reduce((s: number, c: any) => s + c.registrations_count - c.picked_up_count, 0),
    });
    totals.font = { bold: true };
    styleHeader(ws);
    return { filename: `campagnes-${toIsoDate(new Date())}.xlsx`, buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
  }
}

function groupStats(regs: any[], key: (r: any) => string) {
  const map = new Map<string, { label: string; registrations: number; picked_up: number }>();
  for (const r of regs) {
    const label = key(r);
    const g = map.get(label) ?? { label, registrations: 0, picked_up: 0 };
    g.registrations++;
    if (r.picked_up) g.picked_up++;
    map.set(label, g);
  }
  return [...map.values()].sort((a, b) => b.registrations - a.registrations || a.label.localeCompare(b.label));
}

function newWorkbook() {
  const wb = new Workbook();
  wb.creator = 'E·Doto Family';
  wb.created = new Date();
  return wb;
}

function styleHeader(ws: Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6EA9' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function addStatsSheet(wb: Workbook, name: string, label: string, stats: { label: string; registrations: number; picked_up: number }[]) {
  const ws = wb.addWorksheet(name);
  ws.columns = [
    { header: label, key: 'label', width: 32 },
    { header: 'Inscrits', key: 'registrations', width: 12 },
    { header: 'Kits retirés', key: 'picked_up', width: 14 },
    { header: 'Inscrits sans retrait', key: 'not_picked', width: 20 },
  ];
  stats.forEach((s) => ws.addRow({ ...s, not_picked: s.registrations - s.picked_up }));
  ws.addRow({
    label: 'TOTAL',
    registrations: stats.reduce((n, s) => n + s.registrations, 0),
    picked_up: stats.reduce((n, s) => n + s.picked_up, 0),
    not_picked: stats.reduce((n, s) => n + s.registrations - s.picked_up, 0),
  }).font = { bold: true };
  styleHeader(ws);
}

function formatDateTime(v: any) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('fr-FR', { timeZone: 'Africa/Porto-Novo' });
}

function slug(s: string) {
  return String(s || 'campagne')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 50) || 'campagne';
}
