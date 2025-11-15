

import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
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
import * as jwt from 'jsonwebtoken';
import { RowDataPacket } from 'mysql2';
@Injectable()
export class AuthService {
  constructor(private readonly DatabaseService: DatabaseService) { }

  async register(createUserInput: RegisterDto): Promise<AuthResponse> {
    const { name, email, password } = createUserInput;

    // Vérifier si l'utilisateur existe déjà
    const [existing]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      throw new ForbiddenException('Cet utilisateur existe déjà.');
    }

    // Hasher le mot de passe de l'utilisateur
    const hashedPassword = await bcrypt.hash(password, 10);

    // Générer le token de vérification 
    const verificationToken = jwt.sign(
      { email },
      process.env.JWT_SECRET_KEY,
      { expiresIn: '5m' }
    );

    // Lien de vérification
    const verificationLink = `${process.env.BASE_URL}/verify-email?token=${verificationToken}`;

    // Envoie l'e-mail de vérification (toujours, même si l'utilisateur existe déjà)
    try {
      await sendVerificationEmail({
        email,
        subject: "Confirme ton adresse e-mail - E·Doto Family",
        message: `
  <div style="font-family: 'Inter', Arial, sans-serif; max-width: 640px; margin: auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 40px rgba(0,0,0,0.06); border: 1px solid #f2f2f2;">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #fff5f8, #ffe4ef); padding: 32px 24px; text-align: center;">
      <img src="https://edotofamily.netlify.app/images/edotofamily6.1.png" alt="E·Doto Family" style="height: 72px; margin-bottom: 12px;" />
      <h1 style="color: #FF6EA9; font-size: 22px; font-weight: 700; margin: 0;">E·Doto Family</h1>
      <p style="color: #6B7280; font-size: 14px; margin-top: 6px;">Harmonie, bien-être et santé au féminin</p>
    </div>

    <!-- Body -->
    <div style="padding: 40px 30px; background-color: #ffffff;">
      <h2 style="color: #111827; font-size: 20px; margin-bottom: 12px; text-align: center;">Bienvenue dans la famille 🌸</h2>
      <p style="color: #4B5563; font-size: 15px; line-height: 1.7; text-align: center; margin: 0 auto; max-width: 460px;">
        Merci de t’être inscrite sur <strong>E·Doto Family</strong>.  
        Pour activer ton compte et rejoindre notre communauté,  
        confirme ton adresse e-mail en cliquant sur le bouton ci-dessous :
      </p>

      <!-- Call to Action -->
      <div style="text-align: center; margin: 36px 0;">
        <a href="${verificationLink}"
          style="background: linear-gradient(135deg, #FF6EA9, #ff579d); color: #fff; padding: 14px 36px;
                 border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px;
                 display: inline-block; box-shadow: 0 3px 10px rgba(255,110,169,0.3); transition: all 0.3s ease;">
          Confirmer mon e-mail
        </a>
      </div>

      <p style="color: #6B7280; font-size: 14px; line-height: 1.6; text-align: center;">
        Ce lien expirera dans <strong>5 minutes</strong> pour des raisons de sécurité.  
        Si tu n’as pas créé de compte, ignore simplement cet e-mail.
      </p>

      <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 36px 0;" />

      <p style="color: #9CA3AF; font-size: 13px; text-align: center;">
        Merci pour ta confiance 💖<br />
        L’équipe <strong style="color: #FF6EA9;">E·Doto Family</strong>
      </p>
    </div>

    <!-- Footer -->
    <div style="background: #fafafa; padding: 20px; text-align: center; border-top: 1px solid #f3f4f6;">
      <p style="color: #9CA3AF; font-size: 12px; margin: 0;">
        © ${new Date().getFullYear()} E·Doto Family — Tous droits réservés<br />
        <a href="https://edotofamily.netlify.app" style="color: #FF6EA9; text-decoration: none;">www.edotofamily.com</a>
      </p>
    </div>
  </div>
  `,
      })


    } catch (error) {
      console.error("Erreur lors de l'envoi de l'e-mail :", error);
      throw new InternalServerErrorException("Impossible d'envoyer l'e-mail de vérification.");
    }


