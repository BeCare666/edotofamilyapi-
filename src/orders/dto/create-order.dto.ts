import { Type } from 'class-transformer';
import { IsArray, IsObject, IsOptional, ValidateNested } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';
import { PaymentGatewayType } from '../entities/order.entity';

// Audit sécurité 2.3 (28/10/2026, lot 2) : liste blanche stricte (@StrictDto). Seuls les champs lus
// par OrdersService.create sont déclarés, plus ceux que le site envoie déjà (prix, total) : ils sont
// acceptés mais ignorés, les prix et frais étant recalculés côté serveur.
// Retirés : card, payment_id, payment_intent, order_status, payment_status… (jamais lus).
export class DeliveryChoiceInput {
  @IsOptional() @IsScalar() type: 'PICKUP' | 'CUSTOM';
  @IsOptional() @IsScalar() pickup_point_id?: number;
  @IsOptional() @IsScalar() lat?: number;
  @IsOptional() @IsScalar() lng?: number;
  @IsOptional() @IsScalar() description?: string;
  @IsOptional() @IsScalar() phone?: string;
}

export class UserAddressInput {
  street_address: string;
  country: string;
  city: string;
  state: string;
  zip: string;
}

export class ConnectProductOrderPivot {
  @IsOptional() @IsScalar() product_id: number;
  @IsOptional() @IsScalar() variation_option_id?: number;
  @IsOptional() @IsScalar() order_quantity: number;
  // Envoyés par le site, ignorés (prix relus dans la table products)
  @IsOptional() @IsScalar() unit_price?: number;
  @IsOptional() @IsScalar() subtotal?: number;
}

@StrictDto()
export class CreateOrderDto {
  @IsOptional() @IsScalar() shop_id?: number;
  @IsOptional() @IsScalar() coupon_id?: number;
  @IsOptional() @IsScalar() customer_contact?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ConnectProductOrderPivot)
  products: ConnectProductOrderPivot[];
  // Envoyé par le site, ignoré (total recalculé)
  @IsOptional() @IsScalar() total?: number;
  @IsOptional() @IsScalar() payment_gateway?: PaymentGatewayType;
  @IsOptional() @IsScalar() delivery_time?: string;
  @IsOptional() @IsObject() billing_address?: UserAddressInput;
  @IsOptional() @IsObject() shipping_address?: UserAddressInput;
  @IsOptional() @IsScalar() language?: string;
  // Lieu choisi avant le paiement
  @IsOptional() @IsObject() @ValidateNested() @Type(() => DeliveryChoiceInput)
  delivery?: DeliveryChoiceInput;
}
