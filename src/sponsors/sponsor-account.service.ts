import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../database/database.services';
import { sendVerificationEmail } from '../auth/mailer';
import { INVITATION_TTL_DAYS, newInvitationToken, parseNewPassword, sha256 } from './sponsor-rules';

const ROLE_LABEL: Record<string, string> = {
  customer: 'client',
  super_pickuppoint: 'point de retrait',
  super_admin: 'administrateur',
  store_owner: 'vendeur',
  staff: 'employé de boutique',
};

function invitationEmail(name: string, link: string) {
  return `
  <div style="font-family: Inter, Arial, sans-serif; max-width: 620px; margin: auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #f1ece4;">
    <div style="background: #1f1b16; padding: 28px; text-align: center;">
      <p style="color: #ffffff; font-size: 22px; margin: 0; font-family: Poppins, Arial, sans-serif;">E.doto family</p>
      <p style="color: #b8ac9e; font-size: 12px; letter-spacing: 3px; margin: 6px 0 0;">ESPACE SPONSOR</p>
    </div>
    <div style="padding: 32px 28px; text-align: center; color: #1f1b16;">
      <p style="font-size: 16px;">Bonjour <strong>${name}</strong>,</p>
      <p style="font-size: 15px; line-height: 1.6; color: #5c534a;">
        E.doto family vous invite à rejoindre votre espace sponsor : vous y suivrez les campagnes que vous soutenez.
        Choisissez votre mot de passe en cliquant sur le bouton ci-dessous.
      </p>
      <a href="${link}" style="display: inline-block; margin: 24px 0; padding: 14px 28px; background: #c2185b; color: #ffffff; border-radius: 12px; text-decoration: none; font-weight: 600;">
        Activer mon espace sponsor
      </a>
      <p style="font-size: 13px; color: #9a8e80;">Ce lien est valable ${INVITATION_TTL_DAYS} jours.</p>
    </div>
  </div>`;
}

@Injectable()
export class SponsorAccountService {
  constructor(private readonly db: DatabaseService) { }

  // Invitation (admin) : crée le compte sponsor si besoin et envoie un lien pour choisir le mot de passe
  async invite(sponsorId: number) {
    const pool = this.db.getPool();
    const [[sponsor]]: any = await pool.query(`SELECT id, name, email, user_id, activated_at FROM sponsors WHERE id = ?`, [sponsorId]);
    if (!sponsor) throw new NotFoundException('Sponsor introuvable.');
    if (sponsor.activated_at) throw new BadRequestException('Le compte de ce sponsor est déjà actif.');

    let userId: number | null = sponsor.user_id ? Number(sponsor.user_id) : null;
    if (!userId) {
      const [[existing]]: any = await pool.query(`SELECT id, role FROM users WHERE email = ? LIMIT 1`, [sponsor.email]);
      if (existing && existing.role !== 'sponsor') {
        // On ne change jamais le rôle d'un compte existant
        throw new ConflictException(
          `Cette adresse e-mail est déjà utilisée par un compte ${ROLE_LABEL[existing.role] ?? existing.role}. Utilisez une autre adresse pour ce sponsor.`,
        );
      }
      if (existing) {
        userId = Number(existing.id);
      } else {
        const unusable = `!invitation-${randomBytes(24).toString('hex')}`; // aucune connexion possible avant l'activation
        const [res]: any = await pool.query(
          `INSERT INTO users (name, email, password, is_verified, role, is_active, created_at, updated_at)
           VALUES (?, ?, ?, 1, 'sponsor', 1, NOW(), NOW())`,
          [sponsor.name, sponsor.email, unusable],
        );
        userId = Number(res.insertId);
      }
      await pool.query(`UPDATE sponsors SET user_id = ? WHERE id = ?`, [userId, sponsorId]);
    }

    const { token, tokenHash } = newInvitationToken();
    const expires = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO sponsor_invitations (sponsor_id, token_hash, expires_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash), expires_at = VALUES(expires_at), created_at = NOW()`,
      [sponsorId, tokenHash, expires],
    );
    await pool.query(`UPDATE sponsors SET invited_at = NOW() WHERE id = ?`, [sponsorId]);

    const base = (process.env.FRONTEND_CALLBACK_URL || '').replace(/\/+$/, '');
    try {
      await sendVerificationEmail({
        email: sponsor.email,
        subject: 'Votre espace sponsor E.doto family',
        message: invitationEmail(sponsor.name, `${base}/sponsor/activation?token=${token}`),
      });
    } catch (e) {
      console.error('Erreur e-mail invitation sponsor :', e);
      throw new InternalServerErrorException("L'e-mail d'invitation n'a pas pu être envoyé. Réessayez.");
    }
    return { success: true, message: `Invitation envoyée à ${sponsor.email} (lien valable ${INVITATION_TTL_DAYS} jours).` };
  }

  private async findInvitation(token: any) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
    const [[row]]: any = await this.db.getPool().query(
      `SELECT i.sponsor_id, i.expires_at, s.name, s.email, s.user_id
       FROM sponsor_invitations i JOIN sponsors s ON s.id = i.sponsor_id
       WHERE i.token_hash = ? AND i.expires_at > NOW() LIMIT 1`,
      [sha256(token)],
    );
    return row ?? null;
  }

  async invitationInfo(token: any) {
    const row = await this.findInvitation(token);
    if (!row) throw new NotFoundException("Lien d'invitation invalide ou expiré. Demandez une nouvelle invitation à E.doto family.");
    return { name: row.name, email: row.email };
  }

  async accept(body: any) {
    const password = parseNewPassword(body?.password);
    const row = await this.findInvitation(body?.token);
    if (!row || !row.user_id) throw new NotFoundException("Lien d'invitation invalide ou expiré. Demandez une nouvelle invitation à E.doto family.");
    const pool = this.db.getPool();
    const hash = await bcrypt.hash(password, 10);
    const [res]: any = await pool.query(
      `UPDATE users SET password = ?, is_active = 1, is_verified = 1, updated_at = NOW() WHERE id = ? AND role = 'sponsor'`,
      [hash, row.user_id],
    );
    if (!res?.affectedRows) throw new BadRequestException('Compte sponsor introuvable.');
    await pool.query(`UPDATE sponsors SET activated_at = NOW() WHERE id = ?`, [row.sponsor_id]);
    await pool.query(`DELETE FROM sponsor_invitations WHERE sponsor_id = ?`, [row.sponsor_id]);
    return { success: true, email: row.email, message: 'Votre espace sponsor est activé. Vous pouvez vous connecter.' };
  }
}
