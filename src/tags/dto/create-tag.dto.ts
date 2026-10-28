import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 4) : liste blanche stricte. Champs lus par TagsService
// (create et update) : name, slug, language, icon, details, type_id.
@StrictDto()
export class CreateTagDto {
  @IsOptional() @IsScalar() name: string;
  @IsOptional() @IsScalar() slug?: string;
  @IsOptional() @IsScalar() language?: string;
  @IsOptional() @IsScalar() icon?: string;
  @IsOptional() @IsScalar() details?: string;
  @IsOptional() @IsScalar() type_id?: number;
}
