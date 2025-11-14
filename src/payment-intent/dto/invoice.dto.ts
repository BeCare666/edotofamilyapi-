import { IsNumber, IsString } from 'class-validator';

export class GenerateInvoiceDto {
    @IsNumber()
    orderId: number;

    @IsString()
    userId: string;
}
