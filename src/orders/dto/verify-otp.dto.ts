// src/orders/dto/verify-otp.dto.ts
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyOtpDto {
    @IsNotEmpty()
    @IsString()
    otp_code: string;

    @IsNotEmpty()
    order_id: number;
}
