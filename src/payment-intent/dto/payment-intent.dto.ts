import { IsNumber, IsString, IsOptional } from 'class-validator';

export class CreatePaymentIntentDto {
    @IsNumber()
    orderId: number;

    @IsString()
    paymentGateway: string;
}

export class ConfirmPaymentDto {
    @IsNumber()
    paymentIntentId: number;
}
