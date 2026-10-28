import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 4) : liste blanche stricte. Champs lus par TaxesService
// (create et update, même liste que allowedFields).
@StrictDto()
export class CreateTaxDto {
  @IsOptional() @IsScalar() name: string;
  @IsOptional() @IsScalar() rate: number;
  @IsOptional() @IsScalar() is_global?: boolean;
  @IsOptional() @IsScalar() country?: string;
  @IsOptional() @IsScalar() state?: string;
  @IsOptional() @IsScalar() zip?: string;
  @IsOptional() @IsScalar() city?: string;
  @IsOptional() @IsScalar() priority?: number;
  @IsOptional() @IsScalar() on_shipping?: boolean;
}
