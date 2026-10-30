import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.services';
import { sendVerificationEmail } from '../auth/mailer';
import { safeError } from '../common/request-log';

/**
 * Conservation des données : six (06) mois après la fin d'activité (autorisation APDP n° 2026-327/AT/APDP/DST/SC
 * du 25 juin 2026, point a ; politique de confidentialité du 30/10/2026). Migration 022.
 * - Activité : enregistrée à chaque connexion réussie et à chaque renouvellement de session (une écriture par jour au plus).
 * - Prévenance : e-mail à NOTICE_DAYS d'inactivité ; une nouvelle connexion annule tout.
 * - Anonymisation : à PURGE_DAYS d'inactivité et au moins NOTICE_MIN_DAYS après la prévenance. L'identité est effacée
 *   (nom, e-mail, téléphone, date de naissance, sexe, ville, adresses, photo, double authentification) ; les commandes et
 *   paiements restent (obligations légales) ; les dossiers de santé restent chiffrés (décision du juriste attendue).
 * INACTIVITY_PURGE : « off » (défaut : compte seulement), « notify » (prévenance), « on » (prévenance + anonymisation).
 * INACTIVITY_ROLES : rôles concernés (défaut « customer »).
 */
export const NOTICE_DAYS = 169;
export const PURGE_DAYS = 183;
export const NOTICE_MIN_DAYS = 14;

export function inactivityMode(env = process.env.INACTIVITY_PURGE): 'off' | 'notify' | 'on' {
  const v = String(env || '').trim().toLowerCase();
  return v === 'on' ? 'on' : v === 'notify' ? 'notify' : 'off';
}

export function inactivityRoles(env = process.env.INACTIVITY_ROLES): string[] {
  const list = String(env || '').split(',').map((r) => r.trim()).filter(Boolean);
  return list.length ? list : ['customer'];
}

let missingColumnLogged = false;

/** Dernière activité (connexion, renouvellement) ; une écriture par jour au plus ; une nouvelle activité annule la prévenance */
export async function touchActivity(db: { query: (sql: string, params?: any[]) => Promise<any> }, userId: number): Promise<void> {
  if (!userId) return;
  try {
    await db.query(
      `UPDATE users SET last_activity_at = UTC_TIMESTAMP(), inactivity_notice_at = NULL
       WHERE id = ? AND (last_activity_at IS NULL OR last_activity_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY))`,
      [userId],
    );
  } catch (err) {
    if (!missingColumnLogged) console.error('[conservation] dernière activité non enregistrée :', safeError(err));
    missingColumnLogged = true;
  }
}

