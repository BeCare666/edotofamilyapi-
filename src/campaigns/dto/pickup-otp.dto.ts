import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 6) : retrait d'un kit au point de retrait (ValidateModal.jsx).
@StrictDto()
export class MarkPickupDto {
  @IsOptional() @IsScalar() registration_id: number;
}

@StrictDto()
export class VerifyCampaignOtpDto extends MarkPickupDto {
  @IsOptional() @IsScalar() otp: string;
}
