{ /**import {
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

    // Vérifie si l'utilisateur existe déjà
    const [existing]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    const verificationToken = jwt.sign(
      { email },
      process.env.JWT_SECRET_KEY,
      { expiresIn: '5m' }
    );

    const verificationLink = `http://localhost:5000/api/verify-email?token=${verificationToken}`;

    // Envoie l'e-mail de vérification (toujours, même si l'utilisateur existe déjà)
    try {
      await sendVerificationEmail({
        email,
        subject: 'Confirme ton adresse email - Galilée Commerce',
        message: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      <div style="background: #f3f4f6; padding: 20px; text-align: center;">
        <img src="https://galileecommerce.netlify.app/img/Image1galile.png" alt="Galilée Commerce" style="height: 80px; margin-bottom: 10px;" />
      </div>
      <div style="padding: 30px;">
        <h2 style="color: #111827; margin-bottom: 10px;">Bienvenue chez Galilée Commerce !</h2>
        <p style="color: #374151; font-size: 16px; line-height: 1.5;">
          Merci de vous être inscrit sur notre plateforme. Pour activer votre compte, veuillez confirmer votre adresse email en cliquant sur le bouton ci-dessous.
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationLink}" style="background-color: #ec4899; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">
            Confirmer mon adresse email
          </a>
        </div>
        <p style="color: #6b7280; font-size: 14px;">
          Si vous n'avez pas créé de compte, vous pouvez ignorer cet email. Ce lien expirera dans 5 minutes pour des raisons de sécurité.
        </p>
        <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
          Merci,<br />
          L’équipe Galilée Commerce
        </p>
      </div>
      <div style="background: #f9fafb; text-align: center; padding: 20px; font-size: 12px; color: #9ca3af;">
        © ${new Date().getFullYear()} Galilée Commerce. Tous droits réservés.
      </div>
    </div>
  `,
      });

    } catch (error) {
      console.error("Erreur lors de l'envoi de l'e-mail :", error);
      throw new InternalServerErrorException("Impossible d'envoyer l'e-mail de vérification.");
    }

    // Si l'utilisateur existe déjà, on ne fait rien de plus
    if (existing.length > 0) {
      return {
        message: 'Un compte existe déjà avec cet email. Un nouvel email de vérification a été envoyé.',
      };
    }

    // Sinon, on crée le compte
    const hashedPassword = await bcrypt.hash(password, 10);

    await this.DatabaseService.query(
      `INSERT INTO users 
      (name, email, password, is_verified, email_verified, email_verified_at, is_active, shop_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        name,
        email,
        hashedPassword,
        false,
        0,
        null,
        1,
        null
      ]
    );

    return {
      message: 'Inscription réussie. Vérifie ton email.',
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

    const token = jwt.sign({
      id: user.id,
      email: user.email,
      permissions: ['store_owner'], // ou dynamique : customer  
    }, process.env.JWT_SECRET_KEY, { expiresIn: '7d' });

    return {
      token,
      permissions: ['store_owner'], // à remplacer dynamiquement si besoin store_owner
    };
  }


  async changePassword(changePasswordInput: ChangePasswordDto): Promise<CoreResponse> {
    // Ici tu peux implémenter la logique pour changer le mot de passe avec vérification etc.
    return {
      success: true,
      message: 'Password change successful',
    };
  }

  async forgetPassword(forgetPasswordInput: ForgetPasswordDto): Promise<CoreResponse> {
    return {
      success: true,
      message: 'Password reset link sent',
    };
  }

  async verifyForgetPasswordToken(
    verifyForgetPasswordTokenInput: VerifyForgetPasswordDto,
  ): Promise<CoreResponse> {
    return {
      success: true,
      message: 'Token verified',
    };
  }

  async resetPassword(resetPasswordInput: ResetPasswordDto): Promise<CoreResponse> {
    return {
      success: true,
      message: 'Password reset successful',
    };
  }

  async socialLogin(socialLoginDto: SocialLoginDto): Promise<AuthResponse> {
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

  async verifyOtpCode(verifyOtpInput: VerifyOtpDto): Promise<CoreResponse> {
    return {
      message: 'success',
      success: true,
    };
  }

  async sendOtpCode(otpInput: OtpDto): Promise<OtpResponse> {
    return {
      message: 'success',
      success: true,
      id: '1',
      provider: 'google',
      phone_number: '+919494949494',
      is_contact_exist: true,
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

}**/ }