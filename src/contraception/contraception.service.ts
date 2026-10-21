import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { cleanText } from '../teleconsultation/tc-rules';
import { esc, frame, button, mail, siteUrl } from '../teleconsultation/tc-notify';
import { iso, num } from '../teleconsultation/tc-db';
import { TeleconsultationService } from '../teleconsultation/teleconsultation.service';
import { CONTRACEPTION_DEFAULTS } from './contraception-defaults';
import {
  CONCLUSION_LABEL,
  MAX_OPEN_REQUESTS,
  OPEN_STATUSES,
  REQUEST_STATUSES,
  RequestStatus,
  STATUS_LABEL,
  cleanList,
  computeSteps,
  parseList,
  slugify,
} from './contraception-rules';

// Adoption des contraceptifs (21/10/2026) : fiches (modifiables par le super admin) et demandes en 7 étapes.
// Étapes 3 à 6 : téléconsultation (rendez-vous, compte rendu, orientation vers un centre, prise en charge).

const METHOD_FIELDS = 'id, slug, name, family, requires_doctor, summary, description, how_to, advantages, drawbacks, criteria, efficacy, duration, protects_sti, image_url, image_credit, sort_order, is_active';

@Injectable()
export class ContraceptionService {
  constructor(private readonly db: DatabaseService, private readonly tc: TeleconsultationService) {}

  private get pool(): any {
    return this.db.getPool();
  }

  // =====================================================================
  // Fiches
  // =====================================================================