export function inactivityNoticeEmail(name: string, deadline: string): string {
  const safe = String(name || '').replace(/[<>&"]/g, '');
  return `
  <div style="font-family: Inter, Arial, sans-serif; max-width: 560px; margin: auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #f1ece4;">
    <div style="background: #1f1b16; padding: 24px; text-align: center;">
      <p style="color: #ffffff; font-size: 20px; margin: 0; font-family: Poppins, Arial, sans-serif;">E.doto family</p>
    </div>
    <div style="padding: 28px; color: #1f1b16; font-size: 15px; line-height: 1.6;">
      <p>Bonjour ${safe},</p>
      <p>Vous ne vous êtes pas connecté(e) à E.doto family depuis plusieurs mois. Comme le prévoit notre politique de confidentialité
        (autorisation APDP n° 2026-327/AT/APDP/DST/SC), les données de votre compte seront effacées le <strong>${deadline}</strong>.</p>
      <p>Pour garder votre compte, il suffit de vous connecter avant cette date.</p>
    </div>
  </div>`;
}

@Injectable()
export class InactivityService {
  private readonly logger = new Logger('Conservation');

  constructor(private readonly db: DatabaseService) {}

  private get pool(): any {
    return this.db.getPool();
  }

  /** Comptes à prévenir et comptes à rendre anonymes (lecture seule) */
  async due(roles = inactivityRoles()) {
    const marks = roles.map(() => '?').join(',');
    const [notify]: any = await this.pool.query(
      `SELECT id, name, email FROM users
       WHERE role IN (${marks}) AND anonymized_at IS NULL AND inactivity_notice_at IS NULL
         AND COALESCE(last_activity_at, created_at) < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
      [...roles, NOTICE_DAYS],
    );
    const [purge]: any = await this.pool.query(
      `SELECT id FROM users
       WHERE role IN (${marks}) AND anonymized_at IS NULL AND inactivity_notice_at IS NOT NULL
         AND inactivity_notice_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
         AND COALESCE(last_activity_at, created_at) < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
      [...roles, NOTICE_MIN_DAYS, PURGE_DAYS],
    );
    return { notify, purge };
  }

  /** Efface l'identité d'un compte ; commandes, paiements et dossiers de santé (chiffrés) restent */
  async anonymize(userId: number): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE users SET name = 'Compte supprimé', email = CONCAT('supprime-', id, '@compte-supprime.invalid'),
           password = '!', birth_date = NULL, sex = NULL, pickup_city = NULL, pickup_city_src = NULL,
           totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL,
           is_active = 0, token_version = token_version + 1, anonymized_at = UTC_TIMESTAMP()
         WHERE id = ? AND anonymized_at IS NULL`,
        [userId],
      );
      await conn.query(`UPDATE profiles SET bio = NULL, socials = NULL, contact = NULL, notifications = NULL, avatar_id = NULL WHERE customer_id = ?`, [userId]);
      await conn.query(`DELETE FROM addresses WHERE customer_id = ?`, [userId]);
      await conn.query(`DELETE FROM totp_recovery_codes WHERE user_id = ?`, [userId]);
      // Preuve du consentement gardée (date, version), sans l'adresse IP (migration 023)
      await conn.query(`UPDATE user_consents SET ip = NULL WHERE user_id = ?`, [userId]);
      await conn.commit();
    } catch (err) {
      await conn.rollback().catch(() => undefined);
      throw err;
    } finally {
      conn.release();
    }
  }

  /** Une passe : prévenance puis anonymisation selon INACTIVITY_PURGE */
  async run(mode = inactivityMode()) {
    const { notify, purge } = await this.due();
    const result = { mode, to_notify: notify.length, to_purge: purge.length, notified: 0, anonymized: 0 };
    if (mode === 'off') return result;
    const deadline = new Date(Date.now() + NOTICE_MIN_DAYS * 86400000).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    for (const u of notify) {
      try {
        await sendVerificationEmail({ email: u.email, subject: 'Votre compte E.doto family sera bientôt effacé', message: inactivityNoticeEmail(u.name, deadline) });
        await this.pool.query(`UPDATE users SET inactivity_notice_at = UTC_TIMESTAMP() WHERE id = ? AND inactivity_notice_at IS NULL`, [u.id]);
        result.notified++;
      } catch (err) {
        this.logger.error(`Prévenance non envoyée (compte ${u.id}) : ${safeError(err)}`);
      }
    }
    if (mode === 'on') {
      for (const u of purge) {
        try {
          await this.anonymize(Number(u.id));
          result.anonymized++;
        } catch (err) {
          this.logger.error(`Anonymisation impossible (compte ${u.id}) : ${safeError(err)}`);
        }
      }
    }
    return result;
  }
}

@Injectable()
export class InactivityCron {
  private readonly logger = new Logger('Conservation');

  constructor(private readonly service: InactivityService) {}

  // Chaque nuit à 4 h (heure du serveur)
  @Cron('0 4 * * *')
  async tick() {
    try {
      const r = await this.service.run();
      this.logger.log(`Comptes inactifs (${r.mode}) : ${r.to_notify} à prévenir, ${r.to_purge} à effacer ; ${r.notified} prévenus, ${r.anonymized} effacés.`);
    } catch (err) {
      this.logger.error(`Passe de conservation impossible : ${safeError(err)}`);
    }
  }
}
