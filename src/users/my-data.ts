import { Body, Controller, ForbiddenException, Get, Injectable, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Response } from 'express';
import { DatabaseService } from '../database/database.services';
import { HEALTH_FIELDS, openFields } from '../common/health-crypto';
import { realClientIp } from '../common/client-ip';
import { safeError } from '../common/request-log';
import { StrictDto, IsScalar } from '../common/strict-body';
import { IsOptional } from 'class-validator';
import { SensitiveAction } from '../auth/step-up';
import { InactivityService } from './inactivity';

/**
 * Droits des personnes (autorisation APDP n° 2026-327/AT/APDP/DST/SC, point f ; art. 437 à 443 du Code du numérique ;
 * 30/10/2026). Depuis « Mon profil » :
 * - accès et portabilité : GET /me/data-export, fichier JSON de toutes les données du compte (santé déchiffrée) ;
 * - suppression : POST /me/delete-account (mot de passe redemandé), même effacement que la conservation (inactivity.ts) :
 *   l'identité est effacée, commandes et paiements restent (obligation légale), le dossier de santé ne reste lié
 *   qu'au numéro de compte. Réservé aux comptes jeunes ; les autres comptes écrivent à l'équipe (commissions,
 *   campagnes, consultations en cours).
 * Rectification : PATCH /me/profile (existant). Chaque demande est notée dans data_rights_log (migration 023).
 */
export const SELF_DELETE_ROLES = ['customer'];
export const RIGHTS_CONTACT = 'contact@edotofamily.com';

// Jamais dans le fichier : secrets, codes de retrait, empreintes, salles de visio
const HIDDEN_KEY = /password|secret|token|otp|hash|totp|room|slot_lock/i;

export function cleanRow(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row || {})) if (!HIDDEN_KEY.test(k)) out[k] = v;
  return out;
}

@StrictDto()
export class DeleteAccountDto {
  @IsOptional() @IsScalar() password?: string;
}

async function logRight(pool: any, userId: number, kind: 'export' | 'delete', ip: string | null) {
  try {
    await pool.query(`INSERT INTO data_rights_log (user_id, kind, ip, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP())`, [userId, kind, ip]);
  } catch (err) {
    console.error(`[droits] demande non notée (compte ${userId}, ${kind}) :`, safeError(err));
  }
}

@Injectable()
export class MyDataService {
  constructor(private readonly db: DatabaseService, private readonly inactivity: InactivityService) {}

  private get pool(): any {
    return this.db.getPool();
  }

  /** Une partie du fichier ; une table illisible est signalée au lieu d'être omise sans le dire */
  private async section(sql: string, params: any[], health?: readonly string[]) {
    try {
      const [rows]: any = await this.pool.query(sql, params);
      return (rows || []).map((r: any) => cleanRow(health ? openFields(r, health) : r));
    } catch (err) {
      console.error('[droits] partie du fichier illisible :', safeError(err));
      return { indisponible: 'Cette partie n’a pas pu être lue ; écrivez-nous pour la recevoir.' };
    }
  }

  async exportData(userId: number, ip: string | null) {
    const [[user]]: any = await this.pool.query(
      `SELECT id, name, email, role, birth_date, sex, pickup_city, pickup_address, is_verified, email_verified_at,
              created_at, updated_at, last_activity_at
       FROM users WHERE id = ? AND anonymized_at IS NULL`,
      [userId],
    );
    if (!user) throw new UnauthorizedException('Compte introuvable.');
    const reqs = await this.section(
      `SELECT * FROM contraception_requests WHERE user_id = ? ORDER BY id`, [userId], HEALTH_FIELDS.contraception_requests,
    );
    const ids = Array.isArray(reqs) ? reqs.map((r: any) => r.id) : [];
    const data = {
      document: 'Vos données sur E.doto family (art. 437 et 438 du Code du numérique)',
      generated_at: new Date().toISOString(),
      contact: RIGHTS_CONTACT,
      account: cleanRow(user),
      profile: await this.section(`SELECT * FROM profiles WHERE customer_id = ?`, [userId]),
      addresses: await this.section(`SELECT * FROM addresses WHERE customer_id = ?`, [userId]),
      consents: await this.section(`SELECT document, version, ip, accepted_at FROM user_consents WHERE user_id = ? ORDER BY id`, [userId]),
      orders: await this.section(`SELECT * FROM orders WHERE customer_id = ? ORDER BY id`, [userId]),
      kit_requests: await this.section(`SELECT * FROM campaign_registrations WHERE LOWER(email) = LOWER(?) ORDER BY id`, [user.email]),
      teleconsultations: await this.section(`SELECT * FROM tc_appointments WHERE patient_user_id = ? ORDER BY id`, [userId]),
      consultation_reports: await this.section(`SELECT * FROM tc_reports WHERE patient_user_id = ? ORDER BY id`, [userId], HEALTH_FIELDS.tc_reports),
      referrals: await this.section(`SELECT * FROM tc_referrals WHERE patient_user_id = ? ORDER BY id`, [userId], HEALTH_FIELDS.tc_referrals),
      contraception_requests: reqs,
      contraception_followups: ids.length
        ? await this.section(
            `SELECT * FROM contraception_followups WHERE request_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
            ids,
            HEALTH_FIELDS.contraception_followups,
          )
        : [],
      rights_requests: await this.section(`SELECT kind, created_at FROM data_rights_log WHERE user_id = ? ORDER BY id`, [userId]),
    };
    await logRight(this.pool, userId, 'export', ip);
    return data;
  }

  async deleteAccount(userId: number, password: unknown, ip: string | null) {
    const [[user]]: any = await this.pool.query(`SELECT id, role, password FROM users WHERE id = ? AND anonymized_at IS NULL`, [userId]);
    if (!user) throw new UnauthorizedException('Compte introuvable.');
    if (!SELF_DELETE_ROLES.includes(String(user.role))) {
      throw new ForbiddenException(
        `Pour supprimer ce type de compte, écrivez à ${RIGHTS_CONTACT} : nous réglons d'abord les commissions, campagnes ou consultations en cours.`,
      );
    }
    const ok = typeof password === 'string' && password.length > 0 && !!user.password && (await bcrypt.compare(password, String(user.password)));
    if (!ok) throw new UnauthorizedException('Mot de passe incorrect.');
    await logRight(this.pool, userId, 'delete', ip);
    await this.inactivity.anonymize(userId);
    return { success: true, message: 'Votre compte est supprimé. Les commandes et paiements restent gardés pour la durée imposée par la loi, sans votre identité.' };
  }
}

// Utilisateur fourni par le guard JWT global
@Controller('me')
export class MyDataController {
  constructor(private readonly service: MyDataService) {}

  @Get('data-export')
  async exportData(@Req() req: any, @Res() res: Response) {
    const data = await this.service.exportData(Number(req.user?.id), realClientIp(req));
    res.setHeader('Content-Disposition', `attachment; filename="mes-donnees-edoto-family-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  }

  @SensitiveAction() // audit 3.1 : code redemandé si la double authentification est active
  @Post('delete-account')
  deleteAccount(@Req() req: any, @Body() body: DeleteAccountDto) {
    return this.service.deleteAccount(Number(req.user?.id), body?.password, realClientIp(req));
  }
}
