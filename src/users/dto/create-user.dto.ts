import { Type } from 'class-transformer';
import { IsArray, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

enum Permission {
  SUPER_ADMIN = 'Super admin',
  STORE_OWNER = 'Store owner',
  STAFF = 'Staff',
  CUSTOMER = 'Customer',
}

// Audit sécurité 2.3 (28/10/2026, lot 3) : liste blanche stricte (@StrictDto). Seuls les champs lus
// par UsersService.create et UsersService.update sont déclarés ; les valeurs écrites en base sont
// des valeurs simples (mysql2 transforme un objet ou un tableau en fragment SQL).
export class UserProfileInput {
  // Envoyé par l'admin (formulaire profil), non lu
  @IsOptional() @IsScalar() id?: number;
  @IsOptional() @IsScalar() bio?: string;
  @IsOptional() @IsScalar() socials?: string;
  @IsOptional() @IsScalar() contact?: string;
  // Envoyé par l'admin (formulaire profil), non lu
  @IsOptional() notifications?: any;
  // Lu : avatar.url (table avatars)
  @IsOptional() @IsObject() avatar?: { url?: string; [key: string]: any };
}

export class UserAddressFields {
  @IsOptional() @IsScalar() street_address?: string;
  @IsOptional() @IsScalar() country?: string;
  @IsOptional() @IsScalar() city?: string;
  @IsOptional() @IsScalar() state?: string;
  @IsOptional() @IsScalar() zip?: string;
}

export class UserAddressInput {
  @IsOptional() @IsScalar() title?: string;
  @IsOptional() @IsScalar() type?: string;
  @IsOptional() @IsScalar() default?: boolean;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => UserAddressFields)
  address?: UserAddressFields;
}

@StrictDto()
export class CreateUserDto {
  @IsOptional() @IsScalar() name: string;
  @IsOptional() @IsScalar() email: string;
  @IsOptional() @IsScalar() password: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => UserAddressInput)
  address?: UserAddressInput[];
  @IsOptional() @IsObject() @ValidateNested() @Type(() => UserProfileInput)
  profile?: UserProfileInput;
  // Route réservée au super admin
  @IsOptional() @IsString() permission?: Permission;
}
