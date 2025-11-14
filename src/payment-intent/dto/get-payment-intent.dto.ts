import { IsEnum, IsBoolean, IsOptional, IsString } from 'class-validator';
import { PaymentGatewayType } from 'src/orders/entities/order.entity';

export class GetPaymentIntentDto {
  @IsString()
  tracking_number: string; // ✅ string car souvent envoyé dans l’URL ou en JSON

  @IsBoolean()
  recall_gateway: boolean;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsEnum(PaymentGatewayType)
  payment_gateway: PaymentGatewayType;
}
