import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { RowDataPacket } from 'mysql2';
import { DatabaseService } from '../database/database.services';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { RegisterDto } from './dto/register.dto';
import { sendVerificationEmail } from '../auth/mailer';
import { randomBytes } from 'crypto';
@Injectable()
export class CampaignsService {
  constructor(private readonly databaseService: DatabaseService) { }

  async getActiveCampaign() {
    const [rows]: [RowDataPacket[], any] = await this.databaseService.getPool().query(
      `SELECT * FROM campaigns WHERE status = 'en_cours' ORDER BY date_start DESC`
    );
    if (!rows.length) return null;
    return rows;
  }

  async getUpcomingCampaigns() {
    const [rows]: [RowDataPacket[], any] = await this.databaseService.getPool().query(
      `SELECT * FROM campaigns WHERE status IN ('a_venir', 'planifie') ORDER BY date_start ASC`
    );
    return rows;
  }
  async getActiveCampaignsCount() {
    const [rows]: [RowDataPacket[], any] =
      await this.databaseService.getPool().query(
        `SELECT COUNT(*) as total FROM campaigns WHERE status='en_cours'`
      );

    return rows[0];
  }
  async getActiveCampaignByCity(city: string) {
    const [rows]: [RowDataPacket[], any] =
      await this.databaseService.getPool().query(
        `SELECT * FROM campaigns 
       WHERE status = 'en_cours' 
       AND LOWER(location) = LOWER(?) 
       ORDER BY date_start DESC`,
        [city]
      );

    return rows;
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

  async getAllCampaigns(page = 1, limit = 10, orderBy = 'created_at', sortedBy: 'ASC' | 'DESC' = 'DESC') {
  const offset = (page - 1) * limit;

  const [rows]: [RowDataPacket[], any] =
    await this.databaseService.getPool().query(
      `SELECT * FROM campaigns 
       ORDER BY ${orderBy} ${sortedBy}
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

  const [count]: [RowDataPacket[], any] =
    await this.databaseService.getPool().query(
      `SELECT COUNT(*) as total FROM campaigns`
    );

  return {
    data: rows,
    total: count[0].total,
    currentPage: page,
    perPage: limit
  };
}
  // get campaign by id
  async getCampaignById(id: number) {
    const [rows]: [RowDataPacket[], any] = await this.databaseService.getPool().query(
      `SELECT * FROM campaigns WHERE id = ?`,
      [id]
    );
    if (!rows.length) throw new NotFoundException('Campagne introuvable');
    return rows[0];
  }


  async createCampaign(dto: CreateCampaignDto) {
    try {
      const [result]: any = await this.databaseService.getPool().query(
        `INSERT INTO campaigns
      (title, description, image_url, location, date_start, date_end, status, objective_kits)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          dto.title,
          dto.description ?? null,
          dto.image_url ?? null,
          dto.location,
          dto.date_start,
          dto.date_end ?? null,
          dto.status ?? 'a_venir',
          dto.objective_kits ?? 0
        ]
      );

      const campaignId = result.insertId;

      // 👉 Sponsors
      if (Array.isArray(dto.sponsors) && dto.sponsors.length > 0) {
        for (const sponsor of dto.sponsors) {
          if (!sponsor?.email || !sponsor?.name) continue;

          const accessCode = randomBytes(16).toString('hex');

          await this.databaseService.getPool().query(
            `INSERT INTO campaign_sponsors 
          (campaign_id, name, email, amount, access_code)
          VALUES (?, ?, ?, ?, ?)`,
            [
              campaignId,
              sponsor.name,
              sponsor.email,
              sponsor.amount ?? 0,
              accessCode
            ]
          );

          // 👉 Email (ne bloque pas si erreur)
          try {
            await sendVerificationEmail({
              email: sponsor.email,
              subject: `Accès sponsor – ${dto.title}`,
              message: this.buildSponsorEmail({
                name: sponsor.name,
                campaignTitle: dto.title,
                amount: sponsor.amount,
                accessCode
              })
            });
          } catch (e) {
            console.error("Erreur email sponsor:", e);
          }
        }
      }

      return {
        id: campaignId,
        message: 'Campagne créée avec succès.'
      };

    } catch (error) {
      throw new InternalServerErrorException(
        'Erreur lors de la création de la campagne'
      );
    }
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
  async updateStatus(id: number, dto: UpdateStatusDto) {
    const [res]: any = await this.databaseService.getPool().query(
      `UPDATE campaigns SET status = ? WHERE id = ?`,
      [dto.status, id]
    );
    if (res.affectedRows === 0) throw new NotFoundException('Campagne introuvable');
    return { message: 'Statut mis à jour.' };
  }

