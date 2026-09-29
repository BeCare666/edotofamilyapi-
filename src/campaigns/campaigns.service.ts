import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { RowDataPacket } from 'mysql2';
import { DatabaseService } from '../database/database.services';
import { RegisterDto } from './dto/register.dto';
import { sendVerificationEmail } from '../auth/mailer';
import { randomInt } from 'crypto';
import { maskOtp } from '../common/sanitize';
import { buildCampaignOtpEmail, CAMPAIGN_OTP_EMAIL_SUBJECT, CAMPAIGN_OTP_TTL_MS } from './campaign-otp-email';
import { statusSql } from './campaign-rules';
import { KIT_AMOUNT_SQL } from '../commissions/commission-rules';
import { campaignExtraColumns, decorateCampaign } from './campaign-sql';
@Injectable()
export class CampaignsService {
  constructor(private readonly databaseService: DatabaseService) { }

  // Statut calculé à partir des dates (décision du 24/09/2026) : la colonne status n'est plus lue.
  // Villes : table campaign_locations (une campagne peut se dérouler dans plusieurs villes).
  private async selectCampaigns(where: string, params: any[] = [], order = 'c.date_start DESC') {
    const [rows]: [RowDataPacket[], any] = await this.databaseService.getPool().query(
      `SELECT c.*, ${campaignExtraColumns('c')} FROM campaigns c WHERE ${where} ORDER BY ${order}`,
      params,
    );
    return rows.map((r) => decorateCampaign(r));
  }

  async getActiveCampaign() {
    const rows = await this.selectCampaigns(`${statusSql('c')} = 'en_cours'`);
    if (!rows.length) return null;
    return rows;
  }

  async getUpcomingCampaigns() {
    return this.selectCampaigns(`${statusSql('c')} = 'a_venir'`, [], 'c.date_start ASC');
  }

  async getActiveCampaignsCount() {
    const [rows]: [RowDataPacket[], any] =
      await this.databaseService.getPool().query(
        `SELECT COUNT(*) as total FROM campaigns c WHERE ${statusSql('c')} = 'en_cours'`
      );

    return rows[0];
  }

  // Campagnes en cours dans une ville : la campagne apparaît dans chacune de ses villes
  async getActiveCampaignByCity(city: string) {
    return this.selectCampaigns(
      `${statusSql('c')} = 'en_cours'
       AND EXISTS (SELECT 1 FROM campaign_locations l WHERE l.campaign_id = c.id AND LOWER(l.city) = LOWER(?))`,
      [city],
    );
  }

  async getCampaignByAccessCode(code: string) {
    const [rows]: [RowDataPacket[], any] =
      await this.databaseService.getPool().query(
        `SELECT c.*, s.name as sponsor_name, s.amount
       FROM campaign_sponsors s
       JOIN campaigns c ON c.id = s.campaign_id
       WHERE s.access_code = ?`,
        [code]
      );

    if (!rows.length) {
      throw new NotFoundException("Accès invalide");
    }

    return rows[0];
  }

  // get campaign by id
  async getCampaignById(id: number) {
    const rows = await this.selectCampaigns('c.id = ?', [id]);
    if (!rows.length) throw new NotFoundException('Campagne introuvable');
    return rows[0];
  }


