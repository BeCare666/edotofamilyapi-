// dto/register.dto.ts
import { IsNotEmpty, IsNumber } from 'class-validator';

export class RegisterDto {
  @IsNotEmpty()
  @IsNumber()
  campaign_id: number;

  @IsNotEmpty()
  pickup_center: string; // ID ou nom selon ton besoin
}
