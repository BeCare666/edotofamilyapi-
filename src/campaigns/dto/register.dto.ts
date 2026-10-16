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

  // Identifiant de l'appareil (tiré au hasard et conservé par le navigateur) et empreinte du
  // navigateur (SHA-256) : une seule demande de kit par personne et par campagne (campaign-guard.ts)
  @IsOptional()
  @IsString()
  device_id?: string;

  @IsOptional()
  @IsString()
  device_fingerprint?: string;

  // Position GPS au moment de la demande (obligatoire, décision du 16/10/2026) : l'API en déduit
  // la ville et vérifie qu'elle fait partie des villes de la campagne
  @IsOptional()
  lat?: number;

  @IsOptional()
  lng?: number;

  // Comptes créés avant le 16/10/2026 : date de naissance et sexe complétés une seule fois ici
  @IsOptional()
  @IsString()
  birth_date?: string;

  @IsOptional()
  @IsString()
  sex?: string;
}
