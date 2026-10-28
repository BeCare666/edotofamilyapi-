// create-shop.dto.ts
import { Type } from 'class-transformer';
import { IsObject, IsOptional, ValidateNested } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 3) : liste blanche stricte (@StrictDto). Seuls les champs lus
// par ShopsService.create et ShopsService.update sont déclarés. Les valeurs écrites telles quelles
// en base sont simples ; location, documents, bank, raw_payload sont enregistrés en JSON.
export class ShopImageInput {
  @IsOptional() @IsScalar() url: string;
  @IsOptional() @IsScalar() key?: string;
  @IsOptional() @IsScalar() mimeType?: string;
  @IsOptional() @IsScalar() size?: number;
  @IsOptional() @IsScalar() originalName?: string;
  @IsOptional() @IsScalar() user_id?: number;
}

export class ShopAddressInput {
  @IsOptional() @IsScalar() zip?: string;
  @IsOptional() @IsScalar() city?: string;
  @IsOptional() @IsScalar() state?: string;
  @IsOptional() @IsScalar() country?: string;
  @IsOptional() @IsScalar() street_address?: string;
}

export class ShopFields {
  @IsOptional() @IsScalar() name: string;
  @IsOptional() @IsScalar() slug: string;
  @IsOptional() @IsScalar() description?: string;
  @IsOptional() @IsScalar() is_active?: boolean;
  @IsOptional() @IsScalar() contact?: string;
  @IsOptional() @IsScalar() website?: string;
  @IsOptional() @IsObject() location?: Record<string, any>;
  // null = image retirée (mise à jour)
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ShopImageInput)
  cover_image?: ShopImageInput | null;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ShopImageInput)
  logo_image?: ShopImageInput | null;
}

@StrictDto()
export class CreateShopDto extends ShopFields {
  // POST /staffs (super admin) ; POST /shops le remplace par l'utilisateur connecté
  @IsOptional() @IsScalar() owner_id?: number;
  // create lit address.zip, address.city…
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ShopAddressInput)
  address?: ShopAddressInput;
}
