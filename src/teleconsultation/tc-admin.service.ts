import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { cleanEmail, cleanName, cleanOrgName, cleanPhone } from '../common/field-rules';
import {
  APPOINTMENT_STATUS_LABEL,
  MODE_LABEL,
  Mode,
  ORGANIZATION_LABEL,
  REFERRAL_STATUS_LABEL,
  REQUEST_TYPES,
  URGENCY_LABEL,
  cleanSlotMinutes,
  cleanText,
  formatShortCode,
  isDay,
} from './tc-rules';
import { cancellationEmail, mail } from './tc-notify';
import { iso, num, utcSql } from './tc-db';

// Super admin : médecins, centres, rendez-vous et orientations, avec filtres réels et compteurs.
const accountStatus = (r: any) => (r.activated_at ? 'active' : r.invited_at ? 'invited' : 'not_invited');
const ACCOUNT_LABEL: Record<string, string> = { not_invited: 'Non invité', invited: 'Invité', active: 'Espace actif' };
const dayStartUtc = (d: string) => utcSql(new Date(Date.parse(`${d}T00:00:00Z`) - 3600000));
const dayEndUtc = (d: string) => utcSql(new Date(Date.parse(`${d}T00:00:00Z`) + 23 * 3600000));

@Injectable()
export class TcAdminService {
  constructor(private readonly db: DatabaseService) {}

  private get pool(): any {
    return this.db.getPool();
  }

  // ---------------- Médecins ----------------
  private parseDoctor(body: any) {
    return {
      name: cleanName(body?.name, 'Le nom du médecin'),
      email: cleanEmail(body?.email),
      phone: cleanPhone(body?.phone, { required: false }),
      title: cleanText(body?.title, 120, 'La fonction'),
      bio: cleanText(body?.bio, 600, 'La présentation'),
      slot_minutes: body?.slot_minutes !== undefined && body?.slot_minutes !== '' ? cleanSlotMinutes(body.slot_minutes) : 30,
      // Médecin E.doto family : prend en charge les heures où aucun autre médecin n'est libre (un seul à la fois)
      is_house: body?.is_house === true || body?.is_house === 1 || body?.is_house === '1' ? 1 : 0,
    };
  }

  /** Un seul médecin E.doto family : le choisir retire ce rôle aux autres */
  private async keepSingleHouse(id: number, isHouse: number) {
    if (isHouse) await this.pool.query(`UPDATE tc_doctors SET is_house = 0 WHERE id <> ? AND is_house = 1`, [id]);
  }

  async doctors() {
    const [rows]: any = await this.pool.query(
      `SELECT d.*, ${iso('d.invited_at')}, ${iso('d.activated_at')},
              (SELECT COUNT(*) FROM tc_availability av WHERE av.doctor_id = d.id) AS rules_count,
              (SELECT COUNT(*) FROM tc_appointments a WHERE a.doctor_id = d.id AND a.status = 'booked' AND a.ends_at > UTC_TIMESTAMP()) AS upcoming,
              (SELECT COUNT(*) FROM tc_appointments a WHERE a.doctor_id = d.id AND a.status = 'completed') AS completed
       FROM tc_doctors d ORDER BY d.is_house DESC, d.name`,
    );
    return rows.map((r: any) => ({
      id: Number(r.id),
      name: r.name,
      email: r.email,
      phone: r.phone,
      title: r.title,
      bio: r.bio,
      slot_minutes: Number(r.slot_minutes),
      is_house: Number(r.is_house) === 1,
      is_active: Number(r.is_active) === 1,
      account_status: accountStatus(r),
      account_label: ACCOUNT_LABEL[accountStatus(r)],
      invited_at: r.invited_at,
      activated_at: r.activated_at,
      has_schedule: num(r.rules_count) > 0,
      upcoming: num(r.upcoming),
      completed: num(r.completed),
    }));
  }

