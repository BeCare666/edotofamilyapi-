import { Type } from 'class-transformer';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { IsScalar, StrictDto } from 'src/common/strict-body';

// Audit sécurité 2.3 (28/10/2026, lot 8) : corps des routes campagnes. Les contrôles métier
// (parseCampaignInput, cleanTarget, parseSponsorInput, coordonnées, appareil) restent en place.

export class CampaignSponsorInput {
  @IsOptional() @IsScalar() sponsor_id: number;
  @IsOptional() @IsScalar() amount?: number;
}

// Admin components/campaign/campaign-form.tsx
@StrictDto()
export class CampaignInputDto {
  @IsOptional() @IsScalar() title: string;
  @IsOptional() @IsScalar() description?: string;
  @IsOptional() @IsScalar() image_url?: string;
  @IsOptional() @IsScalar() objective_kits: number;
  @IsOptional() @IsScalar() date_start: string;
  @IsOptional() @IsScalar() date_end: string;
  @IsOptional() @IsArray() @IsScalar({ each: true }) cities: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CampaignSponsorInput)
  sponsors?: CampaignSponsorInput[];
  @IsOptional() @IsScalar() target_sex?: string;
  @IsOptional() @IsScalar() target_age_min?: number | null;
  @IsOptional() @IsScalar() target_age_max?: number | null;
  // Création depuis une demande de campagne validée
  @IsOptional() @IsScalar() proposal_id?: number;
}

@StrictDto()
export class CreateSponsorDto {
  @IsOptional() @IsScalar() name: string;
  @IsOptional() @IsScalar() email: string;
}

// Site lib/deviceIdentity.js (deviceMarks)
@StrictDto()
export class EligibilityDto {
  @IsOptional() @IsScalar() device_id?: string;
  @IsOptional() @IsScalar() device_fingerprint?: string | null;
}

// Site campaigns/CampaignKit.jsx (position GPS)
@StrictDto()
export class LocateDto {
  @IsOptional() @IsScalar() lat: number;
  @IsOptional() @IsScalar() lng: number;
}