    // Insertion dans la table users 
    await this.DatabaseService.query(
      `INSERT INTO users 
    (name, email, password, is_verified, email_verified, email_verified_at, is_active, shop_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        name,
        email,
        hashedPassword,
        false,             // is_verified false
        0,                 // email_verified
        null,              // email_verified_at
        1,                 // is_active
        null               // shop_id
      ]
    );

    return {
      message: 'Inscription réussie. Vérifie ton email.',
    };
  }

  async registerPickUpPoint(createUserInput: RegisterDto): Promise<AuthResponse> {
    const { name, email, password } = createUserInput;

    // Vérifier si l'utilisateur existe déjà
    const [existing]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      throw new ForbiddenException('Cet utilisateur existe déjà.');
    }

    // Hash du mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    // Génération du token
    const verificationToken = jwt.sign(
      { email },
      process.env.JWT_SECRET_KEY,
      { expiresIn: '5m' }
    );

    // Lien de vérification
    const verificationLink = `${process.env.BASE_URL}/verify-email?token=${verificationToken}`;

    // Envoi de l'e-mail adapté aux points de retrait
    try {
      await sendVerificationEmail({
        email,
        subject: "Activez votre compte Point de Retrait - E·Doto Family",
        message: `
  <div style="font-family: 'Inter', Arial, sans-serif; max-width: 640px; margin: auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 40px rgba(0,0,0,0.06); border: 1px solid #f2f2f2;">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #fff5f8, #ffe4ef); padding: 32px 24px; text-align: center;">
      <img src="https://edotofamily.netlify.app/images/edotofamily6.1.png" alt="E·Doto Family" style="height: 72px; margin-bottom: 12px;" />
      <h1 style="color: #FF6EA9; font-size: 22px; font-weight: 700; margin: 0;">E·Doto Family</h1>
      <p style="color: #6B7280; font-size: 14px; margin-top: 6px;">Partenaire officiel — Point de Retrait</p>
    </div>

    <!-- Body -->
    <div style="padding: 40px 30px; background-color: #ffffff;">
      <h2 style="color: #111827; font-size: 20px; margin-bottom: 12px; text-align: center;">
        Bienvenue parmi nos Points de Retrait ✨
      </h2>

      <p style="color: #4B5563; font-size: 15px; line-height: 1.7; text-align: center; margin: 0 auto; max-width: 480px;">
        Bonjour <strong>${name}</strong>,<br/><br/>
        Vous venez de rejoindre notre réseau de <strong>Points de Retrait E·Doto Family</strong>.  
        Pour finaliser votre inscription et accéder à votre espace partenaire,  
        merci de confirmer votre adresse e-mail en cliquant sur le bouton ci-dessous :
      </p>

      <!-- Call to Action -->
      <div style="text-align: center; margin: 36px 0;">
        <a href="${verificationLink}"
          style="background: linear-gradient(135deg, #FF6EA9, #ff579d); color: #fff; padding: 14px 36px;
                 border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px;
                 display: inline-block; box-shadow: 0 3px 10px rgba(255,110,169,0.3); transition: all 0.3s ease;">
          Activer mon compte
        </a>
      </div>

      <p style="color: #6B7280; font-size: 14px; line-height: 1.6; text-align: center;">
        Ce lien est valable pendant <strong>5 minutes</strong>.  
        Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail.
      </p>

      <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 36px 0;" />

      <p style="color: #9CA3AF; font-size: 13px; text-align: center;">
        Merci de contribuer à offrir une meilleure expérience aux membres de la communauté 💖<br />
        L’équipe <strong style="color: #FF6EA9;">E·Doto Family</strong>
      </p>
    </div>

    <!-- Footer -->
    <div style="background: #fafafa; padding: 20px; text-align: center; border-top: 1px solid #f3f4f6;">
      <p style="color: #9CA3AF; font-size: 12px; margin: 0;">
        © ${new Date().getFullYear()} E·Doto Family — Tous droits réservés<br />
        <a href="https://edotofamily.netlify.app" style="color: #FF6EA9; text-decoration: none;">www.edotofamily.com</a>
      </p>
    </div>
  </div>
      `,
      });

    } catch (error) {
      console.error("Erreur lors de l'envoi de l'e-mail :", error);
      throw new InternalServerErrorException("Impossible d'envoyer l'e-mail de vérification.");
    }

    // Insertion en base avec le rôle super_pickuppoint
    await this.DatabaseService.query(
      `INSERT INTO users 
    (name, email, password, role, is_verified, email_verified, email_verified_at, is_active, shop_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        name,
        email,
        hashedPassword,
        'super_pickuppoint', // rôle
        false,
        0,
        null,
        1,
        null
      ]
    );

