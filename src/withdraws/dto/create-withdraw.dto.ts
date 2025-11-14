import { PickType } from '@nestjs/swagger';
import { Withdraw } from '../entities/withdraw.entity';
import { IsOptional, IsString } from 'class-validator';

export class CreateWithdrawDto extends PickType(Withdraw, [
  'amount',
  'note',
  'details',
  'payment_method',
  'shop_id',
]) {
  @IsOptional()
  @IsString()
  status?: string;
}