  async createDoctor(body: any) {
    const d = this.parseDoctor(body);
    try {
      const [res]: any = await this.pool.query(
        `INSERT INTO tc_doctors (name, email, phone, title, bio, slot_minutes, is_house) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [d.name, d.email, d.phone, d.title, d.bio, d.slot_minutes, d.is_house],
      );
      await this.keepSingleHouse(Number(res.insertId), d.is_house);
      return { success: true, id: Number(res.insertId), message: 'Médecin ajouté. Envoyez-lui son invitation pour activer son espace.' };
    } catch (e: any) {
      if (e?.code === 'ER_DUP_ENTRY') throw new ConflictException('Un médecin existe déjà avec cette adresse e-mail.');
      throw e;
    }
  }

  async updateDoctor(id: number, body: any) {
    const [[cur]]: any = await this.pool.query(`SELECT id, email, activated_at FROM tc_doctors WHERE id = ?`, [id]);
    if (!cur) throw new NotFoundException('Médecin introuvable.');
    const d = this.parseDoctor(body);
    if (cur.activated_at && d.email !== cur.email) throw new BadRequestException("L'adresse e-mail d'un espace actif ne se change pas ici.");
    await this.pool.query(`UPDATE tc_doctors SET name = ?, email = ?, phone = ?, title = ?, bio = ?, slot_minutes = ?, is_house = ? WHERE id = ?`, [
      d.name,
      d.email,
      d.phone,
      d.title,
      d.bio,
      d.slot_minutes,
      d.is_house,
      id,
    ]);
    await this.keepSingleHouse(id, d.is_house);
    return { success: true, message: 'Fiche du médecin mise à jour.' };
  }

  async setDoctorActive(id: number, active: boolean) {
    const [res]: any = await this.pool.query(`UPDATE tc_doctors SET is_active = ? WHERE id = ?`, [active ? 1 : 0, id]);
    if (!res?.affectedRows) throw new NotFoundException('Médecin introuvable.');
    return { success: true, message: active ? 'Médecin réactivé : ses créneaux sont de nouveau proposés.' : 'Médecin désactivé : plus aucun créneau proposé. Les rendez-vous déjà pris restent.' };
  }

  // ---------------- Centres ----------------
  private parseCenter(body: any) {
    const lat = body?.lat === '' || body?.lat == null ? null : Number(body.lat);
    const lng = body?.lng === '' || body?.lng == null ? null : Number(body.lng);
    if ((lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) || (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180))) {
      throw new BadRequestException('Position GPS invalide.');
    }
    return {
      name: cleanOrgName(body?.name, 'Le nom du centre'),
      organization: Object.keys(ORGANIZATION_LABEL).includes(body?.organization) ? body.organization : 'other',
      email: cleanEmail(body?.email),
      phone: cleanPhone(body?.phone, { required: false }),
      city: cleanText(body?.city, 100, 'La ville', true),
      address: cleanText(body?.address, 255, "L'adresse"),
      services: cleanText(body?.services, 600, 'Les services'),
      opening_hours: cleanText(body?.opening_hours, 200, 'Les horaires'),
      lat,
      lng,
    };
  }

  async centers() {
    const [rows]: any = await this.pool.query(
      `SELECT c.*, ${iso('c.invited_at')}, ${iso('c.activated_at')},
              (SELECT COUNT(*) FROM tc_referrals f WHERE f.center_id = c.id) AS referrals,
              (SELECT COUNT(*) FROM tc_referrals f WHERE f.center_id = c.id AND f.status = 'completed') AS completed
       FROM tc_centers c ORDER BY c.city, c.name`,
    );
    return rows.map((r: any) => ({
      id: Number(r.id),
      name: r.name,
      organization: r.organization,
      organization_label: ORGANIZATION_LABEL[r.organization] ?? r.organization,
      email: r.email,
      phone: r.phone,
      city: r.city,
      address: r.address,
      services: r.services,
      opening_hours: r.opening_hours,
      lat: r.lat != null ? Number(r.lat) : null,
      lng: r.lng != null ? Number(r.lng) : null,
      is_active: Number(r.is_active) === 1,
      account_status: accountStatus(r),
      account_label: ACCOUNT_LABEL[accountStatus(r)],
      referrals: num(r.referrals),
      completed: num(r.completed),
    }));
  }

  async createCenter(body: any) {
    const c = this.parseCenter(body);
    try {
      const [res]: any = await this.pool.query(
        `INSERT INTO tc_centers (name, organization, email, phone, city, address, services, opening_hours, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [c.name, c.organization, c.email, c.phone, c.city, c.address, c.services, c.opening_hours, c.lat, c.lng],
      );
      return { success: true, id: Number(res.insertId), message: 'Centre ajouté. Envoyez son invitation pour activer son espace.' };
    } catch (e: any) {
      if (e?.code === 'ER_DUP_ENTRY') throw new ConflictException('Un centre existe déjà avec cette adresse e-mail.');
      throw e;
    }
  }

  async updateCenter(id: number, body: any) {
    const [[cur]]: any = await this.pool.query(`SELECT id, email, activated_at FROM tc_centers WHERE id = ?`, [id]);
    if (!cur) throw new NotFoundException('Centre introuvable.');
    const c = this.parseCenter(body);
    if (cur.activated_at && c.email !== cur.email) throw new BadRequestException("L'adresse e-mail d'un espace actif ne se change pas ici.");
    await this.pool.query(
      `UPDATE tc_centers SET name = ?, organization = ?, email = ?, phone = ?, city = ?, address = ?, services = ?, opening_hours = ?, lat = ?, lng = ? WHERE id = ?`,
      [c.name, c.organization, c.email, c.phone, c.city, c.address, c.services, c.opening_hours, c.lat, c.lng, id],
    );
    return { success: true, message: 'Fiche du centre mise à jour.' };
  }

  async setCenterActive(id: number, active: boolean) {
    const [res]: any = await this.pool.query(`UPDATE tc_centers SET is_active = ? WHERE id = ?`, [active ? 1 : 0, id]);
    if (!res?.affectedRows) throw new NotFoundException('Centre introuvable.');
    return { success: true, message: active ? 'Centre réactivé.' : 'Centre désactivé : les médecins ne peuvent plus le recommander.' };
  }

  // ---------------- Rendez-vous ----------------
  private appointmentFilters(q: any) {
    const where = ['1 = 1'];
    const params: any[] = [];
    if (['booked', 'completed', 'cancelled', 'no_show'].includes(q?.status)) { where.push('a.status = ?'); params.push(q.status); }
    if (q?.mode === 'video' || q?.mode === 'phone') { where.push('a.mode = ?'); params.push(q.mode); }
    const doc = Number(q?.doctor_id);
    if (q?.doctor_id && Number.isInteger(doc) && doc > 0) { where.push('a.doctor_id = ?'); params.push(doc); }
    if (isDay(q?.date_from)) { where.push('a.starts_at >= ?'); params.push(dayStartUtc(q.date_from)); }
    if (isDay(q?.date_to)) { where.push('a.starts_at < ?'); params.push(dayEndUtc(q.date_to)); }
    if (q?.reminder === 'failed') where.push('a.reminder_error IS NOT NULL');
    const s = typeof q?.search === 'string' ? q.search.trim() : '';
    if (s) {
      where.push('(a.reference LIKE ? OR a.patient_name COLLATE utf8mb4_general_ci LIKE ? OR a.patient_email LIKE ? OR a.patient_phone LIKE ?)');
      params.push(`%${s}%`, `%${s}%`, `%${s}%`, `%${s}%`);
    }
    return { where: where.join(' AND '), params };
  }

  async appointments(q: any) {
    const { where, params } = this.appointmentFilters(q);
    const page = Math.max(1, Number(q?.page) || 1);
    const limit = 20;
    const order = q?.sort === 'asc' ? 'ASC' : 'DESC';
    const [[rows], [[c]]]: any = await Promise.all([
      this.pool.query(
        `SELECT a.id, a.reference, a.mode, a.status, a.patient_name, a.patient_email, a.patient_phone, a.reminder_error, a.cancel_reason, a.cancelled_by,
                ${iso('a.starts_at')}, ${iso('a.ends_at')}, ${iso('a.reminder_email_at')}, ${iso('a.reminder_sms_at')},
                d.name AS doctor_name, r.finalized_at, r.request_type, f.short_code, f.status AS referral_status, cc.name AS center_name
         FROM tc_appointments a JOIN tc_doctors d ON d.id = a.doctor_id
         LEFT JOIN tc_reports r ON r.appointment_id = a.id
         LEFT JOIN tc_referrals f ON f.report_id = r.id
         LEFT JOIN tc_centers cc ON cc.id = f.center_id
         WHERE ${where} ORDER BY a.starts_at ${order}, a.id DESC LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit],
      ),
      this.pool.query(`SELECT COUNT(*) AS n FROM tc_appointments a WHERE ${where}`, params),
    ]);
    return {
      data: rows.map((a: any) => ({
        ...a,
        id: Number(a.id),
        mode_label: MODE_LABEL[a.mode as Mode] ?? a.mode,
        status_label: APPOINTMENT_STATUS_LABEL[a.status] ?? a.status,
        report_done: Boolean(a.finalized_at),
        request_label: a.request_type ? REQUEST_TYPES[a.request_type] ?? a.request_type : null,
        short_code: a.short_code ? formatShortCode(a.short_code) : null,
      })),
      total: num(c?.n),
      page,
      last_page: Math.max(1, Math.ceil(num(c?.n) / limit)),
    };
  }

  async appointmentFacets(q: any) {
    const base = this.appointmentFilters({ ...q, status: undefined });
    const [[st], [md], [doc], [[rg]]]: any = await Promise.all([
      this.pool.query(`SELECT a.status AS v, COUNT(*) AS n FROM tc_appointments a WHERE ${base.where} GROUP BY a.status`, base.params),
      this.pool.query(`SELECT a.mode AS v, COUNT(*) AS n FROM tc_appointments a WHERE ${this.appointmentFilters(q).where} GROUP BY a.mode`, this.appointmentFilters(q).params),
      this.pool.query(
        `SELECT d.id, d.name, COUNT(a.id) AS n FROM tc_doctors d LEFT JOIN tc_appointments a ON a.doctor_id = d.id GROUP BY d.id, d.name ORDER BY d.name`,
      ),
      this.pool.query(`SELECT COUNT(*) AS total, SUM(a.reminder_error IS NOT NULL) AS failed FROM tc_appointments a WHERE ${base.where}`, base.params),
    ]);
    return {
      total: num(rg?.total),
      statuses: st.map((r: any) => ({ value: r.v, label: APPOINTMENT_STATUS_LABEL[r.v] ?? r.v, count: num(r.n) })),
      modes: md.map((r: any) => ({ value: r.v, label: MODE_LABEL[r.v as Mode] ?? r.v, count: num(r.n) })),
      doctors: doc.map((r: any) => ({ value: String(r.id), label: r.name, count: num(r.n) })),
      reminder_failed: num(rg?.failed),
    };
  }

  async cancelAppointment(id: number, body: any) {
    const reason = cleanText(body?.reason, 300, 'Le motif', true);
    const [[a]]: any = await this.pool.query(
      `SELECT a.*, ${iso('a.starts_at')}, d.name AS doctor_name, d.title AS doctor_title, d.email AS doctor_email
       FROM tc_appointments a JOIN tc_doctors d ON d.id = a.doctor_id WHERE a.id = ?`,
      [id],
    );
    if (!a) throw new NotFoundException('Rendez-vous introuvable.');
    if (a.status !== 'booked') throw new BadRequestException('Ce rendez-vous n’est plus actif.');
    await this.pool.query(
      `UPDATE tc_appointments SET status = 'cancelled', slot_lock = NULL, cancelled_at = UTC_TIMESTAMP(), cancelled_by = 'admin', cancel_reason = ? WHERE id = ? AND status = 'booked'`,
      [reason, id],
    );
    const m = { reference: a.reference, mode: a.mode, starts_at: a.starts_at, patient_name: a.patient_name, doctor_name: a.doctor_name, room: a.room };
    mail(a.patient_email, `Rendez-vous annulé : ${a.reference}`, cancellationEmail(m, false, reason)).catch(() => undefined);
    mail(a.doctor_email, `Rendez-vous annulé : ${a.reference}`, cancellationEmail(m, true, reason)).catch(() => undefined);
    return { success: true, message: 'Rendez-vous annulé : le jeune et le médecin sont prévenus par e-mail.' };
  }

  // ---------------- Orientations ----------------
  private referralFilters(q: any) {
    const where = ['1 = 1'];
    const params: any[] = [];
    if (q?.status === 'expired') where.push("f.status IN ('issued','viewed') AND f.expires_at <= UTC_TIMESTAMP()");
    else if (['issued', 'viewed'].includes(q?.status)) { where.push('f.status = ? AND f.expires_at > UTC_TIMESTAMP()'); params.push(q.status); }
    else if (q?.status === 'completed') where.push("f.status = 'completed'");
    const center = Number(q?.center_id);
    if (q?.center_id && Number.isInteger(center) && center > 0) { where.push('f.center_id = ?'); params.push(center); }
    if (Object.keys(REQUEST_TYPES).includes(q?.request_type)) { where.push('r.request_type = ?'); params.push(q.request_type); }
    if (Object.keys(URGENCY_LABEL).includes(q?.urgency)) { where.push('r.urgency = ?'); params.push(q.urgency); }
    if (isDay(q?.date_from)) { where.push('f.created_at >= ?'); params.push(dayStartUtc(q.date_from)); }
    if (isDay(q?.date_to)) { where.push('f.created_at < ?'); params.push(dayEndUtc(q.date_to)); }
    const s = typeof q?.search === 'string' ? q.search.trim() : '';
    if (s) {
      where.push('(f.short_code = ? OR a.reference LIKE ? OR a.patient_name COLLATE utf8mb4_general_ci LIKE ?)');
      params.push(s.toUpperCase().replace(/[^A-Z0-9]/g, ''), `%${s}%`, `%${s}%`);
    }
    return { where: where.join(' AND '), params };
  }

  async referrals(q: any) {
    const { where, params } = this.referralFilters(q);
    const page = Math.max(1, Number(q?.page) || 1);
    const limit = 20;
    const from = `FROM tc_referrals f JOIN tc_reports r ON r.id = f.report_id JOIN tc_appointments a ON a.id = f.appointment_id
                  JOIN tc_doctors d ON d.id = a.doctor_id JOIN tc_centers c ON c.id = f.center_id`;
    const [[rows], [[cnt]]]: any = await Promise.all([
      this.pool.query(
        `SELECT f.id, f.short_code, f.status, (f.expires_at <= UTC_TIMESTAMP()) AS is_expired, ${iso('f.created_at')}, ${iso('f.expires_at')},
                ${iso('f.viewed_at')}, ${iso('f.completed_at')}, f.sent_email_at, f.sent_sms_at,
                r.request_type, r.urgency, a.reference, a.patient_name, a.mode, d.name AS doctor_name, c.name AS center_name, c.city AS center_city
         ${from} WHERE ${where} ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit],
      ),
      this.pool.query(`SELECT COUNT(*) AS n ${from} WHERE ${where}`, params),
    ]);
    return {
      data: rows.map((f: any) => {
        const status = (f.status === 'issued' || f.status === 'viewed') && Number(f.is_expired) === 1 ? 'expired' : f.status;
        return {
          ...f,
          id: Number(f.id),
          short_code: formatShortCode(f.short_code),
          status,
          status_label: REFERRAL_STATUS_LABEL[status] ?? status,
          request_label: REQUEST_TYPES[f.request_type] ?? f.request_type,
          urgency_label: URGENCY_LABEL[f.urgency] ?? f.urgency,
          mode_label: MODE_LABEL[f.mode as Mode] ?? f.mode,
          email_sent: Boolean(f.sent_email_at),
          sms_sent: Boolean(f.sent_sms_at),
        };
      }),
      total: num(cnt?.n),
      page,
      last_page: Math.max(1, Math.ceil(num(cnt?.n) / limit)),
    };
  }

