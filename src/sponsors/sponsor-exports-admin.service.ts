import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { sendVerificationEmail } from '../auth/mailer';

const UTC_FMT = '%Y-%m-%d %H:%i:%s';
const iso = (u: string | null) => (u ? `${u.replace(' ', 'T')}Z` : null);

function decisionEmail(name: string, title: string, approved: boolean, reason: string | null, link: string) {
  return `
  <div style="font-family: Inter, Arial, sans-serif; max-width: 620px; margin: auto; background: #fff; border-radius: 16px; overflow: hidden; border: 1px solid #f1ece4;">
    <div style="background: #1f1b16; padding: 24px; text-align: center;">
      <p style="color: #fff; font-size: 20px; margin: 0; font-family: Poppins, Arial, sans-serif;">E.doto family · Espace sponsor</p>
    </div>
    <div style="padding: 28px; color: #1f1b16; font-size: 15px; line-height: 1.6;">
      <p>Bonjour <strong>${name}</strong>,</p>
      <p>Votre demande d'export des données de la campagne <strong>${title}</strong> a été
        <strong style="color: ${approved ? '#3f6b45' : '#9b2c2c'};">${approved ? 'acceptée' : 'refusée'}</strong>.</p>
      ${approved ? `<p>Vous pouvez télécharger le fichier Excel depuis votre espace sponsor, rubrique « Exports ».</p>` : ''}
      ${!approved && reason ? `<p>Motif : ${reason}</p>` : ''}
      <p><a href="${link}" style="color: #c2185b;">Ouvrir mon espace sponsor</a></p>
    </div>
  </div>`;
}

// Validation des demandes d'export des sponsors (admin)
@Injectable()
export class SponsorExportsAdminService {
  constructor(private readonly db: DatabaseService) { }

  async list(status?: string) {
    const filter = ['pending', 'approved', 'rejected'].includes(status as string) ? 'WHERE er.status = ?' : '';
    const [rows]: any = await this.db.getPool().query(
      `SELECT er.id, er.status, er.reason, er.campaign_id, c.title AS campaign_title, s.id AS sponsor_id, s.name AS sponsor_name, s.email AS sponsor_email,
              DATE_FORMAT(er.requested_at, '${UTC_FMT}') AS requested_at, DATE_FORMAT(er.decided_at, '${UTC_FMT}') AS decided_at,
              u.name AS decided_by_name
       FROM sponsor_export_requests er
       JOIN campaigns c ON c.id = er.campaign_id
       JOIN sponsors s ON s.id = er.sponsor_id
       LEFT JOIN users u ON u.id = er.decided_by
       ${filter}
       ORDER BY (er.status = 'pending') DESC, er.requested_at DESC`,
      filter ? [status] : [],
    );
    return rows.map((r: any) => ({ ...r, requested_at: iso(r.requested_at), decided_at: iso(r.decided_at) }));
  }

  private async decide(id: number, adminId: number, approved: boolean, reasonRaw?: any) {
    const reason = typeof reasonRaw === 'string' ? reasonRaw.trim() : '';
    if (!approved && !reason) throw new BadRequestException('Indiquez le motif du refus.');
    if (reason.length > 500) throw new BadRequestException('Motif trop long (500 caractères max).');
    const pool = this.db.getPool();
    const [[req]]: any = await pool.query(
      `SELECT er.id, er.status, c.title, s.name, s.email FROM sponsor_export_requests er
       JOIN campaigns c ON c.id = er.campaign_id JOIN sponsors s ON s.id = er.sponsor_id WHERE er.id = ?`,
      [id],
    );
    if (!req) throw new NotFoundException('Demande introuvable.');
    if (req.status !== 'pending') throw new BadRequestException('Cette demande a déjà été traitée.');
    const [res]: any = await pool.query(
      `UPDATE sponsor_export_requests SET status = ?, reason = ?, decided_at = NOW(), decided_by = ? WHERE id = ? AND status = 'pending'`,
      [approved ? 'approved' : 'rejected', approved ? null : reason, adminId, id],
    );
    if (!res?.affectedRows) throw new BadRequestException('Cette demande a déjà été traitée.');

    // Le sponsor est prévenu par e-mail (et par la cloche de son espace) ; un échec d'envoi n'annule pas la décision
    let emailSent = true;
    try {
      const base = (process.env.FRONTEND_CALLBACK_URL || '').replace(/\/+$/, '');
      await sendVerificationEmail({
        email: req.email,
        subject: `Export ${approved ? 'accepté' : 'refusé'} · ${req.title}`,
        message: decisionEmail(req.name, req.title, approved, approved ? null : reason, `${base}/sponsor`),
      });
    } catch (e) {
      console.error('Erreur e-mail décision export :', e);
      emailSent = false;
    }
    return { success: true, email_sent: emailSent, message: approved ? 'Export autorisé.' : 'Demande refusée.' };
  }

  approve(id: number, adminId: number) {
    return this.decide(id, adminId, true);
  }

  reject(id: number, adminId: number, reason: any) {
    return this.decide(id, adminId, false, reason);
  }
}
