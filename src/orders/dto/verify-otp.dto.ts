// src/orders/dto/verify-otp.dto.ts
import { IsNotEmpty, IsString } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

@StrictDto()
export class VerifyOtpDto {
    @IsNotEmpty()
    @IsString()
    otp_code: string;

    @IsNotEmpty()
    @IsScalar()
    order_id: number;
}
