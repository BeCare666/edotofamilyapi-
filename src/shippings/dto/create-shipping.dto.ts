import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 4) : ShippingsService ne lit pas le corps (données fixes du
// fichier JSON) ; champs de l'entité Shipping déclarés pour ne pas encombrer le journal.
@StrictDto()
export class CreateShippingDto {
  @IsOptional() @IsScalar() name: string;
  @IsOptional() @IsScalar() amount: number;
  @IsOptional() @IsScalar() is_global: boolean;
  @IsOptional() @IsScalar() type: string;
}
