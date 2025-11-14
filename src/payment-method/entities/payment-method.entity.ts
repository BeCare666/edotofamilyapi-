import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsNumber } from 'class-validator';
import { CoreEntity } from 'src/common/entities/core.entity';
import { PaymentGateWay } from './payment-gateway.entity';

export class PaymentMethod extends CoreEntity {
  @IsNotEmpty()
  @IsString()
  method_key: string;


  @IsNotEmpty()
  @IsNumber()
  method_id: number; // 

  @IsOptional()
  @IsBoolean()
  default_card: boolean;
  payment_gateway_id?: number;
  fingerprint?: string;
  owner_name?: string;
  network?: string;
  type?: string;
  last4?: string;
  expires?: string;
  origin?: string;
  verification_check?: string;

  // 🔥 Ajoute cette ligne pour permettre la recherche par utilisateur
  user_id?: number;

  payment_gateways?: PaymentGateWay;
}
