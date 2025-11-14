import { IsNumber, IsOptional, IsString } from 'class-validator';

export class ConfirmPaymentDto {
    @IsNumber()
    paymentIntentId: number;      // L’ID du payment intent à confirmer

    @IsOptional()
    @IsString()
    tx_ref?: string;

    @IsOptional()
    @IsString()
    transaction_id?: string;
}
