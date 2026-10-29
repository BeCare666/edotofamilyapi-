import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import * as QRCode from 'qrcode';
import { DatabaseService } from '../database/database.services';
import { openHealth, sealHealth } from '../common/health-crypto';
import { hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUrl, totpRequiredRoles, verifyTotp } from './totp';

/**
 * Double authentification (audit sécurité 3.1, 29/10/2026).
 * Connexion : mot de passe correct → « défi » (jeton de 5 min, clé distincte de celle des sessions)
 * → code à 6 chiffres ou code de secours → session.
 * Obligatoire pour les rôles de TOTP_ROLES ; toujours demandée à un compte qui l'a activée.
 */
export const TOTP_CHALLENGE_PURPOSE = 'totp-login';
const CHALLENGE_TTL = '5m';

// Clé distincte : un défi ne peut jamais être accepté comme jeton de session (et inversement)
function challengeKey(): string {
  return `${process.env.JWT_SECRET_KEY}:${TOTP_CHALLENGE_PURPOSE}`;
}

export type TotpChallenge = { totp_required: true; setup_required: boolean; challenge: string };

@Injectable()
export class TotpService {
  constructor(private readonly db: DatabaseService) {}

  private get pool(): any {
    return this.db.getPool();
  }

  isEnabled(user: any): boolean {
    return !!user?.totp_enabled_at && !!user?.totp_secret;
  }

  /** Défi à renvoyer à la place de la session, ou null si la double authentification ne s'applique pas */
  challengeFor(user: any): TotpChallenge | null {
    const enabled = this.isEnabled(user);
    if (!enabled && !totpRequiredRoles().includes(user?.role)) return null;
    const challenge = jwt.sign(
      { id: user.id, purpose: TOTP_CHALLENGE_PURPOSE, tv: Number(user.token_version) || 0 },
      challengeKey(),
      { expiresIn: CHALLENGE_TTL },
    );
    return { totp_required: true, setup_required: !enabled, challenge };
  }

  /** Défi → compte (relu en base) ; défi expiré, falsifié ou session révoquée depuis : refusé */
  async userFromChallenge(challenge: unknown): Promise<any> {
    let payload: any;
    try {
      payload = jwt.verify(String(challenge || ''), challengeKey());
    } catch {
      throw new UnauthorizedException('Connexion expirée : saisissez de nouveau votre mot de passe.');
    }
    if (payload?.purpose !== TOTP_CHALLENGE_PURPOSE) throw new UnauthorizedException('Connexion expirée : saisissez de nouveau votre mot de passe.');
    const [[user]]: any = await this.pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [Number(payload.id)]);
    if (!user || Number(user.token_version || 0) !== Number(payload.tv)) {
      throw new UnauthorizedException('Connexion expirée : saisissez de nouveau votre mot de passe.');
    }
    return user;
  }

  /** Code de l'application (une seule fois par période) ou code de secours (une seule fois) */
  async checkCode(user: any, code: unknown): Promise<'totp' | 'recovery'> {
    const secret = String(openHealth(user.totp_secret) || '');
    const step = secret ? verifyTotp(secret, code) : null;
    if (step !== null) {
      const [res]: any = await this.pool.query(
        'UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)',
        [step, user.id, step],
      );
      if (res?.affectedRows) return 'totp';
      throw new UnauthorizedException('Ce code a déjà servi : attendez le suivant (30 s).');
    }
    const [res]: any = await this.pool.query(
      'UPDATE totp_recovery_codes SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND code_hash = ? AND used_at IS NULL',
      [user.id, hashRecoveryCode(code)],
    );
    if (res?.affectedRows) return 'recovery';
    throw new UnauthorizedException('Code incorrect.');
  }

  /** Étape 1 de l'activation : nouvelle clé (remplace une clé non activée), lien et code QR */
  async startSetup(user: any) {
    if (this.isEnabled(user)) throw new BadRequestException('La double authentification est déjà activée.');
    const secret = newTotpSecret();
    await this.pool.query('UPDATE users SET totp_secret = ?, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?', [sealHealth(secret), user.id]);
    const url = otpauthUrl(secret, user.email);
    const qr = await QRCode.toDataURL(url, { width: 280, margin: 1, errorCorrectionLevel: 'M' });
    return { secret, otpauth_url: url, qr_image: qr };
  }

  /** Étape 2 : premier code juste → activée ; renvoie les codes de secours (montrés une seule fois) */
  async activate(user: any, code: unknown): Promise<string[]> {
    if (this.isEnabled(user)) throw new BadRequestException('La double authentification est déjà activée.');
    const secret = String(openHealth(user.totp_secret) || '');
    if (!secret) throw new BadRequestException('Commencez par scanner le code QR.');
    const step = verifyTotp(secret, code);
    if (step === null) throw new BadRequestException('Code incorrect : vérifiez l’heure du téléphone et réessayez.');
    const codes = newRecoveryCodes();
    await this.pool.query('DELETE FROM totp_recovery_codes WHERE user_id = ?', [user.id]);
    await this.pool.query(
      `INSERT INTO totp_recovery_codes (user_id, code_hash) VALUES ${codes.map(() => '(?, ?)').join(', ')}`,
      codes.flatMap((c) => [user.id, hashRecoveryCode(c)]),
    );
    await this.pool.query('UPDATE users SET totp_enabled_at = UTC_TIMESTAMP(), totp_last_step = ? WHERE id = ?', [step, user.id]);
    return codes;
  }

  async status(userId: number) {
    const [[u]]: any = await this.pool.query('SELECT role, totp_secret, totp_enabled_at FROM users WHERE id = ? LIMIT 1', [userId]);
    const [[r]]: any = await this.pool.query('SELECT COUNT(*) AS n FROM totp_recovery_codes WHERE user_id = ? AND used_at IS NULL', [userId]);
    return {
      enabled: this.isEnabled(u),
      required: totpRequiredRoles().includes(u?.role),
      recovery_codes_left: Number(r?.n || 0),
    };
  }

  /** Désactivation : seulement si le rôle ne l'exige pas, et avec un code valide */
  async disable(user: any, code: unknown) {
    if (totpRequiredRoles().includes(user.role)) throw new BadRequestException('La double authentification est obligatoire pour ce compte.');
    if (!this.isEnabled(user)) throw new BadRequestException('La double authentification n’est pas activée.');
    await this.checkCode(user, code);
    await this.pool.query('UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?', [user.id]);
    await this.pool.query('DELETE FROM totp_recovery_codes WHERE user_id = ?', [user.id]);
  }

  async userById(id: number) {
    const [[u]]: any = await this.pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
    if (!u) throw new UnauthorizedException('Compte introuvable.');
    return u;
  }
}
