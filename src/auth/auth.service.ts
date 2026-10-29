

import {
  ForbiddenException,
  BadRequestException,
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
  Optional,
} from '@nestjs/common';
import { checkPassword, cleanBirthDate, cleanEmail, cleanName, cleanOrgName, cleanSex } from '../common/field-rules';
import * as bcrypt from 'bcrypt';
import { bumpTokenVersion, isBlocked, sessionStart, signEmailVerification, signSession } from './session';
import {
  AuthResponse,
  ChangePasswordDto,
  ForgetPasswordDto,
  LoginDto,
  CoreResponse,
  RegisterDto,
  ResetPasswordDto,
  VerifyForgetPasswordDto,
  SocialLoginDto,
  OtpLoginDto,
  OtpResponse,
  VerifyOtpDto,
  OtpDto,
} from './dto/create-auth.dto';
import { User } from 'src/users/entities/user.entity';
import { DatabaseService } from '../database/database.services';
import { sendVerificationEmail } from './mailer';
import { allowAttempt } from '../sponsors/sponsor-rules';
import {
  RESET_CODE_TTL_MINUTES,
  RESET_INVALID_MESSAGE,
  RESET_MAX_ATTEMPTS,
  RESET_REQUEST_LIMITS,
  RESET_REQUEST_MESSAGE,
  hashResetCode,
  newResetCode,
  normalizeResetEmail,
  resetCodeMatches,
} from './password-reset-rules';
import * as jwt from 'jsonwebtoken';
import { RowDataPacket } from 'mysql2';
import { omitPassword } from '../common/sanitize';
import {
  buildCustomerVerificationEmail,
  buildPickupVerificationEmail,
  CUSTOMER_VERIFICATION_SUBJECT,
  PICKUP_VERIFICATION_SUBJECT,
} from './verification-emails';
import { safeError } from '../common/request-log';
import { TotpChallenge, TotpService } from './totp.service';
// Audit 1.5 : messages de connexion
export const INVALID_CREDENTIALS = 'Identifiants invalides';
export const ACCOUNT_DISABLED = "Votre compte est désactivé. Contactez l'équipe E.doto family.";
// Audit 3.8 (29/10/2026) : e-mail confirmé obligatoire pour les rôles sensibles
export const EMAIL_VERIFIED_ROLES = ['super_admin', 'doctor', 'health_center', 'sponsor'];
export const EMAIL_NOT_VERIFIED = "Confirmez d'abord votre adresse e-mail : utilisez le lien reçu par e-mail ou demandez-en un nouveau.";

// Anti-abus du renvoi : un e-mail au plus par adresse et par minute (mémoire du processus)
const RESEND_COOLDOWN_MS = 60 * 1000;
const lastResendAt = new Map<string, number>();

// Lien de confirmation : même jeton que l'inscription (JWT { email }, 5 minutes)
export async function sendVerificationLink(user: { email: string; name?: string; role?: string }) {
  const verificationToken = signEmailVerification(user.email);
  const verificationLink = `${process.env.BASE_URL}/verify-email?token=${verificationToken}`;
  const isPickup = user.role === 'super_pickuppoint';
  await sendVerificationEmail({
    email: user.email,
    subject: isPickup ? PICKUP_VERIFICATION_SUBJECT : CUSTOMER_VERIFICATION_SUBJECT,
    message: isPickup
      ? buildPickupVerificationEmail(user.name ?? '', verificationLink)
      : buildCustomerVerificationEmail(verificationLink),
  });
}

@Injectable()
export class AuthService {
  constructor(
    private readonly DatabaseService: DatabaseService,
    @Optional() private readonly totpService?: TotpService,
  ) { }

  // Audit 3.1 : double authentification (créée à la demande dans les tests qui ne passent que la base)
  private get totp(): TotpService {
    return this.totpService ?? new TotpService(this.DatabaseService);
  }