  buildSponsorEmail({ name, campaignTitle, amount, accessCode }) {
    return `
  <div style="font-family: Inter, Arial, sans-serif; background:#f9fafb; padding:40px 20px;">
    
    <div style="max-width:620px;margin:auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.05);">

      <!-- HEADER -->
      <div style="background:linear-gradient(135deg,#fff5f8,#ffe4ef);padding:30px;text-align:center;">
        <img src="https://edotofamily.netlify.app/images/edotofamily6.1.png" style="height:70px;margin-bottom:10px;" />
        <h1 style="color:#FF6EA9;font-size:22px;margin:0;">Accès Sponsor</h1>
      </div>

      <!-- CONTENT -->
      <div style="padding:35px 30px;text-align:center;">
        
        <h2 style="color:#111827;font-size:20px;">
          Merci pour votre engagement 🤝
        </h2>

        <p style="color:#4B5563;font-size:15px;line-height:1.6;max-width:480px;margin:auto;">
          Bonjour <strong>${name}</strong>,<br/><br/>
          Nous vous remercions pour votre contribution à la campagne :
          <br/><br/>
          <strong style="color:#FF6EA9;">${campaignTitle}</strong>
        </p>

        <!-- AMOUNT -->
        <div style="margin:25px 0;">
          <div style="font-size:14px;color:#6B7280;">Montant contribué</div>
          <div style="font-size:26px;font-weight:700;color:#111827;">
            ${Number(amount).toLocaleString()} FCFA
          </div>
        </div>

        <!-- CODE -->
        <div style="margin:30px 0;">
          <div style="font-size:14px;color:#6B7280;margin-bottom:10px;">
            Votre code d’accès sécurisé
          </div>

          <div style="
            display:inline-block;
            font-size:22px;
            font-weight:700;
            letter-spacing:2px;
            color:#FF6EA9;
            background:#FFF0F5;
            padding:14px 24px;
            border-radius:12px;
          ">
            ${accessCode}
          </div>
        </div>

        <p style="color:#6B7280;font-size:14px;line-height:1.6;">
          Ce code vous permettra d’accéder aux données et statistiques
          liées à cette campagne.<br/>
          Veuillez le conserver de manière confidentielle.
        </p>

      </div>

      <!-- FOOTER -->
      <div style="background:#fafafa;padding:25px;text-align:center;">
        
        <p style="font-size:14px;color:#6B7280;margin-bottom:15px;">
          Suivez-nous
        </p>

        <!-- SOCIAL ICONS -->
        <div style="margin-bottom:15px;">

          <a href="https://www.instagram.com/toncompte" style="margin:0 8px;">
            <img src="https://cdn.simpleicons.org/instagram/E4405F" width="20"/>
          </a>

          <a href="https://www.facebook.com/toncompte" style="margin:0 8px;">
            <img src="https://cdn.simpleicons.org/facebook/1877F2" width="20"/>
          </a>

          <a href="https://www.linkedin.com/in/toncompte" style="margin:0 8px;">
            <img src="https://cdn.simpleicons.org/linkedin/0077B5" width="20"/>
          </a>

          <a href="https://x.com/toncompte" style="margin:0 8px;">
            <img src="https://cdn.simpleicons.org/x/000000" width="20"/>
          </a>

          <a href="https://www.tiktok.com/@toncompte" style="margin:0 8px;">
            <img src="https://cdn.simpleicons.org/tiktok/000000" width="20"/>
          </a>

        </div>

        <p style="font-size:12px;color:#9CA3AF;">
          © ${new Date().getFullYear()} E·Doto Family — Tous droits réservés
        </p>

      </div>

    </div>
  </div>
  `;
  }
  async register(dto: RegisterDto, userId: number) {

    // 1) Vérifier campagne
    const [rows]: [RowDataPacket[], any] = await this.databaseService.getPool().query(
      `SELECT id FROM campaigns WHERE id = ?`,
      [dto.campaign_id]
    );
    if (!rows.length) throw new NotFoundException('Campagne introuvable');

    // Ville du participant : obligatoire et parmi les villes de la campagne (décision du 24/09/2026)
    const wantedCity = typeof dto.city === 'string' ? dto.city.trim() : '';
    if (!wantedCity) throw new BadRequestException('Indiquez votre ville.');
    const [cityRows]: [RowDataPacket[], any] = await this.databaseService.getPool().query(
      `SELECT city FROM campaign_locations WHERE campaign_id = ? AND LOWER(city) = LOWER(?) LIMIT 1`,
      [dto.campaign_id, wantedCity]
    );
    if (!cityRows.length) throw new BadRequestException("Cette campagne ne se déroule pas dans cette ville.");
    const city = cityRows[0].city;
    // Récupérer le nom du centre de retrait
    const [center]: [RowDataPacket[], any] = await this.databaseService.getPool().query(
      `SELECT name, role, is_active, pickup_approved FROM users WHERE id = ?`,
      [dto.pickup_center]
    );

    if (!center.length) {
      throw new NotFoundException("Centre de retrait introuvable");
    }
    // Même règle que pour les commandes : point en attente de validation ou bloqué non sélectionnable
    if (center[0].role === 'super_pickuppoint') {
      if (Number(center[0].pickup_approved) === 0) throw new NotFoundException("Centre de retrait introuvable");
      if (Number(center[0].is_active) === 0) {
        throw new BadRequestException('Ce point de retrait est actuellement bloqué.');
      }
    }

    const pickupCenterName = center[0].name;
    // 2) Récup user
    const [user]: [RowDataPacket[], any] = await this.databaseService.getPool().query(
      `SELECT name, email FROM users WHERE id = ?`,
      [userId]
    );
    if (!user.length) throw new NotFoundException('Utilisateur introuvable');

    const fullName = user[0].name;
    const email = user[0].email;

    // 3) Vérifier si déjà inscrit
    const [existing]: [RowDataPacket[], any] = await this.databaseService.getPool().query(
      `SELECT id FROM campaign_registrations 
     WHERE campaign_id = ? AND email = ?`,
      [dto.campaign_id, email]
    );
    if (existing.length > 0) {
      throw new BadRequestException("Vous êtes déjà inscrit à cette campagne.");
    }

    // 4) Enregistrer la participation
    const [result]: any = await this.databaseService.getPool().query(
      `INSERT INTO campaign_registrations
     (campaign_id, full_name, email, pickup_center, city)
     VALUES (?, ?, ?, ?, ?)`,
      [dto.campaign_id, fullName, email, dto.pickup_center, city]
    );

    const registrationId = result.insertId;

    // 5) Générer OTP
    const otp = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + CAMPAIGN_OTP_TTL_MS);

