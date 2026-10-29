import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../database/database.services';
import { ageOn, checkPassword, cleanPhone } from '../common/field-rules';
import { HEALTH_FIELDS, openFields, openHealth, sealHealth } from '../common/health-crypto';
import { logHealthAccess } from '../common/health-access';
import {
  APPOINTMENT_STATUS_LABEL,
  BOOKING_WINDOW_DAYS,
  DEFAULT_SLOT_MINUTES,
  INVITATION_TTL_DAYS,
  MODE_LABEL,
  Mode,
  ORGANIZATION_LABEL,
  REFERRAL_STATUS_LABEL,
  REFERRAL_TTL_DAYS,
  REQUEST_TYPES,
  URGENCY_LABEL,
  addDays,
  beninDayOf,
  cleanAvailability,
  cleanSlotMinutes,
  cleanText,
  formatShortCode,
  freeSlots,
  HOUSE_HOURS_LABEL,
  HOUSE_NAME,
  HOUSE_PLACEHOLDER_EMAIL,
  HOUSE_RULES,
  HOUSE_SLOT_MINUTES,
  HOUSE_TITLE,
  houseGaps,
  isDay,
  jitsiUrl,
  newInvitationToken,
  newJitsiRoom,
  newReference,
  newReferralToken,
  newShortCode,
  normalizeShortCode,
  parseMode,
  sha256,
} from './tc-rules';
import {
  ApptMail,
  bookingConfirmationEmail,
  cancellationEmail,
  doctorNewBookingEmail,
  invitationEmail,
  mail,
  referralEmail,
  referralSms,
  sendSms,
  siteUrl,
} from './tc-notify';
import { iso, num, utcSql } from './tc-db';
import { bumpTokenVersion } from '../auth/session';
import { CONCLUSIONS, CONCLUSION_LABEL } from '../contraception/contraception-rules';

const MAX_UPCOMING_PER_PATIENT = 2; // rendez-vous à venir par jeune (évite les réservations en série)

@Injectable()
export class TeleconsultationService {
  constructor(private readonly db: DatabaseService) {}

  private get pool(): any {
    return this.db.getPool();
  }

  // =====================================================================
  // Réservation (jeune connecté)
  // =====================================================================

  /**
   * Médecin E.doto family toujours présent (20/10/2026) : créé ici s'il n'existe pas, actif tout de suite,
   * sans invitation. Ses rendez-vous sont visibles dans l'admin ; le compte médecin les reçoit une fois invité.
   */
  private houseReady = false;
  async ensureHouseDoctor() {
    if (this.houseReady) return;
    try {
      await this.pool.query(
        `INSERT INTO tc_doctors (name, email, title, slot_minutes, is_house, is_active)
         SELECT ?, ?, ?, ?, 1, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tc_doctors WHERE is_house = 1)`,
        [HOUSE_NAME, HOUSE_PLACEHOLDER_EMAIL, HOUSE_TITLE, HOUSE_SLOT_MINUTES],
      );
      this.houseReady = true;
    } catch (e: any) {
      console.error('[téléconsultation] médecin E.doto family :', e?.message);
    }
  }

  /**
   * Médecins réservables : fiche active et compte activé ;
   * le médecin E.doto family est réservable dès que sa fiche est active, même sans compte activé.
   */
  private async bookableDoctors() {
    await this.ensureHouseDoctor();
    const [rows]: any = await this.pool.query(
      `SELECT d.id, d.name, d.title, d.bio, d.slot_minutes, d.is_house FROM tc_doctors d
       LEFT JOIN users u ON u.id = d.user_id
       WHERE d.is_active = 1
         AND (d.is_house = 1 OR (d.activated_at IS NOT NULL AND u.role = 'doctor' AND u.is_active = 1))`,
    );
    // Médecin E.doto family : consultations de 30 minutes, quelle que soit sa fiche
    return (rows as { id: number; name: string; title: string | null; bio: string | null; slot_minutes: number; is_house: number }[]).map((d) =>
      Number(d.is_house) === 1 ? { ...d, slot_minutes: HOUSE_SLOT_MINUTES } : d,
    );
  }

  /** Créneaux libres de chaque médecin réservable sur une période (jours du Bénin) */
  private async slotsByDoctor(fromDay: string, toDay: string, mode: Mode | null, onlyDoctorIds?: number[]) {
    let doctors = await this.bookableDoctors();
    if (onlyDoctorIds) doctors = doctors.filter((d) => onlyDoctorIds.includes(Number(d.id)));
    if (!doctors.length) return [];
    const ids = doctors.map((d) => Number(d.id));
    const marks = ids.map(() => '?').join(',');
    const from = new Date(Date.parse(`${fromDay}T00:00:00Z`) - 86400000);
    const to = new Date(Date.parse(`${toDay}T00:00:00Z`) + 2 * 86400000);
    const [[rules], [offs], [busy]]: any = await Promise.all([
      this.pool.query(`SELECT doctor_id, weekday, start_time, end_time, modes FROM tc_availability WHERE doctor_id IN (${marks})`, ids),
      this.pool.query(
        `SELECT doctor_id, DATE_FORMAT(date_from, '%Y-%m-%d') AS date_from, DATE_FORMAT(date_to, '%Y-%m-%d') AS date_to
         FROM tc_time_off WHERE doctor_id IN (${marks}) AND date_to >= ? AND date_from <= ?`,
        [...ids, fromDay, toDay],
      ),
      this.pool.query(
        `SELECT doctor_id, ${iso('starts_at')}, ${iso('ends_at')} FROM tc_appointments
         WHERE doctor_id IN (${marks}) AND slot_lock = 1 AND starts_at < ? AND ends_at > ?`,
        [...ids, utcSql(to), utcSql(from)],
      ),
    ]);
    const per = doctors.map((d) => ({
      doctor: d,
      slots: freeSlots({
        // Médecin E.doto family : lundi à vendredi, 8 h à 18 h (heures fixes)
        rules:
          Number(d.is_house) === 1
            ? HOUSE_RULES
            : rules.filter((r: any) => Number(r.doctor_id) === Number(d.id)).map((r: any) => ({ ...r, weekday: Number(r.weekday) })),
        timeOff: offs.filter((o: any) => Number(o.doctor_id) === Number(d.id)),
        busy: busy
          .filter((b: any) => Number(b.doctor_id) === Number(d.id))
          .map((b: any) => ({ starts_at: new Date(b.starts_at), ends_at: new Date(b.ends_at) })),
        slotMinutes: Number(d.slot_minutes) || DEFAULT_SLOT_MINUTES,
        fromDay,
        toDay,
        mode,
      }),
    }));
    // Médecin E.doto family : seulement aux heures où aucun autre médecin n'est libre (20/10/2026)
    const others = per
      .filter((p) => Number(p.doctor.is_house) !== 1)
      .flatMap((p) => p.slots.map((start) => ({ start, minutes: Number(p.doctor.slot_minutes) || DEFAULT_SLOT_MINUTES })));
    for (const p of per) {
      if (Number(p.doctor.is_house) === 1) p.slots = houseGaps(p.slots, Number(p.doctor.slot_minutes) || DEFAULT_SLOT_MINUTES, others);
    }
    return per;
  }