  async register(dto: RegisterDto, userId: number) {

    // 1) Vérifier campagne
    const [rows]: [RowDataPacket[], any] = await this.databaseService.getPool().query(
      `SELECT id FROM campaigns WHERE id = ?`,
      [dto.campaign_id]
    );
    if (!rows.length) throw new NotFoundException('Campagne introuvable');
    // Récupérer le nom du centre de retrait
    const [center]: [RowDataPacket[], any] = await this.databaseService.getPool().query(
      `SELECT name FROM users WHERE id = ?`,
      [dto.pickup_center]
    );

    if (!center.length) {
      throw new NotFoundException("Centre de retrait introuvable");
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
     (campaign_id, full_name, email, pickup_center)
     VALUES (?, ?, ?, ?)`,
      [dto.campaign_id, fullName, email, dto.pickup_center]
    );

    const registrationId = result.insertId;

    // 5) Générer OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    // 6) Enregistrer OTP
    await this.databaseService.getPool().query(
      `UPDATE campaign_registrations
     SET otp_code=?, otp_used=0, otp_attempts=0, order_status = 'order-processing', otp_expires_at=?, updated_at=NOW()
     WHERE id=?`,
      [otp, expiresAt, registrationId]
    );

    // 8) Ajouter +1 aux kits distribués
    await this.databaseService.getPool().query(
      `UPDATE campaigns SET distributed_kits = distributed_kits + 1 WHERE id = ?`,
      [dto.campaign_id]
    );

    // 7) Envoyer OTP par email
    try {
      await sendVerificationEmail({
        email,
        subject: `Code de retrait de campagne - E·Doto Family`,
        message: `
  <div style="font-family: 'Inter', Arial, sans-serif; max-width: 640px; margin: auto; background: #ffffff; border-radius: 16px; overflow: hidden;">

    <!-- HEADER -->
    <div style="background: linear-gradient(135deg, #fff5f8, #ffe4ef); padding: 32px 24px; text-align: center;">
      <img src="https://edotofamily.netlify.app/images/edotofamily6.1.png" alt="E·Doto Family" style="height: 72px;" />
      <h1 style="color: #FF6EA9; font-size: 22px; font-weight: 700;">Retrait de votre kit gratuit</h1>
    </div>

    <!-- CONTENT. --> 
    <div style="padding: 40px 30px; text-align: center;">
      <h2 style="color: #111827; font-size: 20px;">Votre code de retrait 🎁</h2>

      <p style="color: #4B5563; font-size: 15px; max-width: 460px; margin: auto;">
        Vous êtes inscrit la campagne de kits SSR. </strong>.<br/>
        Pour retirer votre kit gratuit, rendez-vous au point de retrait :
        <br/><br/>
        <strong style="color:#FF6EA9; font-size:16px;">${pickupCenterName}</strong>
      </p>

      <div style="font-size: 28px; font-weight: 700; color: #FF6EA9; margin: 30px 0; background: #FFF0F5; padding: 14px 24px; border-radius: 12px;">
        ${otp}
      </div>

      <p style="color: #6B7280; font-size: 14px;">
        Présentez ce code à l’agent sur place pour récupérer votre kit.<br/>
        Le code est valable <strong>48 heures</strong>.<br/>
        Gardez-le confidentiel.
      </p>
    </div>

    <!-- FOOTER -->
    <div style="background: #fafafa; padding: 20px; text-align: center;">
      <p style="color: #9CA3AF; font-size: 12px;">
        © ${new Date().getFullYear()} E·Doto Family — Tous droits réservés
      </p>
    </div>

  </div>
  `
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

  // Récupère toutes les inscriptions pour un point de retrait donné
  async getRegistrationsByPickupCenter(pickupCenterId: number) {
    const [rows]: [RowDataPacket[], any] = await this.databaseService.getPool().query(
      `SELECT * FROM campaign_registrations WHERE pickup_center = ? ORDER BY created_at DESC`,
      [pickupCenterId]
    );
    return rows;
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

  async verifyCampaignOtp(dto: { registration_id: number; otp: string }) {
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

    // 2) Déjà validé ?
    if (reg.otp_used === 1) {
      throw new BadRequestException("OTP déjà utilisé.");
    }

    // 3) Expiré ?
    if (new Date(reg.otp_expires_at) < new Date()) {
      throw new BadRequestException("Code expiré.");
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
  async markPickup(dto: { registration_id: number }) {
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

    // 2) Vérifier OTP validé
    if (reg.otp_used !== 1) {
      throw new BadRequestException("OTP non validé — retrait impossible.");
    }

    // 3) Déjà retiré ?
    if (reg.picked_up === 1) {
      throw new BadRequestException("Déjà retiré.");
    }

    // 4) Marquer comme retiré // 4)
    await this.databaseService.getPool().query(
      `UPDATE campaign_registrations
       SET picked_up = 1, order_status = 'order-completed', picked_up_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [registration_id]
    );

    return { message: "Retrait confirmé." };
  }
}
