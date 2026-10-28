import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 7) : corps des routes de livraison. Les contrôles métier
// (parseDeviceId, PIN, téléphone, coordonnées) restent dans DeliveryService et delivery-rules.ts.

// Page du livreur (site pages/livraison/[token].js)
@StrictDto()
export class CourierOpenDto {
  @IsOptional() @IsScalar() device_id: string;
}

@StrictDto()
export class CourierActionDto extends CourierOpenDto {
  @IsOptional() @IsScalar() pin: string;
  @IsOptional() @IsScalar() otp?: string;
}

// Admin custom-deliveries/index.tsx
@StrictDto()
export class AssignCourierDto {
  @IsOptional() @IsScalar() courier_name: string;
  @IsOptional() @IsScalar() courier_phone: string;
}

@StrictDto()
export class DeliverySettingsDto {
  @IsOptional() @IsScalar() price_per_km: number;
  @IsOptional() @IsScalar() center_lat: number;
  @IsOptional() @IsScalar() center_lng: number;
}
