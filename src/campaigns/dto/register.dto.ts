// dto/register.dto.ts
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class RegisterDto {
  @IsNotEmpty()
  @IsNumber()
  campaign_id: number;

  @IsNotEmpty()
  pickup_center: string; // ID ou nom selon ton besoin

  // Ville du participant (une des villes de la campagne) ; vérifiée par le service
  @IsOptional()
  @IsString()
  city?: string;
}