  async referralFacets() {
    const [[[s]], [centers], [types]]: any = await Promise.all([
      this.pool.query(
        `SELECT COUNT(*) AS total,
                SUM(status = 'issued' AND expires_at > UTC_TIMESTAMP()) AS issued,
                SUM(status = 'viewed' AND expires_at > UTC_TIMESTAMP()) AS viewed,
                SUM(status = 'completed') AS completed,
                SUM(status IN ('issued','viewed') AND expires_at <= UTC_TIMESTAMP()) AS expired
         FROM tc_referrals`,
      ),
      this.pool.query(`SELECT c.id, c.name, COUNT(f.id) AS n FROM tc_centers c LEFT JOIN tc_referrals f ON f.center_id = c.id GROUP BY c.id, c.name ORDER BY c.name`),
      this.pool.query(`SELECT r.request_type AS v, COUNT(*) AS n FROM tc_referrals f JOIN tc_reports r ON r.id = f.report_id GROUP BY r.request_type`),
    ]);
    return {
      total: num(s?.total),
      statuses: ['issued', 'viewed', 'completed', 'expired'].map((k) => ({ value: k, label: REFERRAL_STATUS_LABEL[k], count: num(s?.[k]) })),
      centers: centers.map((c: any) => ({ value: String(c.id), label: c.name, count: num(c.n) })),
      request_types: types.map((t: any) => ({ value: t.v, label: REQUEST_TYPES[t.v] ?? t.v, count: num(t.n) })),
      urgency: Object.entries(URGENCY_LABEL).map(([value, label]) => ({ value, label })),
    };
  }