    return {
      message: 'Inscription réussie. Vérifiez votre e-mail pour activer votre compte Point de Retrait.',
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
    if (!user) throw new UnauthorizedException('Utilisateur non trouvé');

    if (!user.is_verified) {
      throw new ForbiddenException('Veuillez valider votre email avant de vous connecter.');
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      throw new UnauthorizedException('Mot de passe incorrect');
    }
    if (user.role === "customer") {
      const token = jwt.sign({
        id: user.id,
        email: user.email,
        permissions: ['customer'],
      }, process.env.JWT_SECRET_KEY, { expiresIn: '7d' });

      return {
        token,
        permissions: ['customer'],
      };
    } else if (user.role === "store_owner") {
      // Vérifier si le shop existe
      const [shops]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
        'SELECT * FROM shops WHERE owner_id = ?',
        [user.id]
      );

      const shop = shops[0];

      if (!shop) {
        // Aucun shop → rediriger vers la création
        const token = jwt.sign({
          id: user.id,
          email: user.email,
          permissions: ['store_owner'],
        }, process.env.JWT_SECRET_KEY, { expiresIn: '7d' });

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
      const token = jwt.sign({
        id: user.id,
        email: user.email,
        permissions: ['store_owner'],
      }, process.env.JWT_SECRET_KEY, { expiresIn: '7d' });

      return {
        token,
        permissions: ['store_owner'],
        redirect: process.env.FRONTEND_ADMIN_CALLBACK_URL,
      };
    } else if (user.role === "super_admin") {
      const token = jwt.sign({
        id: user.id,
        email: user.email,
        permissions: ['super_admin'],
      }, process.env.JWT_SECRET_KEY, { expiresIn: '7d' });

      return {
        token,
        permissions: ['super_admin'],
        redirect: process.env.FRONTEND_ADMIN_CALLBACK_URL,
      };
    }

  }


  async changePassword(changePasswordInput: ChangePasswordDto): Promise<CoreResponse> {
    // Ici tu peux implémenter la logique pour changer le mot de passe avec vérification etc. 
    return {
      success: true,
      message: 'Password change successful',
    };
  }

  //  async forgetPassword(forgetPasswordInput: ForgetPasswordDto): Promise<CoreResponse> {
  //   return {
  //     success: true,
  //     message: 'Password reset link sent',
  //   };
  //}

