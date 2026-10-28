import { IsOptional } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 6) : corps envoyé par le site après le paiement FeexPay
// (FeexPayModal.jsx). feexpay_response est seulement archivé en JSON (pending_payments).
@StrictDto()
export class CompleteFeexPayDto {
  @IsOptional() @IsScalar() transaction_id: string;
  @IsOptional() @IsScalar() custom_id: string;
  @IsOptional() feexpay_response?: any;
}
