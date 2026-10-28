import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';
import { ShopFields } from './create-shop.dto';

// Audit sécurité 2.3 (28/10/2026, lot 3) : champs lus par ShopsService.update. address, documents,
// bank et raw_payload y sont enregistrés en JSON (JSON.stringify) : contenu non filtré.
@StrictDto()
export class UpdateShopDto extends ShopFields {
  @IsOptional() address?: Record<string, any>;
  @IsOptional() documents?: any;
  @IsOptional() bank?: any;
  @IsOptional() raw_payload?: any;
  @IsOptional() @IsScalar() zip?: string;
  @IsOptional() @IsScalar() city?: string;
  @IsOptional() @IsScalar() state?: string;
  @IsOptional() @IsScalar() country?: string;
  @IsOptional() @IsScalar() street_address?: string;
  @IsOptional() @IsScalar() rating?: number;
}