  // Renvoi du lien de confirmation. Réponse identique que le compte existe ou non
  // (ne pas révéler quelles adresses sont inscrites).
  async resendVerificationEmail(email: string): Promise<CoreResponse> {
    const generic = {
      success: true,
      message: "Si un compte non confirmé existe pour cette adresse, un nouveau lien vient d'être envoyé.",
    };
    const trimmed = String(email || '').trim();
    const normalized = trimmed.toLowerCase();
    if (!trimmed) throw new BadRequestException('Adresse e-mail requise.');

    const last = lastResendAt.get(normalized) ?? 0;
    if (Date.now() - last < RESEND_COOLDOWN_MS) {
      throw new BadRequestException('Patientez une minute avant de demander un nouvel e-mail.');
    }
    lastResendAt.set(normalized, Date.now());

    const [rows]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
      'SELECT email, name, role, is_verified FROM users WHERE email = ? LIMIT 1',
      [trimmed]
    );
    const user = rows[0];
    if (!user || Number(user.is_verified) === 1) return generic;

    try {
      await sendVerificationLink(user as any);
    } catch (error) {
      console.error("Erreur lors du renvoi de l'e-mail :", safeError(error));
      lastResendAt.delete(normalized);
      throw new InternalServerErrorException("Impossible d'envoyer l'e-mail de vérification.");
    }
    return generic;
  }

  async register(createUserInput: RegisterDto): Promise<AuthResponse> {
    // Contrôle de chaque champ (16/10/2026) : nom, e-mail, mot de passe, date de naissance, sexe
    const name = cleanName(createUserInput?.name, 'Le nom complet');
    const email = cleanEmail(createUserInput?.email);
    const password = checkPassword(createUserInput?.password);
    const birthDate = cleanBirthDate(createUserInput?.birth_date);
    const sex = cleanSex(createUserInput?.sex);

    // Vérification de l'adresse (base) et hachage du mot de passe (calcul) en parallèle
    const [[existing], hashedPassword]: [[RowDataPacket[], any], string] = await Promise.all([
      this.DatabaseService.query<RowDataPacket[]>('SELECT id FROM users WHERE email = ?', [email]),
      bcrypt.hash(password, 10),
    ]);

    if (existing.length > 0) {
      throw new ForbiddenException('Cet utilisateur existe déjà.');
    }

    // Générer le token de vérification 
    const verificationToken = signEmailVerification(email);

    // Lien de vérification
    const verificationLink = `${process.env.BASE_URL}/verify-email?token=${verificationToken}`;

    // Décision B2 (a) du 24/09/2026 : le compte est enregistré AVANT l'envoi de l'e-mail
    // (plus d'e-mail envoyé pour un compte qui n'a pas pu être créé).
    await this.DatabaseService.query(
      `INSERT INTO users 
    (name, email, password, is_verified, email_verified, email_verified_at, is_active, shop_id, birth_date, sex, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        name,
        email,
        hashedPassword,
        false,             // is_verified false
        0,                 // email_verified
        null,              // email_verified_at
        1,                 // is_active
        null,              // shop_id
        birthDate,
        sex
      ]
    );

    // Si l'envoi échoue, le compte existe : l'utilisateur redemande le lien (« Renvoyer l'e-mail »).
    try {
      await sendVerificationEmail({
        email,
        subject: CUSTOMER_VERIFICATION_SUBJECT,
        message: buildCustomerVerificationEmail(verificationLink),
      });
    } catch (error) {
      console.error("Erreur lors de l'envoi de l'e-mail :", safeError(error));
      throw new InternalServerErrorException(
        "Votre compte est créé, mais l'e-mail de confirmation n'a pas pu être envoyé. Cliquez sur « Renvoyer l'e-mail de confirmation ».",
      );
    }

    return {
      message: 'Inscription réussie. Vérifie ton email.',
    };
  }

  async registerPickUpPoint(createUserInput: RegisterDto): Promise<AuthResponse> {
    const { pickup_lat, pickup_lng, pickup_address } = createUserInput;
    // Contrôle de chaque champ (16/10/2026)
    const name = cleanOrgName(createUserInput?.name, "Le nom de l'établissement");
    const email = cleanEmail(createUserInput?.email);
    const password = checkPassword(createUserInput?.password);
    // Coordonnées facultatives (compatibilité avec /admin/add-pickup-point) mais valides si fournies
    const lat = pickup_lat === null || pickup_lat === undefined || (pickup_lat as any) === '' ? null : Number(pickup_lat);
    const lng = pickup_lng === null || pickup_lng === undefined || (pickup_lng as any) === '' ? null : Number(pickup_lng);
    if ((lat === null) !== (lng === null)) {
      throw new BadRequestException('Latitude et longitude doivent être fournies ensemble.');
    }
    if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180)) {
      throw new BadRequestException('Coordonnées GPS invalides.');
    }
    // Vérifier si l'utilisateur existe déjà
    const [existing]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      throw new ForbiddenException('Cet utilisateur existe déjà.');
    }

    // Hash du mot de passe.
    const hashedPassword = await bcrypt.hash(password, 10);

    // Génération du token
    const verificationToken = signEmailVerification(email);

    // Lien de vérification
    const verificationLink = `${process.env.BASE_URL}/verify-email?token=${verificationToken}`;

    // Envoi de l'e-mail adapté aux points de retrait
    try {
      await sendVerificationEmail({
        email,
        subject: PICKUP_VERIFICATION_SUBJECT,
        message: buildPickupVerificationEmail(name, verificationLink),
      });

    } catch (error) {
      console.error("Erreur lors de l'envoi de l'e-mail :", safeError(error));
      throw new InternalServerErrorException("Impossible d'envoyer l'e-mail de vérification.");
    }

    // Insertion en base avec le rôle super_pickuppoint
    await this.DatabaseService.query(
      `INSERT INTO users 
    (name, email, password, role, is_verified, email_verified, email_verified_at, is_active, shop_id, pickup_lat, pickup_lng, pickup_address, pickup_approved, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        name,
        email,
        hashedPassword,
        'super_pickuppoint',
        false,
        0,
        null,
        1,
        null,
        lat,
        lng,
        pickup_address || null,
        0, // en attente de validation par l'admin
      ]
    );

    return {
      message: "Inscription enregistrée. Confirmez votre e-mail : votre compte sera activé après validation par l'équipe E.doto family.",
    };
  }

  async socialLogin(profile: { name: string; email: string }, provider: 'google' | 'facebook'): Promise<AuthResponse> {
    const { name, email } = profile;

    // Vérifier si l'utilisateur existe déjà
    const [existing]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      const user = existing[0];

      // Générer le JWT directement ici
      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          permissions: ['store_owner'], // ou dynamique si besoin
        },
        process.env.JWT_SECRET_KEY,
        { expiresIn: '7d' }
      );

      return {
        message: 'Connexion réussie.',
        token,
        permissions: ['store_owner'], // ou dynamique
      };
    }

    // Créer l'utilisateur directement comme vérifié
    const [result]: any = await this.DatabaseService.query(
      `INSERT INTO users 
    (name, email, password, is_verified, email_verified, email_verified_at, is_active, shop_id, created_at, updated_at, provider)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)`,
      [name, email, null, true, 1, new Date(), 1, null, provider]
    );

    const user = { id: result.insertId, email };

    // Générer le JWT pour le nouvel utilisateur
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        permissions: ['store_owner'],
      },
      process.env.JWT_SECRET_KEY,
      { expiresIn: '7d' }
    );

    return {
      message: 'Compte créé avec succès via ' + provider,
      token,
      permissions: ['store_owner'],
    };
  }



  async verifyEmail(email: string): Promise<void> {
    await this.DatabaseService.query(
      'UPDATE users SET is_verified = ? WHERE email = ?',
      [true, email]
    );
  }
  async login(email: string, password: string): Promise<AuthResponse> {
    const [rows]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    const user = rows[0];
    // Audit 1.5 : même message pour un e-mail inconnu et un mauvais mot de passe (pas de détection de comptes)
    if (!user) throw new UnauthorizedException(INVALID_CREDENTIALS);

    //if (!user.is_verified) {
    //  throw new ForbiddenException('Veuillez valider votre email avant de vous connecter.');
    //}

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    // Contrôles du compte d'abord (bloqué, en attente…), puis e-mail confirmé (rôles sensibles),
    // puis double authentification si elle s'applique
    const session = await this.sessionFor(user);
    if (EMAIL_VERIFIED_ROLES.includes(user.role) && Number(user.is_verified) !== 1) {
      throw new ForbiddenException(EMAIL_NOT_VERIFIED);
    }
    // Défi { totp_required, setup_required, challenge } à la place de { token, permissions } (admin et site le gèrent)
    return (this.totp.challengeFor(user) as AuthResponse & TotpChallenge) ?? session;
  }

  /**
   * Renouvellement de la session (inactivité 5 min, 29/10/2026). Le guard JWT global a déjà vérifié
   * le jeton, le compte actif et la version de session ; la durée maximale depuis la connexion est gardée.
   */
  async refreshSession(payload: any): Promise<AuthResponse> {
    const [[user]]: any = await this.DatabaseService.query<RowDataPacket[]>(
      'SELECT id, email, role, token_version FROM users WHERE id = ? LIMIT 1',
      [Number(payload?.id)],
    );
    if (!user) throw new UnauthorizedException('Session expirée.');
    try {
      return { token: signSession(user, user.role, sessionStart(payload)), permissions: [user.role] };
    } catch {
      throw new UnauthorizedException('Session expirée : reconnectez-vous.');
    }
  }

  // ---------------- Double authentification (audit 3.1, 29/10/2026)
  /** Connexion, étape 2 : code de l'application ou code de secours */
  async loginWithTotp(challenge: string, code: string): Promise<AuthResponse> {
    const user = await this.totp.userFromChallenge(challenge);
    if (!this.totp.isEnabled(user)) throw new BadRequestException('Activez d’abord la double authentification.');
    await this.totp.checkCode(user, code);
    return this.sessionFor(user);
  }

  /** Activation obligatoire pendant la connexion : clé et code QR */
  async totpSetupFromChallenge(challenge: string) {
    return this.totp.startSetup(await this.totp.userFromChallenge(challenge));
  }

  /** Activation obligatoire pendant la connexion : premier code → session et codes de secours */
  async totpActivateFromChallenge(challenge: string, code: string) {
    const user = await this.totp.userFromChallenge(challenge);
    const recovery_codes = await this.totp.activate(user, code);
    return { ...(await this.sessionFor(user)), recovery_codes };
  }

  /** Session selon le rôle (contrôles du compte compris), sans nouvelle vérification du mot de passe */
  private async sessionFor(user: any): Promise<AuthResponse> {
    if (user.role === "customer") {
      if (isBlocked(user.is_active)) {
        throw new ForbiddenException(ACCOUNT_DISABLED);
      }
      const token = signSession(user, 'customer');

      return {
        token,
        permissions: ['customer'],
      };
    } else if (user.role === "super_pickuppoint") {
      // pickup_approved = 0 : inscription pas encore validée dans l'admin
      if (Number(user.pickup_approved) === 0) {
        throw new ForbiddenException(
          "Votre point de retrait est en attente de validation par l'équipe E.doto family.",
        );
      }
      if (Number(user.is_active) === 0) {
        throw new ForbiddenException(
          "Votre point de retrait est bloqué. Contactez l'équipe E.doto family.",
        );
      }
      const token = signSession(user, 'super_pickuppoint');

      return {
        token,
        permissions: ['super_pickuppoint'],
      };
    }
    else if (user.role === "store_owner") {
      if (isBlocked(user.is_active)) {
        throw new ForbiddenException(ACCOUNT_DISABLED);
      }
      // Vérifier si le shop existe
      const [shops]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
        'SELECT * FROM shops WHERE owner_id = ?',
        [user.id]
      );

      const shop = shops[0];

      if (!shop) {
        // Aucun shop → rediriger vers la création
        const token = signSession(user, 'store_owner');

        return {
          token,
          permissions: ['store_owner'],
          redirect: `${process.env.FRONTEND_ADMIN_CALLBACK_URL}/shops/create`,
        };
      }

      if (!shop.is_active) {
        throw new ForbiddenException('Désolé, votre B Space est toujours en cours de validation.');
      }

      // Shop trouvé et actif
      const token = signSession(user, 'store_owner');

      return {
        token,
        permissions: ['store_owner'],
        redirect: process.env.FRONTEND_ADMIN_CALLBACK_URL,
      };
    } else if (user.role === "sponsor") {
      // Espace sponsor : compte créé sur invitation de l'admin (mot de passe choisi via le lien)
      if (Number(user.is_active) === 0) {
        throw new ForbiddenException("Votre espace sponsor est désactivé. Contactez l'équipe E.doto family.");
      }
      const token = signSession(user, 'sponsor');

      return {
        token,
        permissions: ['sponsor'],
      };
    } else if (user.role === "doctor" || user.role === "health_center") {
      // Téléconsultation (19/10/2026) : médecin et centre, comptes créés sur invitation du super admin
      if (Number(user.is_active) === 0) {
        throw new ForbiddenException("Votre espace est désactivé. Contactez l'équipe E.doto family.");
      }
      const token = signSession(user, user.role);

      return {
        token,
        permissions: [user.role],
      };
    } else if (user.role === "super_admin") {
      if (isBlocked(user.is_active)) {
        throw new ForbiddenException(ACCOUNT_DISABLED);
      }
      const token = signSession(user, 'super_admin');

      return {
        token,
        permissions: ['super_admin'],
        redirect: process.env.FRONTEND_ADMIN_CALLBACK_URL,
      };
    }

  }


  // Changement de mot de passe (16/10/2026) : la route répondait « réussi » sans rien changer.
  // Compte connecté, ancien mot de passe vérifié, nouveau mot de passe contrôlé.
  async changePassword(changePasswordInput: ChangePasswordDto, userId?: number): Promise<CoreResponse> {
    if (!userId) throw new UnauthorizedException('Connectez-vous pour changer votre mot de passe.');
    const oldPassword = changePasswordInput?.oldPassword ?? changePasswordInput?.old_password ?? '';
    const newPassword = checkPassword(changePasswordInput?.newPassword ?? changePasswordInput?.new_password);
    if (!oldPassword) throw new BadRequestException('Indiquez votre mot de passe actuel.');
    const [rows]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
      'SELECT id, password FROM users WHERE id = ?',
      [userId],
    );
    if (!rows.length) throw new UnauthorizedException('Compte introuvable.');
    const ok = await bcrypt.compare(String(oldPassword), String(rows[0].password || ''));
    if (!ok) throw new BadRequestException('Mot de passe actuel incorrect.');
    if (await bcrypt.compare(newPassword, String(rows[0].password || ''))) {
      throw new BadRequestException("Le nouveau mot de passe doit être différent de l'ancien.");
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    await this.DatabaseService.query('UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?', [hashed, userId]);
    // Audit 1.5 : toutes les sessions du compte, y compris celle-ci, doivent se reconnecter
    await bumpTokenVersion(this.DatabaseService, 'id = ?', [userId]);
    return { success: true, message: 'Mot de passe modifié.' };
  }

  //  async forgetPassword(forgetPasswordInput: ForgetPasswordDto): Promise<CoreResponse> {
  //   return {
  //     success: true,
  //     message: 'Password reset link sent',
  //   };
  //}

  // Route /verify-forget-password-token : répondait toujours « Token verified » (audit du 21/10/2026)
  async verifyForgetPasswordToken(
    verifyForgetPasswordTokenInput: VerifyForgetPasswordDto,
  ): Promise<CoreResponse> {
    return this.verifyForgotPasswordToken(verifyForgetPasswordTokenInput);
  }



  async socialLoginx(socialLoginDto: SocialLoginDto): Promise<AuthResponse> {
    return {
      token: 'jwt token',
      permissions: ['super_admin', 'customer'],
      role: 'customer',
    };
  }

  async otpLogin(otpLoginDto: OtpLoginDto): Promise<AuthResponse> {
    return {
      token: 'jwt token',
      permissions: ['super_admin', 'customer'],
      role: 'customer',
    };
  }

  async verifyOtpCode({ email, token }: VerifyForgetPasswordDto): Promise<CoreResponse> {
    // Vérifier le token sauvegardé
    // const savedToken = await this.cacheService.get(`reset-${email}`);
    // if (savedToken !== token) throw new UnauthorizedException('Token invalide ou expiré');

    return {
      success: true,
      message: 'Code OTP vérifié avec succès',
    };
  }

  // Jeton passé à la main (création de commande) : vérifié ici, puis même lecture que GET /me
  async me(token: string): Promise<any> {
    const extractToken = String(token || '').replace(/^Bearer\s+/i, '').trim();
    if (!extractToken) {
      throw new UnauthorizedException('Token manquant');
    }
    let decoded: any;
    try {
      decoded = jwt.verify(extractToken, process.env.JWT_SECRET_KEY);
    } catch {
      throw new UnauthorizedException('Token invalide');
    }
    return this.meById(Number(decoded.id));
  }

  /**
   * Compte connecté (audit sécurité 2.9, M12) : GET /me lit req.user, déjà validé par le guard JWT global
   * (signature, compte actif, version de session), au lieu de décoder le jeton une seconde fois.
   */
  async meById(userId: number): Promise<any> {
    try {

      // Utilisateur, profil et boutiques ne dépendent que de l'id du jeton : requêtes en parallèle
      // (un aller-retour vers la base au lieu de trois à cinq à la suite).
      const [[rows], [profileRows], [shopsRows]] = await Promise.all([
        this.DatabaseService.query<RowDataPacket[]>('SELECT * FROM users WHERE id = ?', [userId]),
        this.DatabaseService.query<RowDataPacket[]>('SELECT * FROM profiles WHERE customer_id = ?', [userId]),
        this.DatabaseService.query<RowDataPacket[]>(
          `SELECT
            s.*,
            ci.url AS cover_image_url,
            li.url AS logo_image_url
          FROM shops s
          LEFT JOIN media ci ON s.cover_image_id = ci.id
          LEFT JOIN media li ON s.logo_image_id = li.id
          WHERE s.owner_id = ?`,
          [userId]
        ),
      ]);
      const user = rows[0];
      if (!user) {
        throw new UnauthorizedException('Utilisateur non trouvé');
      }
      if (user.role === 'super_pickuppoint' && Number(user.is_active) === 0) {
        throw new UnauthorizedException('Point de retrait bloqué');
      }
      const profile = profileRows[0] ?? null;

      // Photo de profil : profiles.avatar_id est relié à la table avatars (clé étrangère en production,
      // vérifié le 16/10/2026) ; « url » ajoutée pour le site, « original » et « thumbnail » pour l'admin.
      let avatarMedia = null;
      if (profile?.avatar_id) {
        const [avatarRows]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
          'SELECT id, original, thumbnail FROM avatars WHERE id = ?',
          [profile.avatar_id]
        );
        const a = avatarRows[0];
        avatarMedia = a ? { id: a.id, url: a.original, original: a.original, thumbnail: a.thumbnail || a.original } : null;
      }

      // ✅ Retourne user enrichi sans mentir au type
      // Date de naissance renvoyée en jour simple (AAAA-MM-JJ) : le pilote MySQL la lit comme une date à minuit
      // heure du serveur, d'où une lecture en heure locale du serveur, sans décalage
      const bd: any = (user as any).birth_date;
      const birthDay = bd instanceof Date
        ? `${bd.getFullYear()}-${String(bd.getMonth() + 1).padStart(2, '0')}-${String(bd.getDate()).padStart(2, '0')}`
        : bd ?? null;
      return {
        ...omitPassword(user),
        birth_date: birthDay,
        profile: {
          ...profile,
          avatar: avatarMedia, // objet media complet
        },
        shops: shopsRows,   // liste des shops
      };

    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Token invalide');
    }
  }






  async forgetPassword({ email: rawEmail }: ForgetPasswordDto): Promise<CoreResponse> {
    const email = normalizeResetEmail(rawEmail);
    // Réponse identique dans tous les cas : adresse inconnue, demande trop rapprochée ou code envoyé
    const answer = { success: true, message: RESET_REQUEST_MESSAGE };
    if (!email) return answer;
    if (!RESET_REQUEST_LIMITS.every((l) => allowAttempt(`pwd-reset:${l.windowMs}:${email}`, l.max, l.windowMs))) {
      return answer;
    }

    const [users]: any = await this.DatabaseService.query(
      'SELECT id FROM users WHERE LOWER(email) = ?',
      [email],
    );
    if (users.length === 0) return answer;

    // Code à 6 chiffres (générateur cryptographique), enregistré haché : un seul code actif par adresse
    const token = newResetCode();
    await this.DatabaseService.query('DELETE FROM password_resets WHERE email = ?', [email]);
    await this.DatabaseService.query(
      `INSERT INTO password_resets (email, otp, attempts, created_at) VALUES (?, ?, 0, NOW())`,
      [email, hashResetCode(token)],
    );

    // Envoyer l’email..
    await sendVerificationEmail({
      email,
      subject: 'Votre code de réinitialisation · E.doto family',
      message: `
  <div style="font-family: 'Inter', Arial, sans-serif; max-width: 640px; margin: auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 40px rgba(0,0,0,0.06); border: 1px solid #f2f2f2;">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #fff5f8, #ffe4ef); padding: 32px 24px; text-align: center;">
      <img src="https://edotofamily.netlify.app/images/edotofamily6.1.png" alt="E.doto family" style="height: 72px; margin-bottom: 12px;" />
      <h1 style="color: #FF6EA9; font-size: 22px; font-weight: 700; margin: 0;">E.doto family</h1>
      <p style="color: #6B7280; font-size: 14px; margin-top: 6px;">Harmonie, bien-être et santé au féminin</p>
    </div>

    <!-- Body -->
    <div style="padding: 40px 30px; background-color: #ffffff; text-align: center;">
      <h2 style="color: #111827; font-size: 20px; margin-bottom: 12px;">Réinitialisation de votre mot de passe 🌸</h2>
      <p style="color: #4B5563; font-size: 15px; line-height: 1.7; margin: 0 auto; max-width: 460px;">
        Vous avez demandé à réinitialiser votre mot de passe.  
        Utilisez le code ci-dessous pour continuer :
      </p>

      <!-- Token / Code -->
      <div style="font-size: 28px; font-weight: 700; color: #FF6EA9; margin: 30px 0; padding: 14px 24px; background: #FFF0F5; border-radius: 12px; display: inline-block; letter-spacing: 2px;">
        ${token}
      </div>

      <p style="color: #6B7280; font-size: 14px; line-height: 1.6;">
        Ce code expirera dans <strong>10 minutes</strong>.<br />
        Si vous n'avez pas demandé cette réinitialisation, ignorez simplement cet e-mail.
      </p>
 
    </div>

    <!-- Footer -->
    <div style="background: #fafafa; padding: 20px; text-align: center; border-top: 1px solid #f3f4f6;">
      <p style="color: #9CA3AF; font-size: 12px; margin: 0;">
        © ${new Date().getFullYear()} E.doto family. Tous droits réservés<br />
        <a href="https://edotofamily.com" style="color: #FF6EA9; text-decoration: none;">www.edotofamily.com</a>
      </p>
    </div>

  </div>
  `,
    });


    return answer;
  }

  // Contrôle du code : 10 minutes, 5 essais au plus, puis le code est détruit
  private async checkResetCode(email: string, token: string): Promise<boolean> {
    if (!email || !token) return false;
    const [rows]: any = await this.DatabaseService.query(
      `SELECT id, otp, attempts FROM password_resets
       WHERE email = ? AND created_at >= NOW() - INTERVAL ${RESET_CODE_TTL_MINUTES} MINUTE
       ORDER BY id DESC LIMIT 1`,
      [email],
    );
    const row = rows[0];
    if (!row) return false;
    if (Number(row.attempts) >= RESET_MAX_ATTEMPTS) {
      await this.DatabaseService.query('DELETE FROM password_resets WHERE email = ?', [email]);
      return false;
    }
    if (resetCodeMatches(token, row.otp)) return true;

    if (Number(row.attempts) + 1 >= RESET_MAX_ATTEMPTS) {
      await this.DatabaseService.query('DELETE FROM password_resets WHERE email = ?', [email]);
    } else {
      await this.DatabaseService.query('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    }
    return false;
  }

  // 2. --- VERIFY OTP ---
  async verifyForgotPasswordToken({ email, token }: VerifyForgetPasswordDto): Promise<CoreResponse> {
    if (!(await this.checkResetCode(normalizeResetEmail(email), token))) {
      return { success: false, message: RESET_INVALID_MESSAGE };
    }
    return { success: true, message: 'Code valide' };
  }

  // 3. --- RESET PASSWORD ---
  async resetPassword({ email: rawEmail, token, password }: ResetPasswordDto): Promise<CoreResponse> {
    const email = normalizeResetEmail(rawEmail);
    // Mot de passe contrôlé avant le code : une erreur de saisie ne consomme pas d'essai
    const hashedPassword = await bcrypt.hash(checkPassword(password), 10);

    if (!(await this.checkResetCode(email, token))) {
      return { success: false, message: RESET_INVALID_MESSAGE };
    }

    await this.DatabaseService.query(
      'UPDATE users SET password = ?, updated_at = NOW() WHERE LOWER(email) = ?',
      [hashedPassword, email],
    );
    // Audit 1.5 : les sessions ouvertes avant la réinitialisation sont fermées
    await bumpTokenVersion(this.DatabaseService, 'LOWER(email) = ?', [email]);

    // Code utilisé : détruit
    await this.DatabaseService.query('DELETE FROM password_resets WHERE email = ?', [email]);

    return { success: true, message: 'Mot de passe réinitialisé avec succès' };
  }
}
