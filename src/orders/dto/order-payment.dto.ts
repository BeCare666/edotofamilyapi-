import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

@StrictDto()
export class OrderPaymentDto {
  @IsOptional() @IsScalar() tracking_number: number;
}
