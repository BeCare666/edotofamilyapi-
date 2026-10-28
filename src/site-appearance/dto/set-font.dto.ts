import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 7) : PUT /admin/site-appearance (admin site-font.tsx).
@StrictDto()
export class SetFontDto {
  @IsOptional() @IsScalar() font: string;
}
