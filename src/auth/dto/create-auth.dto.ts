import { PartialType, PickType } from '@nestjs/swagger';
import { CoreMutationOutput } from 'src/common/dto/core-mutation-output.dto';
import { User } from 'src/users/entities/user.entity';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

enum Permission {
  SUPER_ADMIN = 'Super admin',
  STORE_OWNER = 'Store owner',
  STAFF = 'Staff',
  CUSTOMER = 'Customer',
}

// --------- AUTH ---------
export class RegisterDto extends PickType(User, ['name', 'email', 'password']) {
  permission: Permission = Permission.CUSTOMER;
}

export class LoginDto extends PartialType(
  PickType(User, ['email', 'password']),
) { }

export class SocialLoginDto {
  name: string;
  email: string;
  provider: 'google' | 'facebook';
}


export class ChangePasswordDto {
  oldPassword: string;
  newPassword: string;
}

// --------- PASSWORD RESET (EMAIL OTP) ---------
export class ForgetPasswordDto {
  email: string;
}

export class VerifyForgetPasswordDto {
  email: string;
  token: string; // code OTP reçu par email
}

export class ResetPasswordDto {
  email: string;
  token: string; // code OTP reçu par email
  password: string;
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