  /** Tableau de bord (accueil de la section) */
  async summary() {
    const [[[a]], [[d]], [[c]], [[f]]]: any = await Promise.all([
      this.pool.query(
        `SELECT SUM(status = 'booked' AND ends_at > UTC_TIMESTAMP()) AS upcoming, SUM(status = 'completed') AS completed,
                SUM(status = 'cancelled') AS cancelled, SUM(status = 'no_show') AS no_show, SUM(mode = 'video') AS video, SUM(mode = 'phone') AS phone
         FROM tc_appointments`,
      ),
      this.pool.query(`SELECT COUNT(*) AS total, SUM(is_active = 1 AND activated_at IS NOT NULL) AS active FROM tc_doctors`),
      this.pool.query(`SELECT COUNT(*) AS total, SUM(is_active = 1 AND activated_at IS NOT NULL) AS active FROM tc_centers`),
      this.pool.query(`SELECT COUNT(*) AS total, SUM(status = 'completed') AS completed FROM tc_referrals`),
    ]);
    return {
      appointments: { upcoming: num(a?.upcoming), completed: num(a?.completed), cancelled: num(a?.cancelled), no_show: num(a?.no_show), video: num(a?.video), phone: num(a?.phone) },
      doctors: { total: num(d?.total), active: num(d?.active) },
      centers: { total: num(c?.total), active: num(c?.active) },
      referrals: { total: num(f?.total), completed: num(f?.completed) },
    };
  }
}