  /**
   * Calendrier public (20/10/2026) : pour chaque jour, les médecins disponibles et leurs heures libres.
   * Le médecin E.doto family couvre les heures où aucun autre médecin n'est libre.
   */
  async availability(q: any) {
    const mode = q?.mode ? parseMode(q.mode) : null;
    const today = beninDayOf(new Date());
    const last = addDays(today, BOOKING_WINDOW_DAYS - 1);
    const fromDay = isDay(q?.from) && q.from > today ? q.from : today;
    const toDay = isDay(q?.to) && q.to < last ? q.to : last;
    const per = await this.slotsByDoctor(fromDay, toDay < fromDay ? fromDay : toDay, mode);
    const days = new Map<string, Map<number, string[]>>();
    for (const { doctor, slots } of per) {
      for (const s of slots) {
        const day = beninDayOf(s);
        if (!days.has(day)) days.set(day, new Map());
        const byDoctor = days.get(day)!;
        const id = Number(doctor.id);
        if (!byDoctor.has(id)) byDoctor.set(id, []);
        byDoctor.get(id)!.push(s.toISOString());
      }
    }
    const withSlots = per.filter((p) => p.slots.length);
    return {
      timezone: 'Africa/Porto-Novo',
      window: { from: today, to: last },
      doctors_available: withSlots.length,
      // Fiches visibles par le jeune : nom, fonction, présentation (aucune coordonnée)
      doctors: withSlots
        .map(({ doctor: d }) => ({
          id: Number(d.id),
          name: d.name,
          title: d.title,
          bio: d.bio,
          minutes: Number(d.slot_minutes) || DEFAULT_SLOT_MINUTES,
          is_house: Number(d.is_house) === 1,
        }))
        .sort((a, b) => Number(a.is_house) - Number(b.is_house) || a.name.localeCompare(b.name)),
      days: [...days.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, byDoctor]) => ({
          date,
          doctors: [...byDoctor.entries()].map(([doctor_id, starts]) => ({ doctor_id, slots: starts.sort() })),
        })),
    };
  }

  private async patient(userId: number) {
    const [[u]]: any = await this.pool.query(
      `SELECT id, name, email, role, sex, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birth_date FROM users WHERE id = ? LIMIT 1`,
      [userId],
    );
    if (!u) throw new ForbiddenException('Compte introuvable.');
    return u;
  }

  async book(userId: number, body: any) {
    const user = await this.patient(userId);
    if (user.role !== 'customer') {
      throw new ForbiddenException('Les rendez-vous se prennent avec un compte jeune (client) E.doto family.');
    }
    const mode = parseMode(body?.mode);
    const start = new Date(String(body?.starts_at ?? ''));
    if (Number.isNaN(start.getTime())) throw new BadRequestException('Choisissez un créneau.');
    const phone = mode === 'phone' ? cleanPhone(body?.phone) : cleanPhone(body?.phone, { required: false });
    let reason = cleanText(body?.reason, 300, 'Le motif');

    // Étape 3 d'une adoption de contraceptif (21/10/2026) : rencontre obligatoire avec un médecin
    const requestId = body?.contraception_request_id ? Number(body.contraception_request_id) : null;
    let creq: any = null;
    if (requestId) {
      [[creq]] = await this.pool.query(
        `SELECT r.id, r.status, r.requires_doctor, m.name AS method_name
         FROM contraception_requests r JOIN contraceptive_methods m ON m.id = r.method_id WHERE r.id = ? AND r.user_id = ? LIMIT 1`,
        [requestId, userId],
      );
      if (!creq) throw new NotFoundException('Demande de contraception introuvable.');
      if (creq.status !== 'accepted' || Number(creq.requires_doctor) !== 1) {
        throw new BadRequestException('Cette demande n’attend pas de rendez-vous avec un médecin.');
      }
      if (!reason) reason = `Adoption d'un contraceptif : ${creq.method_name}`;
    }

    const [[{ n: upcoming }]]: any = await this.pool.query(
      `SELECT COUNT(*) AS n FROM tc_appointments WHERE patient_user_id = ? AND status = 'booked' AND ends_at > UTC_TIMESTAMP()`,
      [userId],
    );
    if (num(upcoming) >= MAX_UPCOMING_PER_PATIENT) {
      throw new BadRequestException(`Vous avez déjà ${MAX_UPCOMING_PER_PATIENT} rendez-vous à venir. Annulez-en un pour en prendre un autre.`);
    }

    // Médecin choisi par le jeune (facultatif), sinon le moins chargé des médecins libres à cette heure
    const chosen = body?.doctor_id !== undefined && body?.doctor_id !== null && body?.doctor_id !== '' ? Number(body.doctor_id) : null;
    if (chosen !== null && (!Number.isInteger(chosen) || chosen <= 0)) throw new BadRequestException('Médecin invalide.');
    const day = beninDayOf(start);
    const per = await this.slotsByDoctor(day, day, mode);
    const free = per
      .filter((p) => p.slots.some((s) => s.getTime() === start.getTime()))
      .map((p) => p.doctor)
      .filter((d) => chosen === null || Number(d.id) === chosen);
    if (!free.length) throw new ConflictException('Ce créneau n’est plus disponible. Choisissez une autre heure.');
    const ids = free.map((d) => Number(d.id));
    const [loads]: any = await this.pool.query(
      `SELECT doctor_id, COUNT(*) AS n FROM tc_appointments WHERE doctor_id IN (${ids.map(() => '?').join(',')})
       AND status = 'booked' AND ends_at > UTC_TIMESTAMP() GROUP BY doctor_id`,
      ids,
    );
    const load = new Map<number, number>(loads.map((r: any) => [Number(r.doctor_id), num(r.n)]));
    free.sort((a, b) => (load.get(Number(a.id)) ?? 0) - (load.get(Number(b.id)) ?? 0) || Number(a.id) - Number(b.id));

    for (const doctor of free) {
      const minutes = Number(doctor.slot_minutes) || DEFAULT_SLOT_MINUTES;
      const end = new Date(start.getTime() + minutes * 60000);
      const reference = newReference();
      const room = mode === 'video' ? newJitsiRoom(reference) : null;
      try {
        const [res]: any = await this.pool.query(
          `INSERT INTO tc_appointments (reference, doctor_id, patient_user_id, mode, starts_at, ends_at, status, slot_lock,
             patient_name, patient_email, patient_phone, reason, room)
           VALUES (?, ?, ?, ?, ?, ?, 'booked', 1, ?, ?, ?, ?, ?)`,
          [reference, doctor.id, userId, mode, utcSql(start), utcSql(end), user.name, user.email, phone, reason, room],
        );
        const appt: ApptMail = {
          reference,
          mode,
          starts_at: start,
          patient_name: user.name,
          patient_email: user.email,
          patient_phone: phone,
          doctor_name: doctor.name,
          doctor_title: doctor.title,
          room,
          reason,
        };
        if (creq) {
          await this.pool.query(`UPDATE contraception_requests SET appointment_id = ?, status = 'meeting' WHERE id = ? AND status = 'accepted'`, [
            Number(res.insertId),
            creq.id,
          ]);
        }
        await this.notifyBooked(Number(res.insertId), appt, Number(doctor.id));
        return {
          id: Number(res.insertId),
          reference,
          mode,
          mode_label: MODE_LABEL[mode],
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          minutes,
          doctor: { name: doctor.name, title: doctor.title },
          room_url: room ? jitsiUrl(room) : null,
          phone,
          email: user.email,
        };
      } catch (e: any) {
        if (e?.code === 'ER_DUP_ENTRY') continue; // pris entre-temps chez ce médecin : médecin suivant
        throw e;
      }
    }
    throw new ConflictException('Ce créneau vient d’être réservé. Choisissez une autre heure.');
  }

  private async notifyBooked(id: number, appt: ApptMail, doctorId: number) {
    try {
      await mail(appt.patient_email, `Rendez-vous confirmé : ${appt.reference}`, bookingConfirmationEmail(appt));
      await this.pool.query(`UPDATE tc_appointments SET confirmation_sent_at = UTC_TIMESTAMP() WHERE id = ?`, [id]);
    } catch (e: any) {
      console.error('[téléconsultation] e-mail de confirmation :', e?.message);
    }
    try {
      const [[d]]: any = await this.pool.query(`SELECT email FROM tc_doctors WHERE id = ?`, [doctorId]);
      await mail(d?.email, `Nouveau rendez-vous : ${appt.reference}`, doctorNewBookingEmail(appt));
    } catch (e: any) {
      console.error('[téléconsultation] e-mail au médecin :', e?.message);
    }
  }

  private presentAppointment(a: any, forPatient: boolean) {
    const now = Date.now();
    const start = new Date(a.starts_at).getTime();
    const end = new Date(a.ends_at).getTime();
    return {
      id: Number(a.id),
      reference: a.reference,
      mode: a.mode,
      mode_label: MODE_LABEL[a.mode as Mode] ?? a.mode,
      status: a.status,
      status_label: APPOINTMENT_STATUS_LABEL[a.status] ?? a.status,
      starts_at: a.starts_at,
      ends_at: a.ends_at,
      doctor: { name: a.doctor_name, title: a.doctor_title ?? null },
      reason: a.reason ?? null,
      phone: a.patient_phone ?? null,
      // Lien de visio : du quart d'heure avant le début jusqu'à 1 h après la fin
      room_url: a.mode === 'video' && a.room && a.status === 'booked' && now >= start - 15 * 60000 && now <= end + 60 * 60000 ? jitsiUrl(a.room) : null,
      can_cancel: forPatient && a.status === 'booked' && now < start,
      is_live: a.status === 'booked' && now >= start - 5 * 60000 && now <= end,
      has_report: Boolean(a.finalized_at),
    };
  }

  async myAppointments(userId: number) {
    const [rows]: any = await this.pool.query(
      `SELECT a.id, a.reference, a.mode, a.status, a.reason, a.patient_phone, a.room, ${iso('a.starts_at')}, ${iso('a.ends_at')},
              d.name AS doctor_name, d.title AS doctor_title, r.finalized_at
       FROM tc_appointments a JOIN tc_doctors d ON d.id = a.doctor_id
       LEFT JOIN tc_reports r ON r.appointment_id = a.id
       WHERE a.patient_user_id = ? ORDER BY a.starts_at DESC LIMIT 100`,
      [userId],
    );
    const list = rows.map((a: any) => this.presentAppointment(a, true));
    const now = new Date().toISOString();
    return {
      upcoming: list.filter((a: any) => a.status === 'booked' && a.ends_at >= now).reverse(),
      past: list.filter((a: any) => !(a.status === 'booked' && a.ends_at >= now)),
    };
  }

  async cancelByPatient(userId: number, id: number, body: any) {
    const reason = cleanText(body?.reason, 300, 'Le motif');
    const a = await this.appointmentMail(id);
    if (!a || Number(a.patient_user_id) !== userId) throw new NotFoundException('Rendez-vous introuvable.');
    if (a.status !== 'booked') throw new BadRequestException('Ce rendez-vous ne peut plus être annulé.');
    if (new Date(a.starts_at).getTime() <= Date.now()) throw new BadRequestException('Le rendez-vous a déjà commencé.');
    await this.pool.query(
      `UPDATE tc_appointments SET status = 'cancelled', slot_lock = NULL, cancelled_at = UTC_TIMESTAMP(), cancelled_by = 'patient', cancel_reason = ?
       WHERE id = ? AND status = 'booked'`,
      [reason, id],
    );
    await this.releaseContraception(id);
    mail(a.doctor_email, `Rendez-vous annulé : ${a.reference}`, cancellationEmail(this.toMail(a), true, reason)).catch((e) =>
      console.error('[téléconsultation] e-mail d’annulation :', e?.message),
    );
    return { success: true, message: 'Rendez-vous annulé.' };
  }

  private async appointmentMail(id: number) {
    const [[a]]: any = await this.pool.query(
      `SELECT a.*, ${iso('a.starts_at')}, ${iso('a.ends_at')}, d.name AS doctor_name, d.title AS doctor_title, d.email AS doctor_email, d.user_id AS doctor_user_id
       FROM tc_appointments a JOIN tc_doctors d ON d.id = a.doctor_id WHERE a.id = ? LIMIT 1`,
      [id],
    );
    return a ?? null;
  }

  private toMail(a: any): ApptMail {
    return {
      reference: a.reference,
      mode: a.mode,
      starts_at: a.starts_at,
      patient_name: a.patient_name,
      patient_email: a.patient_email,
      patient_phone: a.patient_phone,
      doctor_name: a.doctor_name,
      doctor_title: a.doctor_title,
      room: a.room,
      reason: a.reason,
    };
  }

  /** Orientations du jeune (dashboard) : centre, code QR, mot du médecin */
  async myReferrals(userId: number) {
    const [rows]: any = await this.pool.query(
      `SELECT f.id, f.token, f.short_code, f.status, ${iso('f.expires_at')}, ${iso('f.created_at')}, ${iso('f.completed_at')},
              r.request_type, r.patient_summary, r.urgency, a.mode, a.reference, ${iso('a.starts_at', 'consulted_at')},
              d.name AS doctor_name, d.title AS doctor_title, m.name AS method_name, f.outcome,
              c.name AS center_name, c.organization, c.address, c.city, c.phone AS center_phone, c.opening_hours, c.lat, c.lng
       FROM tc_referrals f
       LEFT JOIN tc_reports r ON r.id = f.report_id
       LEFT JOIN tc_appointments a ON a.id = f.appointment_id
       LEFT JOIN tc_doctors d ON d.id = a.doctor_id
       LEFT JOIN contraception_requests cr ON cr.id = f.contraception_request_id
       LEFT JOIN contraceptive_methods m ON m.id = cr.method_id
       JOIN tc_centers c ON c.id = f.center_id
       WHERE f.patient_user_id = ? ORDER BY f.created_at DESC`,
      [userId],
    );
    return rows.map((f: any) => this.presentReferralForPatient(openFields(f, ['patient_summary'])));
  }

  private referralStatus(f: any) {
    if ((f.status === 'issued' || f.status === 'viewed') && new Date(f.expires_at).getTime() < Date.now()) return 'expired';
    return f.status;
  }

  private presentReferralForPatient(f: any) {
    const status = this.referralStatus(f);
    return {
      id: Number(f.id),
      token: f.token,
      short_code: formatShortCode(f.short_code),
      status,
      status_label: REFERRAL_STATUS_LABEL[status] ?? status,
      expires_at: f.expires_at,
      created_at: f.created_at,
      completed_at: f.completed_at ?? null,
      request_label: f.method_name ? `Contraception : ${f.method_name}` : REQUEST_TYPES[f.request_type] ?? f.request_type,
      urgency_label: f.urgency ? URGENCY_LABEL[f.urgency] ?? f.urgency : null,
      patient_summary: f.patient_summary ?? null,
      outcome: f.outcome ?? null,
      // Sans téléconsultation (contraceptif sans médecin) : pas de consultation
      consultation: f.reference
        ? { reference: f.reference, mode: f.mode, mode_label: MODE_LABEL[f.mode as Mode], date: f.consulted_at, doctor: f.doctor_name, doctor_title: f.doctor_title }
        : null,
      center: {
        name: f.center_name,
        organization: ORGANIZATION_LABEL[f.organization] ?? f.organization,
        address: f.address,
        city: f.city,
        phone: f.center_phone,
        opening_hours: f.opening_hours,
        lat: f.lat != null ? Number(f.lat) : null,
        lng: f.lng != null ? Number(f.lng) : null,
      },
      qr_image: `/teleconsultation/qr/${f.token}.png`,
    };
  }

  /** Page publique du code QR (lien de l'e-mail) : aucune donnée de santé, seulement le centre et le code */
  async qrInfo(token: string) {
    const f = await this.referralByToken(token);
    if (!f) throw new NotFoundException('Code QR introuvable.');
    const status = this.referralStatus(f);
    return {
      token: f.token,
      short_code: formatShortCode(f.short_code),
      status,
      status_label: REFERRAL_STATUS_LABEL[status] ?? status,
      expires_at: f.expires_at,
      center: { name: f.center_name, organization: ORGANIZATION_LABEL[f.organization] ?? f.organization, city: f.city, address: f.address, phone: f.center_phone, opening_hours: f.opening_hours },
    };
  }

  private async referralByToken(token: string) {
    if (!/^[a-f0-9]{48}$/.test(String(token))) return null;
    const [[f]]: any = await this.pool.query(
      `SELECT f.*, ${iso('f.expires_at')}, c.name AS center_name, c.organization, c.city, c.address, c.phone AS center_phone, c.opening_hours
       FROM tc_referrals f JOIN tc_centers c ON c.id = f.center_id WHERE f.token = ? LIMIT 1`,
      [token],
    );
    return f ?? null;
  }

  /** Contenu encodé dans le code QR : l'adresse du dossier, lisible seulement par le centre connecté */
  async qrTarget(token: string) {
    const f = await this.referralByToken(token);
    if (!f) throw new NotFoundException('Code QR introuvable.');
    return `${siteUrl()}/dossier/${f.token}`;
  }

  // =====================================================================
  // Espace médecin
  // =====================================================================

  async doctorFor(userId: number) {
    const [[d]]: any = await this.pool.query(
      `SELECT id, user_id, name, email, phone, title, bio, slot_minutes, is_active, is_house FROM tc_doctors WHERE user_id = ? LIMIT 1`,
      [userId],
    );
    if (!d) throw new ForbiddenException('Cet espace est réservé aux médecins de E.doto family.');
    if (!Number(d.is_active)) throw new ForbiddenException('Votre espace médecin est désactivé. Contactez E.doto family.');
    return d;
  }

  async doctorOverview(userId: number) {
    const d = await this.doctorFor(userId);
    const today = beninDayOf(new Date());
    const dayStart = new Date(Date.parse(`${today}T00:00:00Z`) - 3600000);
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const [[todayRows], [[stats]], [toWrite], [[rules]]]: any = await Promise.all([
      this.pool.query(
        `SELECT a.id, a.reference, a.mode, a.status, a.reason, a.patient_name, a.patient_phone, a.room, ${iso('a.starts_at')}, ${iso('a.ends_at')},
                d.name AS doctor_name, d.title AS doctor_title, r.finalized_at
         FROM tc_appointments a JOIN tc_doctors d ON d.id = a.doctor_id LEFT JOIN tc_reports r ON r.appointment_id = a.id
         WHERE a.doctor_id = ? AND a.starts_at >= ? AND a.starts_at < ? AND a.status <> 'cancelled' ORDER BY a.starts_at`,
        [d.id, utcSql(dayStart), utcSql(dayEnd)],
      ),
      this.pool.query(
        `SELECT SUM(status = 'booked' AND ends_at > UTC_TIMESTAMP()) AS upcoming,
                SUM(status = 'completed' AND completed_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)) AS done_30,
                SUM(status = 'no_show') AS no_show,
                SUM(status = 'cancelled') AS cancelled
         FROM tc_appointments WHERE doctor_id = ?`,
        [d.id],
      ),
      this.pool.query(
        `SELECT a.id, a.reference, a.mode, a.patient_name, ${iso('a.starts_at')}
         FROM tc_appointments a LEFT JOIN tc_reports r ON r.appointment_id = a.id
         WHERE a.doctor_id = ? AND a.status = 'booked' AND a.ends_at <= UTC_TIMESTAMP() AND r.finalized_at IS NULL
         ORDER BY a.starts_at DESC LIMIT 20`,
        [d.id],
      ),
      this.pool.query(`SELECT COUNT(*) AS n FROM tc_availability WHERE doctor_id = ?`, [d.id]),
    ]);
    return {
      doctor: { name: d.name, title: d.title, email: d.email, slot_minutes: Number(d.slot_minutes) },
      today: todayRows.map((a: any) => ({ ...this.presentAppointment(a, false), patient_name: a.patient_name, room_url: a.mode === 'video' && a.room ? jitsiUrl(a.room) : null })),
      stats: { upcoming: num(stats?.upcoming), done_30: num(stats?.done_30), no_show: num(stats?.no_show), cancelled: num(stats?.cancelled) },
      to_write: toWrite,
      has_availability: num(rules?.n) > 0,
    };
  }

  async doctorAppointments(userId: number, q: any) {
    const d = await this.doctorFor(userId);
    const where = ['a.doctor_id = ?'];
    const params: any[] = [d.id];
    if (['booked', 'completed', 'cancelled', 'no_show'].includes(q?.status)) { where.push('a.status = ?'); params.push(q.status); }
    if (q?.when === 'upcoming') where.push("a.status = 'booked' AND a.ends_at > UTC_TIMESTAMP()");
    if (q?.when === 'to_write') where.push("a.status = 'booked' AND a.ends_at <= UTC_TIMESTAMP() AND (r.finalized_at IS NULL)");
    if (q?.mode === 'video' || q?.mode === 'phone') { where.push('a.mode = ?'); params.push(q.mode); }
    if (isDay(q?.date_from)) { where.push('a.starts_at >= ?'); params.push(utcSql(new Date(Date.parse(`${q.date_from}T00:00:00Z`) - 3600000))); }
    if (isDay(q?.date_to)) { where.push('a.starts_at < ?'); params.push(utcSql(new Date(Date.parse(`${q.date_to}T00:00:00Z`) + 23 * 3600000))); }
    const s = typeof q?.search === 'string' ? q.search.trim() : '';
    if (s) { where.push('(a.reference LIKE ? OR a.patient_name COLLATE utf8mb4_general_ci LIKE ? OR a.patient_phone LIKE ?)'); params.push(`%${s}%`, `%${s}%`, `%${s}%`); }
    const page = Math.max(1, Number(q?.page) || 1);
    const limit = 20;
    const order = q?.sort === 'asc' ? 'ASC' : 'DESC';
    const w = where.join(' AND ');
    const [[rows], [[c]]]: any = await Promise.all([
      this.pool.query(
        `SELECT a.id, a.reference, a.mode, a.status, a.reason, a.patient_name, a.patient_phone, a.room, ${iso('a.starts_at')}, ${iso('a.ends_at')},
                d.name AS doctor_name, d.title AS doctor_title, r.finalized_at
         FROM tc_appointments a JOIN tc_doctors d ON d.id = a.doctor_id LEFT JOIN tc_reports r ON r.appointment_id = a.id
         WHERE ${w} ORDER BY a.starts_at ${order}, a.id DESC LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit],
      ),
      this.pool.query(`SELECT COUNT(*) AS n FROM tc_appointments a LEFT JOIN tc_reports r ON r.appointment_id = a.id WHERE ${w}`, params),
    ]);
    return {
      data: rows.map((a: any) => ({ ...this.presentAppointment(a, false), patient_name: a.patient_name })),
      total: num(c?.n),
      page,
      last_page: Math.max(1, Math.ceil(num(c?.n) / limit)),
    };
  }

  private async ownAppointment(userId: number, id: number) {
    const d = await this.doctorFor(userId);
    const a = await this.appointmentMail(id);
    if (!a || Number(a.doctor_id) !== Number(d.id)) throw new NotFoundException('Rendez-vous introuvable.');
    return { d, a };
  }

  async doctorAppointment(userId: number, id: number, ip: string | null = null) {
    const { a } = await this.ownAppointment(userId, id);
    await logHealthAccess(this.pool, { actorUserId: userId, actorRole: 'doctor', patientUserId: Number(a.patient_user_id), resource: 'tc_appointment', resourceId: id, ip });
    const [[[u]], [[sealedReport]], [history], [centers]]: any = await Promise.all([
      this.pool.query(`SELECT sex, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birth_date FROM users WHERE id = ?`, [a.patient_user_id]),
      this.pool.query(`SELECT * FROM tc_reports WHERE appointment_id = ?`, [id]),
      this.pool.query(
        `SELECT a2.reference, ${iso('a2.starts_at')}, a2.mode, r2.request_type, r2.assessment, r2.plan, d2.name AS doctor_name
         FROM tc_appointments a2 JOIN tc_reports r2 ON r2.appointment_id = a2.id AND r2.finalized_at IS NOT NULL
         JOIN tc_doctors d2 ON d2.id = a2.doctor_id
         WHERE a2.patient_user_id = ? AND a2.id <> ? ORDER BY a2.starts_at DESC LIMIT 10`,
        [a.patient_user_id, id],
      ),
      this.pool.query(`SELECT id, name, organization, city FROM tc_centers WHERE is_active = 1 ORDER BY city, name`),
    ]);
    const report = openFields(sealedReport, HEALTH_FIELDS.tc_reports);
    const referral = report?.id
      ? (await this.pool.query(`SELECT short_code, token, status, ${iso('expires_at')} FROM tc_referrals WHERE report_id = ?`, [report.id]))[0][0]
      : null;
    return {
      appointment: {
        ...this.presentAppointment({ ...a, finalized_at: report?.finalized_at }, false),
        room_url: a.mode === 'video' && a.room ? jitsiUrl(a.room) : null,
        started_at: a.started_at ?? null,
      },
      patient: {
        name: a.patient_name,
        email: a.patient_email,
        phone: a.patient_phone,
        sex: u?.sex ?? null,
        age: u?.birth_date ? ageOn(u.birth_date) : null,
      },
      report: report ?? null,
      referral: referral ? { ...referral, short_code: formatShortCode(referral.short_code) } : null,
      // Adoption d'un contraceptif : le médecin conclut l'adoption dans le compte rendu (étape 4)
      contraception: await this.contraceptionOfAppointment(id),
      conclusions: CONCLUSION_LABEL,
      history: history.map((h: any) => ({ ...openFields(h, ['assessment', 'plan']), request_label: REQUEST_TYPES[h.request_type] ?? h.request_type })),
      centers: centers.map((c: any) => ({ id: Number(c.id), name: c.name, city: c.city, organization: ORGANIZATION_LABEL[c.organization] ?? c.organization })),
      options: { request_types: REQUEST_TYPES, urgency: URGENCY_LABEL },
    };
  }

  async doctorStart(userId: number, id: number) {
    const { a } = await this.ownAppointment(userId, id);
    if (a.status !== 'booked') throw new BadRequestException('Ce rendez-vous n’est plus actif.');
    await this.pool.query(`UPDATE tc_appointments SET started_at = COALESCE(started_at, UTC_TIMESTAMP()) WHERE id = ?`, [id]);
    return { success: true, room_url: a.mode === 'video' && a.room ? jitsiUrl(a.room) : null, phone: a.patient_phone };
  }

  /** Rendez-vous annulé ou manqué : la demande de contraception attend un nouveau rendez-vous */
  async releaseContraception(appointmentId: number) {
    await this.pool.query(
      `UPDATE contraception_requests SET status = 'accepted', appointment_id = NULL WHERE appointment_id = ? AND status = 'meeting'`,
      [appointmentId],
    );
  }

  /** Demande de contraception liée à un rendez-vous (avec le nom de la méthode) */
  private async contraceptionOfAppointment(appointmentId: number) {
    const [[r]]: any = await this.pool.query(
      `SELECT r.id, r.status, r.youth_note, m.name AS method_name, m.slug AS method_slug
       FROM contraception_requests r JOIN contraceptive_methods m ON m.id = r.method_id WHERE r.appointment_id = ? LIMIT 1`,
      [appointmentId],
    );
    return r ? openFields(r, ['youth_note']) : null;
  }

  async doctorNoShow(userId: number, id: number) {
    const { a } = await this.ownAppointment(userId, id);
    if (a.status !== 'booked') throw new BadRequestException('Ce rendez-vous n’est plus actif.');
    if (new Date(a.starts_at).getTime() > Date.now()) throw new BadRequestException('Le rendez-vous n’a pas encore commencé.');
    await this.pool.query(`UPDATE tc_appointments SET status = 'no_show', slot_lock = NULL WHERE id = ? AND status = 'booked'`, [id]);
    await this.releaseContraception(id);
    return { success: true, message: 'Rendez-vous noté « absent ».' };
  }

  async doctorCancel(userId: number, id: number, body: any) {
    const reason = cleanText(body?.reason, 300, 'Le motif', true);
    const { a } = await this.ownAppointment(userId, id);
    if (a.status !== 'booked') throw new BadRequestException('Ce rendez-vous n’est plus actif.');
    await this.pool.query(
      `UPDATE tc_appointments SET status = 'cancelled', slot_lock = NULL, cancelled_at = UTC_TIMESTAMP(), cancelled_by = 'doctor', cancel_reason = ? WHERE id = ? AND status = 'booked'`,
      [reason, id],
    );
    await this.releaseContraception(id);
    mail(a.patient_email, `Rendez-vous annulé : ${a.reference}`, cancellationEmail(this.toMail(a), false, reason)).catch((e) =>
      console.error('[téléconsultation] e-mail d’annulation :', e?.message),
    );
    return { success: true, message: 'Rendez-vous annulé : le jeune est prévenu par e-mail.' };
  }

  /** Compte rendu : brouillon enregistrable, puis finalisation (verrouillée) avec orientation éventuelle */
  async saveReport(userId: number, id: number, body: any, finalize: boolean) {
    const { d, a } = await this.ownAppointment(userId, id);
    if (a.status === 'cancelled' || a.status === 'no_show') throw new BadRequestException('Rendez-vous annulé ou absent : pas de compte rendu.');
    if (new Date(a.starts_at).getTime() - Date.now() > 15 * 60000) throw new BadRequestException('Le compte rendu se rédige pendant ou après la consultation.');
    const [[existing]]: any = await this.pool.query(`SELECT id, finalized_at FROM tc_reports WHERE appointment_id = ?`, [id]);
    if (existing?.finalized_at) throw new BadRequestException('Compte rendu déjà finalisé : il ne peut plus être modifié.');

    const requestType = Object.keys(REQUEST_TYPES).includes(body?.request_type) ? body.request_type : null;
    const f = {
      request_type: requestType ?? 'other',
      request_detail: cleanText(body?.request_detail, 300, 'La précision de la demande'),
      chief_complaint: cleanText(body?.chief_complaint, 3000, 'Le motif de consultation', finalize),
      history: cleanText(body?.history, 3000, 'Les antécédents'),
      gyneco_history: cleanText(body?.gyneco_history, 3000, 'Les antécédents gynécologiques'),
      allergies: cleanText(body?.allergies, 300, 'Les allergies'),
      current_treatments: cleanText(body?.current_treatments, 300, 'Les traitements en cours'),
      findings: cleanText(body?.findings, 3000, 'Les observations'),
      assessment: cleanText(body?.assessment, 3000, 'La conclusion', finalize),
      plan: cleanText(body?.plan, 3000, 'La conduite à tenir', finalize),
      urgency: Object.keys(URGENCY_LABEL).includes(body?.urgency) ? body.urgency : 'routine',
      center_id: null as number | null,
      center_instructions: cleanText(body?.center_instructions, 3000, 'Les consignes pour le centre'),
      patient_summary: cleanText(body?.patient_summary, 1500, 'Le message au jeune', finalize),
    };
    if (finalize && !requestType) throw new BadRequestException('Choisissez la demande du jeune.');
    const creq = await this.contraceptionOfAppointment(id);
    const conclusion = (CONCLUSIONS as readonly string[]).includes(body?.adoption_conclusion) ? String(body.adoption_conclusion) : null;
    if (finalize && creq && !conclusion) throw new BadRequestException('Indiquez la conclusion de l’adoption du contraceptif.');
    const centerId = Number(body?.center_id);
    if (body?.center_id && Number.isInteger(centerId) && centerId > 0) {
      const [[c]]: any = await this.pool.query(`SELECT id FROM tc_centers WHERE id = ? AND is_active = 1`, [centerId]);
      if (!c) throw new BadRequestException('Centre inconnu ou inactif.');
      f.center_id = centerId;
      if (finalize && !f.center_instructions) throw new BadRequestException('Indiquez au centre ce qu’il doit faire pour ce jeune.');
    }
    if (finalize && creq && conclusion === 'adopt' && !f.center_id) {
      throw new BadRequestException('Adoption conclue : choisissez le centre où le jeune ira pour la méthode.');
    }

    const cols = Object.keys(f);
    const sealed: readonly string[] = HEALTH_FIELDS.tc_reports;
    const vals = cols.map((k) => (sealed.includes(k) ? sealHealth((f as any)[k]) : (f as any)[k]));
    let reportId: number;
    if (existing) {
      await this.pool.query(`UPDATE tc_reports SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...vals, existing.id]);
      reportId = Number(existing.id);
    } else {
      const [res]: any = await this.pool.query(
        `INSERT INTO tc_reports (appointment_id, doctor_id, patient_user_id, ${cols.join(', ')}) VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')})`,
        [id, d.id, a.patient_user_id, ...vals],
      );
      reportId = Number(res.insertId);
    }
    if (!finalize) return { success: true, message: 'Brouillon enregistré.', report_id: reportId };

    await this.pool.query(`UPDATE tc_reports SET finalized_at = UTC_TIMESTAMP() WHERE id = ? AND finalized_at IS NULL`, [reportId]);
    await this.pool.query(
      `UPDATE tc_appointments SET status = 'completed', slot_lock = 1, completed_at = UTC_TIMESTAMP(), started_at = COALESCE(started_at, starts_at) WHERE id = ?`,
      [id],
    );

    let referral: any = null;
    if (f.center_id) referral = await this.issueReferral(reportId, a, f.center_id, f.patient_summary, d.name, creq && conclusion === 'adopt' ? Number(creq.id) : null);
    if (creq) {
      const adopted = conclusion === 'adopt';
      await this.pool.query(
        `UPDATE contraception_requests SET concluded_at = UTC_TIMESTAMP(), conclusion = ?, conclusion_note = ?, status = ?, referral_id = ? WHERE id = ?`,
        [conclusion, sealHealth(f.patient_summary), adopted ? 'center' : 'not_adopted', adopted && referral ? referral.id : null, creq.id],
      );
    }
    return {
      success: true,
      message: referral
        ? `Compte rendu finalisé. Orientation envoyée au jeune (code ${referral.short_code}).`
        : 'Compte rendu finalisé.',
      referral,
    };
  }

  private async issueReferral(reportId: number, a: any, centerId: number, summary: string | null, doctorName: string, contraceptionRequestId: number | null = null) {
    return this.createReferral({
      reportId,
      appointmentId: Number(a.id),
      patientUserId: Number(a.patient_user_id),
      patientName: a.patient_name,
      patientEmail: a.patient_email,
      patientPhone: a.patient_phone,
      mode: a.mode as Mode,
      centerId,
      summary,
      doctorName,
      contraceptionRequestId,
    });
  }

  /**
   * Orientation vers un centre : code QR et code court, e-mail au jeune (et SMS si la consultation était par appel).
   * Sans téléconsultation (contraceptif sans médecin, 21/10/2026) : pas de rendez-vous ni de compte rendu.
   */
  async createReferral(o: {
    reportId: number | null;
    appointmentId: number | null;
    patientUserId: number;
    patientName: string;
    patientEmail: string | null;
    patientPhone: string | null;
    mode: Mode | null;
    centerId: number;
    summary: string | null;
    doctorName: string;
    contraceptionRequestId?: number | null;
    intro?: string | null;
  }) {
    const expires = new Date(Date.now() + REFERRAL_TTL_DAYS * 86400000);
    let token = '';
    let code = '';
    let refId = 0;
    for (let i = 0; i < 5 && !refId; i++) {
      token = newReferralToken();
      code = newShortCode();
      try {
        const [res]: any = await this.pool.query(
          `INSERT INTO tc_referrals (report_id, appointment_id, patient_user_id, center_id, token, short_code, status, expires_at, contraception_request_id)
           VALUES (?, ?, ?, ?, ?, ?, 'issued', ?, ?)`,
          [o.reportId, o.appointmentId, o.patientUserId, o.centerId, token, code, utcSql(expires), o.contraceptionRequestId ?? null],
        );
        refId = Number(res.insertId);
      } catch (e: any) {
        if (e?.code !== 'ER_DUP_ENTRY') throw e;
        if (o.reportId) {
          const [[already]]: any = await this.pool.query(`SELECT id FROM tc_referrals WHERE report_id = ?`, [o.reportId]);
          if (already) throw new ConflictException('Orientation déjà créée pour ce compte rendu.');
        }
      }
    }
    if (!refId) throw new InternalServerErrorException('Création du code d’orientation impossible. Réessayez.');

    const [[c]]: any = await this.pool.query(`SELECT * FROM tc_centers WHERE id = ?`, [o.centerId]);
    const payload = {
      patient_name: o.patientName,
      mode: (o.mode ?? 'video') as Mode,
      token,
      short_code: code,
      expires_at: expires,
      center: { name: c.name, organization_label: ORGANIZATION_LABEL[c.organization] ?? c.organization, address: c.address, city: c.city, phone: c.phone, opening_hours: c.opening_hours },
      patient_summary: o.summary,
      doctor_name: o.doctorName,
      intro: o.intro ?? null,
    };
    // Visio : e-mail avec le code QR. Appel : SMS avec le code (+ le même e-mail, qui contient le lien du code QR)
    try {
      await mail(o.patientEmail, 'Votre orientation et votre code QR', referralEmail(payload));
      await this.pool.query(`UPDATE tc_referrals SET sent_email_at = UTC_TIMESTAMP() WHERE id = ?`, [refId]);
    } catch (e: any) {
      console.error('[téléconsultation] e-mail d’orientation :', e?.message);
    }
    if (o.mode === 'phone' && o.patientPhone) {
      try {
        await sendSms(o.patientPhone, referralSms(payload));
        await this.pool.query(`UPDATE tc_referrals SET sent_sms_at = UTC_TIMESTAMP() WHERE id = ?`, [refId]);
      } catch (e: any) {
        console.error('[téléconsultation] SMS d’orientation :', e?.message);
      }
    }
    return { id: refId, short_code: formatShortCode(code), token, center: c.name };
  }

  async doctorSchedule(userId: number) {
    const d = await this.doctorFor(userId);
    return this.scheduleOf(d);
  }

  async doctorSaveSchedule(userId: number, body: any) {
    const d = await this.doctorFor(userId);
    return this.saveScheduleOf(d, body);
  }

  // Horaires d'un médecin par son identifiant : saisis par le super admin (20/10/2026)
  private async doctorById(id: number) {
    const [[d]]: any = await this.pool.query(`SELECT id, name, slot_minutes, is_house FROM tc_doctors WHERE id = ? LIMIT 1`, [id]);
    if (!d) throw new NotFoundException('Médecin introuvable.');
    return d;
  }

  async adminSchedule(doctorId: number) {
    const d = await this.doctorById(doctorId);
    return { doctor: { id: Number(d.id), name: d.name, is_house: Number(d.is_house) === 1 }, ...(await this.scheduleOf(d)) };
  }

  async adminSaveSchedule(doctorId: number, body: any) {
    const d = await this.doctorById(doctorId);
    return this.saveScheduleOf(d, body);
  }

  private async scheduleOf(d: any) {
    const [[rules], [offs]]: any = await Promise.all([
      this.pool.query(`SELECT weekday, start_time, end_time, modes FROM tc_availability WHERE doctor_id = ? ORDER BY weekday, start_time`, [d.id]),
      this.pool.query(
        `SELECT id, DATE_FORMAT(date_from, '%Y-%m-%d') AS date_from, DATE_FORMAT(date_to, '%Y-%m-%d') AS date_to, reason
         FROM tc_time_off WHERE doctor_id = ? AND date_to >= ? ORDER BY date_from`,
        [d.id, beninDayOf(new Date())],
      ),
    ]);
    const house = Number(d.is_house) === 1;
    return {
      slot_minutes: house ? HOUSE_SLOT_MINUTES : Number(d.slot_minutes),
      rules: house ? HOUSE_RULES : rules.map((r: any) => ({ ...r, weekday: Number(r.weekday) })),
      time_off: offs,
      // Médecin E.doto family : heures fixes, non modifiables
      fixed_hours: house ? HOUSE_HOURS_LABEL : null,
    };
  }

  private async saveScheduleOf(d: any, body: any) {
    if (Number(d.is_house) === 1) {
      throw new BadRequestException(`Le médecin E.doto family a des heures fixes : ${HOUSE_HOURS_LABEL.toLowerCase()}.`);
    }
    const rules = cleanAvailability(body?.rules);
    const slot = cleanSlotMinutes(body?.slot_minutes ?? d.slot_minutes);
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`DELETE FROM tc_availability WHERE doctor_id = ?`, [d.id]);
      for (const r of rules) {
        await conn.query(`INSERT INTO tc_availability (doctor_id, weekday, start_time, end_time, modes) VALUES (?, ?, ?, ?, ?)`, [d.id, r.weekday, r.start_time, r.end_time, r.modes]);
      }
      await conn.query(`UPDATE tc_doctors SET slot_minutes = ? WHERE id = ?`, [slot, d.id]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    return { success: true, message: 'Disponibilités enregistrées : les nouveaux créneaux sont proposés aux jeunes.' };
  }

  async doctorAddTimeOff(userId: number, body: any) {
    const d = await this.doctorFor(userId);
    if (!isDay(body?.date_from) || !isDay(body?.date_to) || body.date_to < body.date_from) throw new BadRequestException('Dates d’absence invalides.');
    const reason = cleanText(body?.reason, 200, 'Le motif');
    await this.pool.query(`INSERT INTO tc_time_off (doctor_id, date_from, date_to, reason) VALUES (?, ?, ?, ?)`, [d.id, body.date_from, body.date_to, reason]);
    // Rendez-vous déjà pris sur ces jours : signalés au médecin (non annulés automatiquement)
    const [[{ n }]]: any = await this.pool.query(
      `SELECT COUNT(*) AS n FROM tc_appointments WHERE doctor_id = ? AND status = 'booked' AND starts_at >= ? AND starts_at < ?`,
      [d.id, utcSql(new Date(Date.parse(`${body.date_from}T00:00:00Z`) - 3600000)), utcSql(new Date(Date.parse(`${body.date_to}T00:00:00Z`) + 23 * 3600000))],
    );
    return {
      success: true,
      message: num(n) ? `Absence enregistrée. Attention : ${num(n)} rendez-vous déjà pris sur ces jours, à annuler ou à honorer.` : 'Absence enregistrée.',
    };
  }

  async doctorDeleteTimeOff(userId: number, id: number) {
    const d = await this.doctorFor(userId);
    await this.pool.query(`DELETE FROM tc_time_off WHERE id = ? AND doctor_id = ?`, [id, d.id]);
    return { success: true };
  }

  // =====================================================================
  // Espace centre (ABPF, ABMS, clinique)
  // =====================================================================

  async centerFor(userId: number) {
    const [[c]]: any = await this.pool.query(`SELECT * FROM tc_centers WHERE user_id = ? LIMIT 1`, [userId]);
    if (!c) throw new ForbiddenException('Cet espace est réservé aux centres partenaires de E.doto family.');
    if (!Number(c.is_active)) throw new ForbiddenException('L’espace de votre centre est désactivé. Contactez E.doto family.');
    return c;
  }

  async centerOverview(userId: number) {
    const c = await this.centerFor(userId);
    const [[s]]: any = await this.pool.query(
      `SELECT SUM(status = 'issued' AND expires_at > UTC_TIMESTAMP()) AS waiting, SUM(status = 'viewed' AND expires_at > UTC_TIMESTAMP()) AS viewed,
              SUM(status = 'completed') AS completed, COUNT(*) AS total
       FROM tc_referrals WHERE center_id = ?`,
      [c.id],
    );
    return {
      center: { name: c.name, organization: ORGANIZATION_LABEL[c.organization] ?? c.organization, city: c.city, address: c.address },
      stats: { waiting: num(s?.waiting), viewed: num(s?.viewed), completed: num(s?.completed), total: num(s?.total) },
    };
  }

  async centerReferrals(userId: number, q: any) {
    const c = await this.centerFor(userId);
    const where = ['f.center_id = ?'];
    const params: any[] = [c.id];
    if (q?.status === 'expired') where.push("f.status IN ('issued','viewed') AND f.expires_at <= UTC_TIMESTAMP()");
    else if (['issued', 'viewed'].includes(q?.status)) { where.push('f.status = ? AND f.expires_at > UTC_TIMESTAMP()'); params.push(q.status); }
    else if (q?.status === 'completed') where.push("f.status = 'completed'");
    if (Object.keys(URGENCY_LABEL).includes(q?.urgency)) { where.push("COALESCE(r.urgency, 'routine') = ?"); params.push(q.urgency); }
    if (Object.keys(REQUEST_TYPES).includes(q?.request_type)) { where.push("COALESCE(r.request_type, 'contraception') = ?"); params.push(q.request_type); }
    const s = typeof q?.search === 'string' ? q.search.trim() : '';
    if (s) {
      where.push('(f.short_code = ? OR COALESCE(a.patient_name, u.name) COLLATE utf8mb4_general_ci LIKE ? OR a.reference LIKE ?)');
      params.push(normalizeShortCode(s), `%${s}%`, `%${s}%`);
    }
    const [rows]: any = await this.pool.query(
      `SELECT f.id, f.token, f.short_code, f.status, ${iso('f.expires_at')}, ${iso('f.created_at')}, ${iso('f.viewed_at')}, ${iso('f.completed_at')},
              COALESCE(r.request_type, 'contraception') AS request_type, COALESCE(r.urgency, 'routine') AS urgency,
              COALESCE(a.patient_name, u.name) AS patient_name, a.mode, d.name AS doctor_name, m.name AS method_name, f.outcome
       FROM tc_referrals f
       LEFT JOIN tc_reports r ON r.id = f.report_id
       LEFT JOIN tc_appointments a ON a.id = f.appointment_id
       LEFT JOIN tc_doctors d ON d.id = a.doctor_id
       LEFT JOIN users u ON u.id = f.patient_user_id
       LEFT JOIN contraception_requests cr ON cr.id = f.contraception_request_id
       LEFT JOIN contraceptive_methods m ON m.id = cr.method_id
       WHERE ${where.join(' AND ')} ORDER BY FIELD(COALESCE(r.urgency, 'routine'), 'urgent', 'soon', 'routine'), f.created_at DESC LIMIT 200`,
      params,
    );
    return rows.map((f: any) => {
      const status = this.referralStatus(f);
      return {
        id: Number(f.id),
        token: f.token,
        short_code: formatShortCode(f.short_code),
        status,
        status_label: REFERRAL_STATUS_LABEL[status] ?? status,
        created_at: f.created_at,
        expires_at: f.expires_at,
        viewed_at: f.viewed_at ?? null,
        completed_at: f.completed_at ?? null,
        request_label: f.method_name ? `Contraception : ${f.method_name}` : REQUEST_TYPES[f.request_type] ?? f.request_type,
        urgency: f.urgency,
        urgency_label: URGENCY_LABEL[f.urgency] ?? f.urgency,
        patient_name: f.patient_name,
        doctor_name: f.doctor_name ?? 'E.doto family',
        mode_label: f.mode ? MODE_LABEL[f.mode as Mode] : 'Sans téléconsultation',
        outcome: f.outcome ?? null,
        is_contraception: !!f.method_name,
      };
    });
  }

  /** Dossier ouvert par le code QR (jeton) ou par le code court : seulement pour le centre recommandé */
  async centerDossier(userId: number, key: { token?: string; code?: string }, ip: string | null = null) {
    const c = await this.centerFor(userId);
    let f: any = null;
    if (key.token && /^[a-f0-9]{48}$/.test(key.token)) {
      [[f]] = await this.pool.query(`SELECT *, (expires_at <= UTC_TIMESTAMP()) AS is_expired FROM tc_referrals WHERE token = ? LIMIT 1`, [key.token]);
    } else if (key.code) {
      const code = normalizeShortCode(key.code);
      if (code.length === 8) [[f]] = await this.pool.query(`SELECT *, (expires_at <= UTC_TIMESTAMP()) AS is_expired FROM tc_referrals WHERE short_code = ? LIMIT 1`, [code]);
    }
    if (!f) throw new NotFoundException('Code inconnu. Vérifiez le code QR ou le code saisi.');
    if (Number(f.center_id) !== Number(c.id)) throw new ForbiddenException('Ce dossier est adressé à un autre centre : il ne peut pas être ouvert ici.');
    if ((f.status === 'issued' || f.status === 'viewed') && Number(f.is_expired) === 1) {
      throw new GoneException('Ce code a expiré. Le jeune peut reprendre une téléconsultation pour une nouvelle orientation.');
    }
    await logHealthAccess(this.pool, { actorUserId: userId, actorRole: 'health_center', patientUserId: Number(f.patient_user_id), resource: 'tc_referral', resourceId: Number(f.id), ip });
    if (!f.viewed_at) {
      await this.pool.query(`UPDATE tc_referrals SET viewed_at = UTC_TIMESTAMP(), viewed_by = ?, status = IF(status = 'issued', 'viewed', status) WHERE id = ?`, [userId, f.id]);
    }
    const [[sealedReport]]: any = f.report_id ? await this.pool.query(`SELECT * FROM tc_reports WHERE id = ?`, [f.report_id]) : [[null]];
    const r = openFields(sealedReport, HEALTH_FIELDS.tc_reports);
    const [[a]]: any = f.appointment_id
      ? await this.pool.query(
          `SELECT a.reference, a.mode, a.patient_name, a.patient_phone, a.patient_email, ${iso('a.starts_at')}, a.patient_user_id, d.name AS doctor_name, d.title AS doctor_title
           FROM tc_appointments a JOIN tc_doctors d ON d.id = a.doctor_id WHERE a.id = ?`,
          [f.appointment_id],
        )
      : [[null]];
    const [[u]]: any = await this.pool.query(
      `SELECT u.name, u.email, p.contact AS phone, u.sex, DATE_FORMAT(u.birth_date, '%Y-%m-%d') AS birth_date
       FROM users u LEFT JOIN profiles p ON p.customer_id = u.id WHERE u.id = ? LIMIT 1`,
      [f.patient_user_id],
    );
    // Adoption d'un contraceptif liée à cette orientation (21/10/2026)
    const [[cr]]: any = f.contraception_request_id
      ? await this.pool.query(
          `SELECT r.youth_note, r.conclusion, m.name AS method_name, m.requires_doctor
           FROM contraception_requests r JOIN contraceptive_methods m ON m.id = r.method_id WHERE r.id = ?`,
          [f.contraception_request_id],
        )
      : [[null]];
    const [[fresh]]: any = await this.pool.query(
      `SELECT status, outcome, ${iso('viewed_at')}, ${iso('completed_at')}, completed_note, ${iso('expires_at')}, ${iso('created_at')} FROM tc_referrals WHERE id = ?`,
      [f.id],
    );
    return {
      referral: {
        id: Number(f.id),
        short_code: formatShortCode(f.short_code),
        status: fresh.status,
        status_label: REFERRAL_STATUS_LABEL[fresh.status] ?? fresh.status,
        created_at: fresh.created_at,
        expires_at: fresh.expires_at,
        viewed_at: fresh.viewed_at,
        completed_at: fresh.completed_at,
        completed_note: openHealth(fresh.completed_note),
        outcome: fresh.outcome ?? null,
      },
      patient: {
        name: a?.patient_name ?? u?.name,
        phone: a?.patient_phone ?? u?.phone ?? null,
        email: a?.patient_email ?? u?.email ?? null,
        sex: u?.sex ?? null,
        age: u?.birth_date ? ageOn(u.birth_date) : null,
      },
      consultation: a ? { reference: a.reference, mode_label: MODE_LABEL[a.mode as Mode], date: a.starts_at, doctor: a.doctor_name, doctor_title: a.doctor_title } : null,
      contraception: cr
        ? { method: cr.method_name, requires_doctor: Number(cr.requires_doctor) === 1, youth_note: openHealth(cr.youth_note), conclusion_label: cr.conclusion ? CONCLUSION_LABEL[cr.conclusion] : null }
        : null,
      report: r ? {
        request_label: REQUEST_TYPES[r.request_type] ?? r.request_type,
        request_detail: r.request_detail,
        chief_complaint: r.chief_complaint,
        history: r.history,
        gyneco_history: r.gyneco_history,
        allergies: r.allergies,
        current_treatments: r.current_treatments,
        findings: r.findings,
        assessment: r.assessment,
        plan: r.plan,
        urgency: r.urgency,
        urgency_label: URGENCY_LABEL[r.urgency] ?? r.urgency,
        center_instructions: r.center_instructions,
      } : null,
      center: { name: c.name },
    };
  }

  async centerComplete(userId: number, id: number, body: any) {
    const c = await this.centerFor(userId);
    const note = cleanText(body?.note, 600, 'La note de prise en charge');
    const [[f]]: any = await this.pool.query(`SELECT contraception_request_id FROM tc_referrals WHERE id = ? AND center_id = ?`, [id, c.id]);
    // Adoption d'un contraceptif : le centre indique si la méthode a été adoptée (étape 6)
    const outcome = ['done', 'not_done'].includes(body?.outcome) ? String(body.outcome) : null;
    if (f?.contraception_request_id && !outcome) throw new BadRequestException('Indiquez si la méthode a été adoptée ou non.');
    const [res]: any = await this.pool.query(
      `UPDATE tc_referrals SET status = 'completed', completed_at = UTC_TIMESTAMP(), completed_by = ?, completed_note = ?, outcome = ?
       WHERE id = ? AND center_id = ? AND status IN ('issued','viewed')`,
      [userId, sealHealth(note), f?.contraception_request_id ? outcome : null, id, c.id],
    );
    if (!res?.affectedRows) throw new BadRequestException('Orientation introuvable ou déjà terminée.');
    if (f?.contraception_request_id) {
      await this.pool.query(
        `UPDATE contraception_requests SET outcome = ?, outcome_at = UTC_TIMESTAMP(), outcome_note = ?, status = ? WHERE id = ? AND status = 'center'`,
        [outcome, sealHealth(note), outcome === 'done' ? 'followup' : 'not_done', f.contraception_request_id],
      );
    }
    return { success: true, message: 'Prise en charge enregistrée.' };
  }

  // =====================================================================
  // Invitations (médecins et centres) : lien de 7 jours pour choisir son mot de passe
  // =====================================================================

  async invite(kind: 'doctor' | 'center', targetId: number) {
    const table = kind === 'doctor' ? 'tc_doctors' : 'tc_centers';
    const role = kind === 'doctor' ? 'doctor' : 'health_center';
    const [[t]]: any = await this.pool.query(`SELECT id, name, email, user_id, activated_at FROM ${table} WHERE id = ?`, [targetId]);
    if (!t) throw new NotFoundException(kind === 'doctor' ? 'Médecin introuvable.' : 'Centre introuvable.');
    if (t.activated_at) throw new BadRequestException('Cet espace est déjà actif.');
    if (/\.invalid$/i.test(String(t.email))) {
      throw new BadRequestException("Renseignez d'abord la vraie adresse e-mail de ce médecin (bouton Modifier), puis envoyez l'invitation.");
    }
    let userId: number | null = t.user_id ? Number(t.user_id) : null;
    if (!userId) {
      const [[existing]]: any = await this.pool.query(`SELECT id, role FROM users WHERE email = ? LIMIT 1`, [t.email]);
      if (existing && existing.role !== role) {
        throw new ConflictException('Cette adresse e-mail est déjà utilisée par un autre compte E.doto family. Utilisez une autre adresse.');
      }
      if (existing) userId = Number(existing.id);
      else {
        const unusable = `!invitation-${randomBytes(24).toString('hex')}`;
        const [res]: any = await this.pool.query(
          `INSERT INTO users (name, email, password, is_verified, role, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, 1, NOW(), NOW())`,
          [t.name, t.email, unusable, role],
        );
        userId = Number(res.insertId);
      }
      await this.pool.query(`UPDATE ${table} SET user_id = ? WHERE id = ?`, [userId, targetId]);
    }
    const { token, tokenHash } = newInvitationToken();
    const expires = new Date(Date.now() + INVITATION_TTL_DAYS * 86400000);
    await this.pool.query(
      `INSERT INTO tc_invitations (kind, target_id, token_hash, expires_at) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash), expires_at = VALUES(expires_at), created_at = NOW()`,
      [kind, targetId, tokenHash, utcSql(expires)],
    );
    await this.pool.query(`UPDATE ${table} SET invited_at = UTC_TIMESTAMP() WHERE id = ?`, [targetId]);
    try {
      await mail(t.email, kind === 'doctor' ? 'Votre espace médecin E.doto family' : 'L’espace de votre centre sur E.doto family', invitationEmail(kind, t.name, `${siteUrl()}/espace/activation?token=${token}`));
    } catch (e: any) {
      console.error('[téléconsultation] invitation :', e?.message);
      throw new InternalServerErrorException("L'e-mail d'invitation n'a pas pu être envoyé. Réessayez.");
    }
    return { success: true, message: `Invitation envoyée à ${t.email} (lien valable ${INVITATION_TTL_DAYS} jours).` };
  }

  private async findInvitation(token: unknown) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
    const [[row]]: any = await this.pool.query(`SELECT kind, target_id FROM tc_invitations WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP() LIMIT 1`, [sha256(token)]);
    if (!row) return null;
    const table = row.kind === 'doctor' ? 'tc_doctors' : 'tc_centers';
    const [[t]]: any = await this.pool.query(`SELECT id, name, email, user_id FROM ${table} WHERE id = ?`, [row.target_id]);
    return t ? { ...t, kind: row.kind as 'doctor' | 'center' } : null;
  }

  async invitationInfo(token: string) {
    const t = await this.findInvitation(token);
    if (!t) throw new NotFoundException("Lien d'invitation invalide ou expiré. Demandez une nouvelle invitation à E.doto family.");
    return { name: t.name, email: t.email, kind: t.kind, space: t.kind === 'doctor' ? 'Espace médecin' : 'Espace centre' };
  }

  async acceptInvitation(body: any) {
    const password = checkPassword(body?.password);
    const t = await this.findInvitation(body?.token);
    if (!t || !t.user_id) throw new NotFoundException("Lien d'invitation invalide ou expiré. Demandez une nouvelle invitation à E.doto family.");
    const role = t.kind === 'doctor' ? 'doctor' : 'health_center';
    const hash = await bcrypt.hash(password, 10);
    const [res]: any = await this.pool.query(
      `UPDATE users SET password = ?, is_active = 1, is_verified = 1, updated_at = NOW() WHERE id = ? AND role = ?`,
      [hash, t.user_id, role],
    );
    if (!res?.affectedRows) throw new BadRequestException('Compte introuvable.');
    // Audit 1.5 : mot de passe choisi → anciennes sessions fermées
    await bumpTokenVersion(this.pool, 'id = ?', [t.user_id]);
    const table = t.kind === 'doctor' ? 'tc_doctors' : 'tc_centers';
    await this.pool.query(`UPDATE ${table} SET activated_at = UTC_TIMESTAMP() WHERE id = ?`, [t.id]);
    await this.pool.query(`DELETE FROM tc_invitations WHERE kind = ? AND target_id = ?`, [t.kind, t.id]);
    return { success: true, email: t.email, message: 'Votre espace est activé. Vous pouvez vous connecter.' };
  }
}
