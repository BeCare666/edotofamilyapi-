import { IsNumber, IsString } from 'class-validator';

export class CreatePaymentIntentDto {
    @IsNumber()
    orderId: number;              // L'ID de la commande parent à payer

    @IsString()
    paymentGateway: string;       // 'flutterwave', 'stripe', etc.
}
