import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 2) : PUT /orders/:id. Mêmes champs que UPDATABLE_FIELDS
// (order-access.ts), qui filtre ensuite selon la relation (admin, boutique, client).
@StrictDto()
export class UpdateOrderDto {
  @IsOptional() @IsScalar() order_status?: string;
  @IsOptional() @IsScalar() payment_status?: string;
  @IsOptional() @IsScalar() pickup_point_id?: number | null;
  @IsOptional() @IsScalar() note?: string | null;
}
