import { PartialType } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 2) : createOrderStatus lit name et description.
@StrictDto()
export class CreateOrderStatusDto {
  @IsOptional() @IsScalar() name: string;
  @IsOptional() @IsScalar() description?: string;
  @IsOptional() @IsScalar() color?: string;
  @IsOptional() @IsScalar() serial?: number;
  @IsOptional() @IsScalar() language?: string;
}

@StrictDto()
export class UpdateOrderStatusDto extends PartialType(CreateOrderStatusDto) {}
