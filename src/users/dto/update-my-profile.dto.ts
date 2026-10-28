import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 7) : PATCH /me/profile (site profile.js). Les contrôles
// (cleanName, cleanBirthDate, cleanSex, cleanPhone) restent dans le contrôleur.
@StrictDto()
export class UpdateMyProfileDto {
  @IsOptional() @IsScalar() name?: string;
  @IsOptional() @IsScalar() birth_date?: string;
  @IsOptional() @IsScalar() sex?: string;
  @IsOptional() @IsScalar() phone?: string;
}