  /** Fiches par défaut (manuel OMS) chargées une seule fois, seulement si aucune fiche n'existe */
  private seeded = false;
  private async ensureDefaults() {
    if (this.seeded) return;
    try {
      const [[{ n }]]: any = await this.pool.query(`SELECT COUNT(*) AS n FROM contraceptive_methods`);
      if (num(n) === 0) {
        let order = 10;
        for (const m of CONTRACEPTION_DEFAULTS) {
          await this.pool.query(
            `INSERT IGNORE INTO contraceptive_methods (slug, name, family, requires_doctor, summary, description, how_to, advantages, drawbacks, criteria,
               efficacy, duration, protects_sti, image_url, image_credit, sort_order, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [m.slug, m.name, m.family, m.requires_doctor, m.summary, m.description, m.how_to, JSON.stringify(m.advantages), JSON.stringify(m.drawbacks),
              JSON.stringify(m.criteria), m.efficacy, m.duration, m.protects_sti, m.image_url, m.image_credit, order],
          );
          order += 10;
        }
      }
      this.seeded = true;
    } catch (e: any) {
      console.error('[contraception] fiches par défaut :', e?.message);
    }
  }

  private present(m: any, full = true) {
    const base = {
      id: Number(m.id),
      slug: m.slug,
      name: m.name,
      family: m.family,
      requires_doctor: Number(m.requires_doctor) === 1,
      summary: m.summary,
      efficacy: m.efficacy,
      duration: m.duration,
      protects_sti: Number(m.protects_sti) === 1,
      image_url: m.image_url,
      image_credit: m.image_credit,
      sort_order: Number(m.sort_order),
      is_active: Number(m.is_active) === 1,
    };
    if (!full) return base;
    return {
      ...base,
      description: m.description,
      how_to: m.how_to,
      advantages: parseList(m.advantages),
      drawbacks: parseList(m.drawbacks),
      criteria: parseList(m.criteria),
    };
  }

  /** Catalogue public : fiches actives, avec et sans médecin */
  async methods() {
    await this.ensureDefaults();
    const [rows]: any = await this.pool.query(`SELECT ${METHOD_FIELDS} FROM contraceptive_methods WHERE is_active = 1 ORDER BY sort_order, name`);
    return rows.map((m: any) => this.present(m, false));
  }

  async method(slug: string) {
    await this.ensureDefaults();
    const [[m]]: any = await this.pool.query(`SELECT ${METHOD_FIELDS} FROM contraceptive_methods WHERE slug = ? AND is_active = 1 LIMIT 1`, [String(slug)]);
    if (!m) throw new NotFoundException('Contraceptif introuvable.');
    return this.present(m);
  }

  // ---------------- Admin : fiches
  async adminMethods() {
    await this.ensureDefaults();
    const [rows]: any = await this.pool.query(
      `SELECT ${METHOD_FIELDS},
              (SELECT COUNT(*) FROM contraception_requests r WHERE r.method_id = contraceptive_methods.id) AS requests
       FROM contraceptive_methods ORDER BY sort_order, name`,
    );
    return rows.map((m: any) => ({ ...this.present(m), requests: num(m.requests) }));
  }

  private parseMethod(body: any) {
    const name = cleanText(body?.name, 120, 'Le nom', true) as string;
    const image = cleanText(body?.image_url, 500, "L'adresse de l'image");
    if (image && !/^(https?:\/\/|\/)/.test(image)) throw new BadRequestException("Adresse de l'image invalide.");
    return {
      name,
      family: cleanText(body?.family, 80, 'La famille'),
      requires_doctor: body?.requires_doctor === false || body?.requires_doctor === 0 || body?.requires_doctor === '0' ? 0 : 1,
      summary: cleanText(body?.summary, 400, 'Le résumé'),
      description: cleanText(body?.description, 4000, 'La description'),
      how_to: cleanText(body?.how_to, 4000, 'Comment ça se fait'),
      advantages: JSON.stringify(cleanList(body?.advantages, 'Les avantages')),
      drawbacks: JSON.stringify(cleanList(body?.drawbacks, 'Les inconvénients')),
      criteria: JSON.stringify(cleanList(body?.criteria, 'Les critères')),
      efficacy: cleanText(body?.efficacy, 120, "L'efficacité"),
      duration: cleanText(body?.duration, 120, 'La durée'),
      protects_sti: body?.protects_sti === true || body?.protects_sti === 1 || body?.protects_sti === '1' ? 1 : 0,
      image_url: image,
      image_credit: cleanText(body?.image_credit, 300, "Le crédit de l'image"),
      sort_order: Number.isInteger(Number(body?.sort_order)) ? Number(body.sort_order) : 0,
    };
  }

  async createMethod(body: any) {
    const m = this.parseMethod(body);
    const slug = slugify(body?.slug || m.name);
    if (!slug) throw new BadRequestException('Nom invalide.');
    const cols = Object.keys(m);
    try {
      const [res]: any = await this.pool.query(
        `INSERT INTO contraceptive_methods (slug, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
        [slug, ...cols.map((k) => (m as any)[k])],
      );
      return { success: true, id: Number(res.insertId), message: 'Contraceptif ajouté.' };
    } catch (e: any) {
      if (e?.code === 'ER_DUP_ENTRY') throw new ConflictException('Une fiche existe déjà avec ce nom.');
      throw e;
    }
  }

  async updateMethod(id: number, body: any) {
    const m = this.parseMethod(body);
    const cols = Object.keys(m);
    const [res]: any = await this.pool.query(`UPDATE contraceptive_methods SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [
      ...cols.map((k) => (m as any)[k]),
      id,
    ]);
    if (!res?.affectedRows) throw new NotFoundException('Contraceptif introuvable.');
    return { success: true, message: 'Fiche mise à jour.' };
  }

  async setMethodActive(id: number, active: boolean) {
    const [res]: any = await this.pool.query(`UPDATE contraceptive_methods SET is_active = ? WHERE id = ?`, [active ? 1 : 0, id]);
    if (!res?.affectedRows) throw new NotFoundException('Contraceptif introuvable.');
    return { success: true, message: active ? 'Fiche visible sur le site.' : 'Fiche masquée du site. Les demandes en cours continuent.' };
  }

  // =====================================================================
  // Demandes (jeune)
  // =====================================================================

  private async youth(userId: number) {
    const [[u]]: any = await this.pool.query(`SELECT id, name, email, role FROM users WHERE id = ? LIMIT 1`, [userId]);
    if (!u) throw new ForbiddenException('Compte introuvable.');
    if (u.role !== 'customer') throw new ForbiddenException('Les demandes se font avec un compte jeune (client) E.doto family.');
    return u;
  }

  /** Étape 1 : le jeune demande à adopter une méthode */
  async createRequest(userId: number, body: any) {
    await this.youth(userId);
    const methodId = Number(body?.method_id);
    if (!Number.isInteger(methodId) || methodId <= 0) throw new BadRequestException('Choisissez un contraceptif.');
    const [[m]]: any = await this.pool.query(`SELECT id, name, requires_doctor FROM contraceptive_methods WHERE id = ? AND is_active = 1`, [methodId]);
    if (!m) throw new NotFoundException('Contraceptif introuvable.');
    const note = cleanText(body?.note, 600, 'Votre message');
    const marks = OPEN_STATUSES.map(() => '?').join(',');
    const [[{ same }]]: any = await this.pool.query(
      `SELECT COUNT(*) AS same FROM contraception_requests WHERE user_id = ? AND method_id = ? AND status IN (${marks})`,
      [userId, methodId, ...OPEN_STATUSES],
    );
    const [[{ open }]]: any = await this.pool.query(`SELECT COUNT(*) AS open FROM contraception_requests WHERE user_id = ? AND status IN (${marks})`, [
      userId,
      ...OPEN_STATUSES,
    ]);
    if (num(same)) throw new ConflictException('Vous avez déjà une demande en cours pour ce contraceptif : suivez-la dans votre dashboard.');
    if (num(open) >= MAX_OPEN_REQUESTS) throw new BadRequestException(`Vous avez déjà ${MAX_OPEN_REQUESTS} demandes en cours.`);
    const [res]: any = await this.pool.query(
      `INSERT INTO contraception_requests (user_id, method_id, requires_doctor, status, youth_note) VALUES (?, ?, ?, 'pending', ?)`,
      [userId, methodId, Number(m.requires_doctor) === 1 ? 1 : 0, note],
    );
    return { success: true, id: Number(res.insertId), message: 'Demande envoyée. Vous serez prévenu(e) dès qu’elle est acceptée.' };
  }

  private async requestRows(where: string, params: any[], extra = '') {
    const [rows]: any = await this.pool.query(
      `SELECT r.*, ${iso('r.created_at')}, ${iso('r.accepted_at')}, ${iso('r.refused_at')}, ${iso('r.concluded_at')}, ${iso('r.outcome_at')}, ${iso('r.cancelled_at')},
              m.name AS method_name, m.slug AS method_slug, m.image_url AS method_image, m.family AS method_family,
              u.name AS user_name, u.email AS user_email,
              a.reference AS appointment_reference, a.mode AS appointment_mode, a.status AS appointment_status, a.room AS appointment_room,
              ${iso('a.starts_at', 'appointment_starts_at')}, d.name AS doctor_name,
              f.token AS referral_token, f.short_code AS referral_code, f.status AS referral_status, ${iso('f.viewed_at', 'referral_viewed_at')},
              ${iso('f.expires_at', 'referral_expires_at')},
              c.name AS center_name, c.address AS center_address, c.city AS center_city, c.phone AS center_phone, c.opening_hours AS center_hours,
              c.lat AS center_lat, c.lng AS center_lng,
              (SELECT COUNT(*) FROM contraception_followups x WHERE x.request_id = r.id) AS followups
       FROM contraception_requests r
       JOIN contraceptive_methods m ON m.id = r.method_id
       JOIN users u ON u.id = r.user_id
       LEFT JOIN tc_appointments a ON a.id = r.appointment_id
       LEFT JOIN tc_doctors d ON d.id = a.doctor_id
       LEFT JOIN tc_referrals f ON f.id = r.referral_id
       LEFT JOIN tc_centers c ON c.id = f.center_id
       WHERE ${where} ${extra}`,
      params,
    );
    return rows;
  }

  private presentRequest(r: any) {
    const status = r.status as RequestStatus;
    return {
      id: Number(r.id),
      status,
      status_label: STATUS_LABEL[status] ?? status,
      requires_doctor: Number(r.requires_doctor) === 1,
      method: { id: Number(r.method_id), name: r.method_name, slug: r.method_slug, image_url: r.method_image, family: r.method_family },
      youth_note: r.youth_note,
      admin_note: r.admin_note,
      refuse_reason: r.refuse_reason,
      created_at: r.created_at,
      accepted_at: r.accepted_at,
      refused_at: r.refused_at,
      concluded_at: r.concluded_at,
      conclusion: r.conclusion,
      conclusion_label: r.conclusion ? CONCLUSION_LABEL[r.conclusion] ?? r.conclusion : null,
      conclusion_note: r.conclusion_note,
      outcome: r.outcome,
      outcome_at: r.outcome_at,
      outcome_note: r.outcome_note,
      appointment: r.appointment_reference
        ? { reference: r.appointment_reference, mode: r.appointment_mode, status: r.appointment_status, starts_at: r.appointment_starts_at, doctor: r.doctor_name }
        : null,
      referral: r.referral_token
        ? {
            token: r.referral_token,
            short_code: String(r.referral_code || '').replace(/(.{4})(?=.)/g, '$1 '),
            status: r.referral_status,
            expires_at: r.referral_expires_at,
            qr_image: `/teleconsultation/qr/${r.referral_token}.png`,
            center: {
              name: r.center_name,
              address: r.center_address,
              city: r.center_city,
              phone: r.center_phone,
              opening_hours: r.center_hours,
              lat: r.center_lat != null ? Number(r.center_lat) : null,
              lng: r.center_lng != null ? Number(r.center_lng) : null,
            },
          }
        : null,
      followups_count: num(r.followups),
      steps: computeSteps(r),
      user: { name: r.user_name, email: r.user_email },
    };
  }

  async myRequests(userId: number) {
    const rows = await this.requestRows('r.user_id = ?', [userId], 'ORDER BY r.created_at DESC');
    const ids = rows.map((r: any) => Number(r.id));
    const follow = ids.length
      ? (
          await this.pool.query(
            `SELECT id, request_id, author_role, content, ${iso('created_at')} FROM contraception_followups
             WHERE request_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC`,
            ids,
          )
        )[0]
      : [];
    return rows.map((r: any) => {
      const { user, ...rest } = this.presentRequest(r);
      return { ...rest, followups: follow.filter((x: any) => Number(x.request_id) === Number(r.id)).map((x: any) => this.presentFollowup(x)) };
    });
  }

  async cancelRequest(userId: number, id: number) {
    const [res]: any = await this.pool.query(
      `UPDATE contraception_requests SET status = 'cancelled', cancelled_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ? AND status IN ('pending', 'accepted')`,
      [id, userId],
    );
    if (!res?.affectedRows) throw new BadRequestException('Cette demande ne peut plus être annulée (rendez-vous déjà pris ou demande terminée).');
    return { success: true, message: 'Demande annulée.' };
  }

  // ---------------- Étape 7 : rapports de suivi
  private presentFollowup(x: any) {
    return {
      id: Number(x.id),
      author_role: x.author_role,
      author_label: x.author_role === 'youth' ? 'Vous' : 'Équipe E.doto family',
      content: x.content,
      created_at: x.created_at,
    };
  }

  async addYouthFollowup(userId: number, id: number, body: any) {
    const content = cleanText(body?.content, 2000, 'Votre rapport', true) as string;
    const [[r]]: any = await this.pool.query(`SELECT id, status FROM contraception_requests WHERE id = ? AND user_id = ?`, [id, userId]);
    if (!r) throw new NotFoundException('Demande introuvable.');
    if (r.status !== 'followup') throw new BadRequestException('Le suivi commence une fois la méthode adoptée.');
    await this.pool.query(`INSERT INTO contraception_followups (request_id, author_role, author_id, content) VALUES (?, 'youth', ?, ?)`, [id, userId, content]);
    return { success: true, message: 'Rapport de suivi enregistré.' };
  }

  // =====================================================================
  // Admin : demandes
  // =====================================================================

  async adminRequests(q: any) {
    const where = ['1 = 1'];
    const params: any[] = [];
    if ((REQUEST_STATUSES as readonly string[]).includes(q?.status)) { where.push('r.status = ?'); params.push(q.status); }
    const method = Number(q?.method_id);
    if (q?.method_id && Number.isInteger(method) && method > 0) { where.push('r.method_id = ?'); params.push(method); }
    if (q?.doctor === 'yes' || q?.doctor === 'no') { where.push('r.requires_doctor = ?'); params.push(q.doctor === 'yes' ? 1 : 0); }
    const s = typeof q?.search === 'string' ? q.search.trim() : '';
    if (s) { where.push('(u.name COLLATE utf8mb4_general_ci LIKE ? OR u.email LIKE ? OR m.name COLLATE utf8mb4_general_ci LIKE ?)'); params.push(`%${s}%`, `%${s}%`, `%${s}%`); }
    const rows = await this.requestRows(where.join(' AND '), params, `ORDER BY FIELD(r.status, 'pending') DESC, r.created_at DESC LIMIT 300`);
    const [[counts], [methods]]: any = await Promise.all([
      this.pool.query(`SELECT status, COUNT(*) AS n FROM contraception_requests GROUP BY status`),
      this.pool.query(`SELECT m.id, m.name, COUNT(r.id) AS n FROM contraceptive_methods m LEFT JOIN contraception_requests r ON r.method_id = m.id GROUP BY m.id, m.name ORDER BY m.sort_order, m.name`),
    ]);
    const byStatus = new Map(counts.map((c: any) => [c.status, num(c.n)]));
    return {
      data: rows.map((r: any) => this.presentRequest(r)),
      facets: {
        total: counts.reduce((a: number, c: any) => a + num(c.n), 0),
        statuses: REQUEST_STATUSES.map((k) => ({ value: k, label: STATUS_LABEL[k], count: byStatus.get(k) ?? 0 })),
        methods: methods.map((m: any) => ({ value: String(m.id), label: m.name, count: num(m.n) })),
      },
    };
  }

  async adminRequest(id: number) {
    const [r] = await this.requestRows('r.id = ?', [id]);
    if (!r) throw new NotFoundException('Demande introuvable.');
    const [follow]: any = await this.pool.query(
      `SELECT id, request_id, author_role, content, ${iso('created_at')} FROM contraception_followups WHERE request_id = ? ORDER BY created_at DESC`,
      [id],
    );
    const [centers]: any = await this.pool.query(`SELECT id, name, city FROM tc_centers WHERE is_active = 1 ORDER BY city, name`);
    return {
      ...this.presentRequest(r),
      followups: follow.map((x: any) => ({ ...this.presentFollowup(x), author_label: x.author_role === 'youth' ? 'Le jeune' : 'Équipe E.doto family' })),
      centers: centers.map((c: any) => ({ id: Number(c.id), name: c.name, city: c.city })),
    };
  }

  /**
   * Étape 2 : acceptation par le super admin.
   * Méthode sans médecin : le centre est choisi ici, l'adoption est conclue et le code QR envoyé (étapes 3 sautée, 4 et 5).
   */
  async accept(adminId: number, id: number, body: any) {
    const note = cleanText(body?.note, 600, 'Le message au jeune');
    const [r] = await this.requestRows('r.id = ?', [id]);
    if (!r) throw new NotFoundException('Demande introuvable.');
    if (r.status !== 'pending') throw new BadRequestException('Cette demande a déjà été traitée.');
    if (Number(r.requires_doctor) === 1) {
      await this.pool.query(
        `UPDATE contraception_requests SET status = 'accepted', accepted_at = UTC_TIMESTAMP(), accepted_by = ?, admin_note = ? WHERE id = ? AND status = 'pending'`,
        [adminId, note, id],
      );
      await this.notifyYouth(
        r,
        'Votre demande de contraception est acceptée',
        `Votre demande pour <strong>${esc(r.method_name)}</strong> est acceptée. Prochaine étape : une rencontre avec un médecin, en visio ou par téléphone, pour choisir ensemble en toute sécurité.`,
        note,
        'Prendre rendez-vous',
      );
      return { success: true, message: 'Demande acceptée : le jeune est invité à prendre rendez-vous avec un médecin.' };
    }
    const centerId = Number(body?.center_id);
    if (!Number.isInteger(centerId) || centerId <= 0) throw new BadRequestException('Choisissez le centre où le jeune ira.');
    const [[c]]: any = await this.pool.query(`SELECT id FROM tc_centers WHERE id = ? AND is_active = 1`, [centerId]);
    if (!c) throw new BadRequestException('Centre inconnu ou inactif.');
    const [upd]: any = await this.pool.query(
      `UPDATE contraception_requests SET status = 'center', accepted_at = UTC_TIMESTAMP(), accepted_by = ?, admin_note = ?,
         concluded_at = UTC_TIMESTAMP(), conclusion = 'adopt' WHERE id = ? AND status = 'pending'`,
      [adminId, note, id],
    );
    if (!upd?.affectedRows) throw new BadRequestException('Cette demande a déjà été traitée.');
    const referral = await this.tc.createReferral({
      reportId: null,
      appointmentId: null,
      patientUserId: Number(r.user_id),
      patientName: r.user_name,
      patientEmail: r.user_email,
      patientPhone: null,
      mode: null,
      centerId,
      summary: note,
      doctorName: 'E.doto family',
      contraceptionRequestId: id,
      intro: `Votre demande pour ${r.method_name} est acceptée. Rendez-vous au centre ci-dessous pour l'obtenir.`,
    });
    await this.pool.query(`UPDATE contraception_requests SET referral_id = ? WHERE id = ?`, [referral.id, id]);
    return { success: true, message: `Demande acceptée : code QR envoyé au jeune (code ${referral.short_code}).` };
  }

  async refuse(adminId: number, id: number, body: any) {
    const reason = cleanText(body?.reason, 600, 'Le motif', true);
    const [r] = await this.requestRows('r.id = ?', [id]);
    if (!r) throw new NotFoundException('Demande introuvable.');
    const [res]: any = await this.pool.query(
      `UPDATE contraception_requests SET status = 'refused', refused_at = UTC_TIMESTAMP(), refuse_reason = ?, accepted_by = ? WHERE id = ? AND status = 'pending'`,
      [reason, adminId, id],
    );
    if (!res?.affectedRows) throw new BadRequestException('Cette demande a déjà été traitée.');
    await this.notifyYouth(r, 'Votre demande de contraception', `Votre demande pour <strong>${esc(r.method_name)}</strong> n'a pas pu être acceptée.`, reason, 'Voir mon dashboard');
    return { success: true, message: 'Demande refusée : le jeune est prévenu.' };
  }

  async addAdminFollowup(adminId: number, id: number, body: any) {
    const content = cleanText(body?.content, 2000, 'Le rapport', true) as string;
    const [[r]]: any = await this.pool.query(`SELECT id FROM contraception_requests WHERE id = ?`, [id]);
    if (!r) throw new NotFoundException('Demande introuvable.');
    await this.pool.query(`INSERT INTO contraception_followups (request_id, author_role, author_id, content) VALUES (?, 'admin', ?, ?)`, [id, adminId, content]);
    return { success: true, message: 'Rapport de suivi ajouté.' };
  }

  async summary() {
    const [[s]]: any = await this.pool.query(
      `SELECT COUNT(*) AS total, SUM(status = 'pending') AS pending, SUM(status IN ('accepted','meeting','center')) AS in_progress,
              SUM(status = 'followup') AS adopted FROM contraception_requests`,
    );
    return { total: num(s?.total), pending: num(s?.pending), in_progress: num(s?.in_progress), adopted: num(s?.adopted) };
  }

  private async notifyYouth(r: any, subject: string, html: string, note: string | null, cta: string) {
    try {
      await mail(
        r.user_email,
        subject,
        frame(
          'CONTRACEPTION',
          `<p>Bonjour <strong>${esc(r.user_name)}</strong>,</p><p>${html}</p>
           ${note ? `<div style="margin:16px 0;padding:16px;border:1px solid #E9E5DF;border-radius:12px;background:#F9F8F6;"><p style="margin:0;white-space:pre-line;">${esc(note)}</p></div>` : ''}
           ${button(`${siteUrl()}/mon-espace#contraception`, cta)}
           <p style="font-size:13px;color:#57524B;margin-top:18px;">Vous suivez chaque étape dans votre dashboard, en toute confidentialité.</p>`,
        ),
      );
    } catch (e: any) {
      console.error('[contraception] e-mail au jeune :', e?.message);
    }
  }
}
