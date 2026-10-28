import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 6) : corps { id } des actions admin (bloquer, débloquer,
// approuver, désapprouver). Remplace @Body('id'), qui laissait passer un objet jusqu'au SQL.
@StrictDto()
export class IdBodyDto {
  @IsOptional() @IsScalar() id: number;
}

// Envoyés par l'admin (approve-shop-view.tsx), non lus par ShopsService.approveShop
@StrictDto()
export class ApproveShopDto extends IdBodyDto {
  @IsOptional() @IsScalar() admin_commission_rate?: number;
  @IsOptional() @IsScalar() isCustomCommission?: boolean;
}