    // 6) Enregistrer OTP
    await this.databaseService.getPool().query(
      `UPDATE campaign_registrations
     SET otp_code=?, otp_used=0, otp_attempts=0, order_status = 'order-processing', otp_expires_at=?, updated_at=NOW()
     WHERE id=?`,
      [otp, expiresAt, registrationId]
    );

    // L'ancien compteur distributed_kits n'est plus utilisé : inscrits et kits retirés sont
    // comptés dans campaign_registrations.

    // 7) Envoyer OTP par email
    try {
      await sendVerificationEmail({
        email,
        subject: CAMPAIGN_OTP_EMAIL_SUBJECT,
        message: buildCampaignOtpEmail(pickupCenterName, otp)
      });

    } catch (e) {
      console.error(e);
      throw new Error("Impossible d’envoyer le code OTP : " + e);
    }

    return {
      id: registrationId,
      otp, // 💡 Facultatif
      message: "Inscription enregistrée. Un code OTP vous a été envoyé."
    };
  }

  // Inscriptions de l'utilisateur connecté (rattachées par e-mail, comme à l'inscription).
  // Le code n'est pas renvoyé : il est transmis uniquement par e-mail.
  async getMyRegistrations(userId: number) {
    const pool = this.databaseService.getPool();
    const [users]: [RowDataPacket[], any] = await pool.query(`SELECT email FROM users WHERE id = ?`, [userId]);
    if (!users.length) throw new NotFoundException('Utilisateur introuvable');

    const [rows]: [RowDataPacket[], any] = await pool.query(
      `SELECT r.id, r.campaign_id, c.title AS campaign_title, c.location AS campaign_location,
              r.pickup_center, pc.name AS pickup_center_name, pc.pickup_lat, pc.pickup_lng,
              r.otp_used, r.otp_expires_at, r.verified_at, r.picked_up, r.picked_up_at,
              r.order_status, r.created_at
       FROM campaign_registrations r
       JOIN campaigns c ON c.id = r.campaign_id
       LEFT JOIN users pc ON pc.id = r.pickup_center
       WHERE r.email = ?
       ORDER BY r.created_at DESC`,
      [users[0].email],
    );
    return rows;
  }

  // Nouveau code de retrait de kit : même règle que pour les commandes.
  // Autorisé seulement si le code a expiré et que le retrait n'a pas eu lieu
  // (code non validé par le point de retrait : otp_used = 0, et kit non remis : picked_up = 0).
  async regenerateRegistrationOtp(registrationId: number, userId: number) {
    const pool = this.databaseService.getPool();
    const [users]: [RowDataPacket[], any] = await pool.query(`SELECT email FROM users WHERE id = ?`, [userId]);
    if (!users.length) throw new NotFoundException('Utilisateur introuvable');

    const [rows]: [RowDataPacket[], any] = await pool.query(
      `SELECT r.*, pc.name AS pickup_center_name
       FROM campaign_registrations r
       LEFT JOIN users pc ON pc.id = r.pickup_center
       WHERE r.id = ? LIMIT 1`,
      [registrationId],
    );
    const reg = rows[0];
    if (!reg) throw new NotFoundException('Inscription introuvable.');
    if (reg.email !== users[0].email) throw new ForbiddenException("Vous n'avez pas accès à cette inscription.");

    if (Number(reg.picked_up) === 1 || reg.order_status === 'order-completed') {
      throw new BadRequestException('Ce kit a déjà été retiré.');
    }
    if (Number(reg.otp_used) === 1) {
      throw new BadRequestException('Votre code a déjà été validé par le point de retrait : aucun nouveau code nécessaire.');
    }
    if (['order-cancelled', 'order-refunded', 'order-failed'].includes(reg.order_status)) {
      throw new BadRequestException('Cette inscription ne peut plus être retirée.');
    }
    if (!reg.otp_code || !reg.otp_expires_at) {
      throw new BadRequestException("Aucun code de retrait n'a été émis pour cette inscription.");
    }
    if (new Date(reg.otp_expires_at).getTime() >= Date.now()) {
      throw new BadRequestException(
        `Votre code est encore valable jusqu'au ${new Date(reg.otp_expires_at).toLocaleString('fr-FR')}.`,
      );
    }

    const otp = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + CAMPAIGN_OTP_TTL_MS);
    // Conditions revérifiées dans le WHERE (validation concurrente par le point de retrait)
    const [result]: any = await pool.query(
      `UPDATE campaign_registrations
       SET otp_code = ?, otp_expires_at = ?, otp_attempts = 0, updated_at = NOW()
       WHERE id = ? AND otp_code = ? AND otp_used = 0 AND picked_up = 0`,
      [otp, expiresAt, reg.id, reg.otp_code],
    );
    if (!result?.affectedRows) {
      throw new BadRequestException("L'inscription a changé entre-temps. Rechargez la page.");
    }

    try {
      await sendVerificationEmail({
        email: reg.email,
        subject: CAMPAIGN_OTP_EMAIL_SUBJECT,
        message: buildCampaignOtpEmail(reg.pickup_center_name ?? '', otp),
      });
    } catch (e) {
      // Sans e-mail le participant ne connaîtrait pas le code : on remet l'ancien (expiré)
      await pool.query(
        `UPDATE campaign_registrations SET otp_code = ?, otp_expires_at = ? WHERE id = ? AND otp_code = ? AND otp_used = 0`,
        [reg.otp_code, reg.otp_expires_at, reg.id, otp],
      );
      throw new InternalServerErrorException("Impossible d'envoyer l'e-mail. Réessayez dans quelques instants.");
    }

    return {
      success: true,
      otp_expires_at: expiresAt,
      message: 'Un nouveau code de retrait vous a été envoyé par e-mail.',
    };
  }

  // Récupère toutes les inscriptions pour un point de retrait donné
  async getRegistrationsByPickupCenter(pickupCenterId: number) {
    const [rows]: [RowDataPacket[], any] = await this.databaseService.getPool().query(
      `SELECT * FROM campaign_registrations WHERE pickup_center = ? ORDER BY created_at DESC`,
      [pickupCenterId]
    );
    // Le point de retrait doit recevoir l'OTP du participant, pas le lire en base
    return rows.map((r) => maskOtp(r));
  }


  async getRegistrationsForCampaign(campaignId: number) {
    const [rows]: [RowDataPacket[], any] = await this.databaseService.getPool().query(
      `SELECT * FROM campaign_registrations 
       WHERE campaign_id = ? 
       ORDER BY created_at DESC`,
      [campaignId]
    );

    return rows;
  }

  async verifyCampaignOtp(dto: { registration_id: number; otp: string }, pickupUserId: number) {
    const { registration_id, otp } = dto;

    if (!registration_id || !otp) {
      throw new BadRequestException("Paramètres invalides.");
    }

    // 1) Vérifier inscription
    const [rows]: [RowDataPacket[], any] = await this.databaseService.getPool().query(
      `SELECT * FROM campaign_registrations WHERE id = ? LIMIT 1`,
      [registration_id]
    );

    if (!rows.length) throw new NotFoundException("Inscription introuvable.");

    const reg = rows[0];

    // pickup_center contient l'id du point de retrait choisi à l'inscription
    if (String(reg.pickup_center) !== String(pickupUserId)) {
      throw new NotFoundException("Inscription introuvable.");
    }

    // 2) Déjà validé ?
    if (reg.otp_used === 1) {
      throw new BadRequestException("OTP déjà utilisé.");
    }

    // 3) Expiré ?
    if (new Date(reg.otp_expires_at) < new Date()) {
      throw new BadRequestException("Code expiré. Le participant doit générer un nouveau code depuis son espace (Mes commandes).");
    }

    // 4) Trop de tentatives
    if (reg.otp_attempts >= 5) {
      throw new BadRequestException("Trop de tentatives. Contactez le support.");
    }

    // 5) Vérifier OTP
    if (reg.otp_code !== otp) {
      await this.databaseService.getPool().query(
        `UPDATE campaign_registrations SET otp_attempts = otp_attempts + 1 WHERE id = ?`,
        [registration_id]
      );
      throw new BadRequestException("Code incorrect.");
    }

    // 6) Marquer OTP comme utilisé
    await this.databaseService.getPool().query(
      `UPDATE campaign_registrations 
       SET otp_used = 1, order_status = 'order-at-local-facility', verified_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [registration_id]
    );

    return { message: "OTP validé avec succès." };
  }

  // -------------------------------------------
  //  MARK PICKUP
  // -------------------------------------------
  async markPickup(dto: { registration_id: number }, pickupUserId: number) {
    const { registration_id } = dto;

    if (!registration_id) {
      throw new BadRequestException("Paramètres invalides.");
    }

    // 1) Vérifier inscription
    const [rows]: [RowDataPacket[], any] = await this.databaseService.getPool().query(
      `SELECT * FROM campaign_registrations WHERE id = ? LIMIT 1`,
      [registration_id]
    );

    if (!rows.length) throw new NotFoundException("Inscription introuvable.");

    const reg = rows[0];

    if (String(reg.pickup_center) !== String(pickupUserId)) {
      throw new NotFoundException("Inscription introuvable.");
    }

    // 2) Vérifier OTP validé
    if (reg.otp_used !== 1) {
      throw new BadRequestException("OTP non validé — retrait impossible.");
    }

    // 3) Déjà retiré ?
    if (reg.picked_up === 1) {
      throw new BadRequestException("Déjà retiré.");
    }

    // 4) Marquer comme retiré // 4)
    // Commission du point figée au moment du retrait (montant fixe par kit)
    await this.databaseService.getPool().query(
      `UPDATE campaign_registrations r
       SET r.picked_up = 1, r.order_status = 'order-completed', r.picked_up_at = NOW(), r.updated_at = NOW(),
           r.commission_amount = ${KIT_AMOUNT_SQL}
       WHERE r.id = ?`,
      [registration_id]
    );

    return { message: "Retrait confirmé." };
  }
}
