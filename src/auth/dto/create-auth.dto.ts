import { CoreMutationOutput } from 'src/common/dto/core-mutation-output.dto';
import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

enum Permission {
  SUPER_ADMIN = 'Super admin',
  STORE_OWNER = 'Store owner',
  STAFF = 'Staff',
  CUSTOMER = 'Customer',
}

// --------- AUTH ---------
// Audit sécurité 2.3 (27/10/2026) : liste blanche stricte (@StrictDto) ; seuls les champs décorés
// arrivent au service. IsScalar bloque objets et tableaux ; les contrôles métier (nom, e-mail,
// mot de passe, date) restent dans AuthService avec leurs messages en français.
@StrictDto()
export class RegisterDto {
  @IsOptional() @IsScalar() name?: string;
  @IsOptional() @IsScalar() email?: string;
  @IsOptional() @IsScalar() password?: string;
  @IsOptional() @IsScalar() pickup_lat?: number;
  @IsOptional() @IsScalar() pickup_lng?: number;
  @IsOptional() @IsScalar() pickup_address?: string;
  // Inscription des utilisateurs (16/10/2026) : date de naissance (AAAA-MM-JJ) et sexe (female | male)
  @IsOptional() @IsScalar() birth_date?: string;
  @IsOptional() @IsScalar() sex?: string;
  // Jamais lu : le rôle est fixé par le serveur (retiré par la liste blanche s'il est envoyé)
  permission?: Permission;
}

@StrictDto()
export class LoginDto {
  @IsOptional() @IsScalar() email?: string;
  @IsOptional() @IsScalar() password?: string;
}

export class SocialLoginDto {
  name: string;
  email: string;
  provider: 'google' | 'facebook';
}


@StrictDto()
export class ChangePasswordDto {
  @IsOptional() @IsScalar() oldPassword?: string;
  @IsOptional() @IsScalar() newPassword?: string;
  // Même chose, écrit autrement par la page profil du site
  @IsOptional() @IsScalar() old_password?: string;
  @IsOptional() @IsScalar() new_password?: string;
}

// --------- PASSWORD RESET (EMAIL OTP) ---------
@StrictDto()
export class ForgetPasswordDto {
  @IsOptional() @IsScalar() email: string;
}

// POST /resend-verification-email (site services/authService.js), lot 10 du 28/10/2026
@StrictDto()
export class ResendVerificationDto {
  @IsOptional() @IsScalar() email: string;
}

@StrictDto()
export class VerifyForgetPasswordDto {
  @IsOptional() @IsScalar() email: string;
  @IsOptional() @IsScalar() token: string; // code OTP reçu par email
}

@StrictDto()
export class ResetPasswordDto {
  @IsOptional() @IsScalar() email: string;
  @IsOptional() @IsScalar() token: string; // code OTP reçu par email
  @IsOptional() @IsScalar() password: string;
}

// --------- RESPONSES ---------
export class AuthResponse {
  token?: string;
  permissions?: string[];
  role?: string;
  message?: string;
  redirect?: string;
}

export class CoreResponse extends CoreMutationOutput { }

// --------- OTP (SMS FLOW, si tu gardes) ---------
export class VerifyOtpDto {
  otp_id: string;
  code: string;
  phone_number: string;
}

export class OtpResponse {
  id: string;
  message: string;
  success: boolean;
  phone_number: string;
  provider: string;
  is_contact_exist: boolean;
}

export class OtpDto {
  phone_number: string;
}

export class OtpLoginDto {
  otp_id: string;
  code: string;
  phone_number: string;
  name?: string;
  email?: string;
}

// Double authentification (audit sécurité 3.1, 29/10/2026)
@StrictDto()
export class TotpChallengeDto {
  @IsOptional() @IsScalar() challenge: string;
}

@StrictDto()
export class TotpLoginDto {
  @IsOptional() @IsScalar() challenge: string;
  @IsOptional() @IsScalar() code: string;
}

@StrictDto()
export class TotpCodeDto {
  @IsOptional() @IsScalar() code: string;
}