  async verifyForgetPasswordToken(
    verifyForgetPasswordTokenInput: VerifyForgetPasswordDto,
  ): Promise<CoreResponse> {
    return {
      success: true,
      message: 'Token verified',
    };
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

  async me(token: string): Promise<any> {
    const extractToken = token.replace(/^Bearer\s+/i, '').trim();
    if (!extractToken) {
      throw new UnauthorizedException('Token manquant');
    }

    try {
      const decoded: any = jwt.verify(extractToken, process.env.JWT_SECRET_KEY);

      // 1️⃣ Récupérer user de base //
      const [rows]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
        'SELECT * FROM users WHERE id = ?',
        [decoded.id]
      );
      const user = rows[0];
      if (!user) {
        throw new UnauthorizedException('Utilisateur non trouvé');
      }

      // 2️⃣ Récupérer profile lié
      const [profileRows]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
        'SELECT * FROM profiles WHERE customer_id = ?',
        [decoded.id]
      );
      const profile = profileRows[0] ?? null;

      // 3️⃣ Récupérer avatar s'il existe
      let avatar = null;
      if (profile?.avatar_id) {
        const [avatarRows]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
          'SELECT * FROM avatars WHERE id = ?',
          [profile.avatar_id]
        );
        avatar = avatarRows[0] ?? null;
      }
      // 3️⃣ Récupérer avatar s'il existe
      let avatarMedia = null;
      if (profile?.avatar_id) {
        const [mediaRows]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
          'SELECT id, user_id, url, `key`, mime_type, size, original_name, created_at, updated_at FROM media WHERE id = ?',
          [profile.avatar_id]
        );
        avatarMedia = mediaRows[0] ?? null;
      }

      // 4️⃣ Récupérer les shops où user est owner
      const [shopsRows]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
        `SELECT 
          s.*, 
          ci.url AS cover_image_url, 
          li.url AS logo_image_url 
        FROM shops s
        LEFT JOIN media ci ON s.cover_image_id = ci.id
        LEFT JOIN media li ON s.logo_image_id = li.id
        WHERE s.owner_id = ?`,
        [decoded.id]
      );

      // ✅ Retourne user enrichi sans mentir au type
      return {
        ...user,
        profile: {
          ...profile,
          avatar: avatarMedia, // objet media complet
        },
        shops: shopsRows,   // liste des shops
      };

    } catch (error) {
      throw new UnauthorizedException('Token invalide');
    }
  }






  async forgetPassword({ email }: ForgetPasswordDto): Promise<CoreResponse> {
    // Vérifier si l'email existe dans users
    const [users]: any = await this.DatabaseService.query(
      'SELECT id FROM users WHERE email = ?',
      [email],
    );
    if (users.length === 0) {
      return { success: false, message: "Aucun utilisateur trouvé avec cet email" };
    }

    // Générer un token (6 chiffres aléatoires)
    const token = Math.floor(100000 + Math.random() * 900000).toString();

    // Sauvegarder le token en BDD (valide 10 min)
    await this.DatabaseService.query(
      `INSERT INTO password_resets (email, otp, created_at)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE otp = VALUES(otp), created_at = NOW()`,
      [email, token],
    );

    // Envoyer l’email..
    await sendVerificationEmail({
      email,
      subject: 'Votre code de réinitialisation - E·Doto Family',
      message: `
  <div style="font-family: 'Inter', Arial, sans-serif; max-width: 640px; margin: auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 40px rgba(0,0,0,0.06); border: 1px solid #f2f2f2;">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #fff5f8, #ffe4ef); padding: 32px 24px; text-align: center;">
      <img src="https://edotofamily.netlify.app/images/edotofamily6.1.png" alt="E·Doto Family" style="height: 72px; margin-bottom: 12px;" />
      <h1 style="color: #FF6EA9; font-size: 22px; font-weight: 700; margin: 0;">E·Doto Family</h1>
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
        © ${new Date().getFullYear()} E·Doto Family — Tous droits réservés<br />
        <a href="https://edotofamily.netlify.app" style="color: #FF6EA9; text-decoration: none;">www.edotofamily.com</a>
      </p>
    </div>

  </div>
  `,
    });


    return { success: true, message: 'Code OTP envoyé par email' };
  }

  // 2. --- VERIFY OTP ---
  async verifyForgotPasswordToken({ email, token }: VerifyForgetPasswordDto): Promise<CoreResponse> {
    const [rows]: any = await this.DatabaseService.query(
      `SELECT * FROM password_resets 
       WHERE email = ? AND otp = ? 
         AND created_at >= NOW() - INTERVAL 10 MINUTE`,
      [email, token],
    );

    if (rows.length === 0) {
      return { success: false, message: 'Code invalide ou expiré' };
    }

    return { success: true, message: 'Code valide' };
  }

  // 3. --- RESET PASSWORD ---
  async resetPassword({ email, token, password }: ResetPasswordDto): Promise<CoreResponse> {
    // Vérifier OTP valide
    const [rows]: any = await this.DatabaseService.query(
      `SELECT * FROM password_resets 
       WHERE email = ? AND otp = ? 
         AND created_at >= NOW() - INTERVAL 10 MINUTE`,
      [email, token],
    );

    if (rows.length === 0) {
      return { success: false, message: 'Code invalide ou expiré' };
    }

    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    // Mettre à jour le mot de passe utilisateur
    await this.DatabaseService.query(
      'UPDATE users SET password = ?, updated_at = NOW() WHERE email = ?',
      [hashedPassword, email],
    );

    // Supprimer l’OTP utilisé
    await this.DatabaseService.query(
      'DELETE FROM password_resets WHERE email = ?',
      [email],
    );

    return { success: true, message: 'Mot de passe réinitialisé avec succès' };
  }
}
