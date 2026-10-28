import { Type } from 'class-transformer';
import { IsObject, IsOptional, ValidateNested } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';
import { UserProfileInput } from './create-user.dto';

// Audit sécurité 2.3 (28/10/2026, lot 3) : PUT /users/:id. UsersService.update lit name, email,
// profile (bio, socials, contact, avatar). Mot de passe et rôle : jamais par cette route.
@StrictDto()
export class UpdateUserDto {
  @IsOptional() @IsScalar() name?: string;
  @IsOptional() @IsScalar() email?: string;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => UserProfileInput)
  profile?: UserProfileInput;
}
